class HLSDownloader {
  constructor({ onProgress, onStatus }) {
    this.onProgress = onProgress || (() => {});
    this.onStatus = onStatus || (() => {});
    this.abortController = new AbortController();
  }

  async download(url, filename) {
    try {
      this.onStatus('Fetching playlist...');
      const response = await fetch(url, { signal: this.abortController.signal });
      const content = await response.text();

      // Check if Master Playlist
      if (content.includes('#EXT-X-STREAM-INF')) {
        this.onStatus('Parsing master playlist...');
        const streamUrl = this.getBestStream(content, url);
        if (streamUrl) {
          console.log('Redirecting to best stream:', streamUrl);
          return this.download(streamUrl, filename);
        } else {
          throw new Error('No valid stream found in master playlist');
        }
      }

      // Check for Encryption
      let encryption = this.parseEncryption(content, url);
      if (encryption && encryption.method !== 'NONE') {
        if (encryption.method === 'AES-128' && encryption.uri) {
           this.onStatus(`Detected AES-128 Encryption. Fetching key...`);
           try {
             encryption.key = await this.fetchKey(encryption.uri);
             this.onStatus(`Key fetched. Decryption enabled.`);
           } catch(e) {
             throw new Error('Failed to fetch encryption key: ' + e.message);
           }
        } else {
           throw new Error(`Unsupported encryption method: ${encryption.method}`);
        }
      }

      // Parse Segments (Updated with discontinuity support)
      const segments = this.parseSegments(content, url);
      if (segments.length === 0) {
        throw new Error('No segments found');
      }

      this.onStatus(`Found ${segments.length} segments. Starting download...`);
      
      const blobs = []; // Store { data: ArrayBuffer, discontinuity: boolean }
      let downloaded = 0;

      // Download segments in batches
      const BATCH_SIZE = 5;
      for (let i = 0; i < segments.length; i += BATCH_SIZE) {
        if (this.abortController.signal.aborted) throw new Error('Download aborted');

        const batch = segments.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (segmentObj, idx) => {
          try {
            const res = await fetch(segmentObj.url, { signal: this.abortController.signal });
            if (!res.ok) throw new Error(`Failed to fetch segment`);
            let buffer = await res.arrayBuffer();
            
            // Decrypt if needed
            if (encryption && encryption.key) {
               let iv = encryption.iv;
               if (!iv) {
                 const sequenceNum = (encryption.mediaSequence || 0) + (i + idx);
                 iv = this.createIV(sequenceNum);
               }
               buffer = await this.decrypt(buffer, encryption.key, iv);
            }

            return { data: buffer, discontinuity: segmentObj.discontinuity };
          } catch (e) {
            console.error(e);
            return null;
          }
        });

        const results = await Promise.all(promises);
        results.forEach(b => {
          if (b) blobs.push(b);
        });

        downloaded += batch.length;
        this.onProgress(Math.min(downloaded, segments.length), segments.length);
      }

      this.onStatus('Merging and converting to MP4...');
      
      // Transmux TS to MP4 using mux.js
      let success = false;
      if (typeof muxjs !== 'undefined') {
        try {
          // keepOriginalTimeline: false ensures the first segment starts at 0
          const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimeline: false });
          const mp4Segments = [];
          
          transmuxer.on('data', (segment) => {
            if (segment.initSegment) {
              mp4Segments.push(segment.initSegment);
            }
            mp4Segments.push(segment.data);
          });

          // Feed segments one by one to handle timeline correctly
          for (const segment of blobs) {
            if (segment.discontinuity) {
                transmuxer.flush(); // Handle discontinuity
            }
            transmuxer.push(new Uint8Array(segment.data));
            // Do NOT flush after every segment. Only flush on discontinuity or at end.
          }
          transmuxer.flush(); // Final flush

          if (mp4Segments.length > 0) {
             const finalBlob = new Blob(mp4Segments, { type: 'video/mp4' });
             
             // EXPERIMENTAL: Patch mvhd duration if needed.
             // But first, let's just trigger download. 
             // keepOriginalTimeline: false should have fixed the start time.
             // If duration is still huge, it's likely mvhd is 0 or messed up.
             // Fixing duration in binary is complex without a library.
             
             this.triggerDownload(finalBlob, filename, '.mp4');
             success = true;
          }
        } catch (muxErr) {
          console.error('Mux.js error:', muxErr);
        }
      }

      if (!success) {
        this.onStatus('Transmuxing failed. Saving as TS (Force)...');
        
        // Reconstruct combined data for fallback
        const totalLength = blobs.reduce((acc, b) => acc + b.data.byteLength, 0);
        const combinedData = new Uint8Array(totalLength);
        let offset = 0;
        for (const b of blobs) {
          combinedData.set(new Uint8Array(b.data), offset);
          offset += b.data.byteLength;
        }

        const combinedBlob = new Blob([combinedData], { type: 'video/mp2t' });
        this.triggerDownload(combinedBlob, filename, '.ts');
      }

    } catch (error) {
      this.onStatus('Error: ' + error.message);
      console.error(error);
    }
  }

  parseEncryption(content, baseUrl) {
    const lines = content.split('\n');
    let method = 'NONE';
    let uri = null;
    let iv = null;
    let mediaSequence = 0;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.split(':')[1]);
      }
      if (line.startsWith('#EXT-X-KEY:')) {
        const keyAttrs = line.substring(11);
        const methodMatch = keyAttrs.match(/METHOD=([^,]+)/);
        if (methodMatch) method = methodMatch[1];
        
        const uriMatch = keyAttrs.match(/URI="([^"]+)"/);
        if (uriMatch) uri = this.resolveUrl(uriMatch[1], baseUrl);
        
        const ivMatch = keyAttrs.match(/IV=0x([0-9A-Fa-f]+)/);
        if (ivMatch) {
            const hex = ivMatch[1];
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
            }
            iv = bytes;
        }
      }
    }
    return { method, uri, iv, mediaSequence };
  }

  async fetchKey(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Key fetch failed');
    return await res.arrayBuffer();
  }

  createIV(sequenceNum) {
    const buffer = new ArrayBuffer(16);
    const view = new DataView(buffer);
    view.setUint32(12, sequenceNum, false);
    return new Uint8Array(buffer);
  }

  async decrypt(data, key, iv) {
    try {
        const cryptoKey = await crypto.subtle.importKey(
            "raw", key, { name: "AES-CBC" }, false, ["decrypt"]
        );
        return await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: iv }, cryptoKey, data
        );
    } catch (e) {
        console.error('Decryption error', e);
        throw e;
    }
  }

  triggerDownload(blob, filename, extension) {
      const downloadUrl = URL.createObjectURL(blob);
      filename = filename.replace(/\.(ts|mp4|m3u8|txt)$/i, '');
      const finalFilename = filename + extension;

      console.log('Saving as:', finalFilename);

      chrome.downloads.download({
        url: downloadUrl,
        filename: finalFilename,
        saveAs: true
      });

      this.onStatus('Done!');
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
  }

  getBestStream(content, baseUrl) {
    const lines = content.split('\n');
    let bestUrl = null;
    let maxBandwidth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
        
        let url = lines[i + 1].trim();
        if (url) {
          if (bandwidth > maxBandwidth || !bestUrl) {
            maxBandwidth = bandwidth;
            bestUrl = this.resolveUrl(url, baseUrl);
          }
        }
      }
    }
    return bestUrl;
  }

  parseSegments(content, baseUrl) {
    const lines = content.split('\n');
    const segments = [];
    let hasDiscontinuity = false;
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        hasDiscontinuity = true;
      }
      if (line && !line.startsWith('#')) {
        segments.push({
          url: this.resolveUrl(line, baseUrl),
          discontinuity: hasDiscontinuity
        });
        hasDiscontinuity = false;
      }
    }
    return segments;
  }

  resolveUrl(url, baseUrl) {
    try {
      return new URL(url, baseUrl).href;
    } catch (e) {
      return url;
    }
  }

  abort() {
    this.abortController.abort();
  }
}
