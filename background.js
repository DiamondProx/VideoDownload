// background.js

// Store detected videos in session storage: { [tabId]: [ { url, type, title, size } ] }

const MEDIA_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'audio/mpeg',
  'audio/wav',
  'application/dash+xml' // MPD
];

const EXTENSIONS = ['.mp4', '.m3u8', '.webm', '.ogg', '.mp3', '.wav', '.flv', '.mov'];

// Bilibili Referer Rule
const BILIBILI_RULE_ID = 1;
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [BILIBILI_RULE_ID],
  addRules: [
    {
      id: BILIBILI_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.bilibili.com/" },
          { header: "Origin", operation: "remove" }
        ]
      },
      condition: {
        requestDomains: ["bilivideo.com", "bilivideo.cn", "hdslb.com"]
      }
    }
  ]
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId === -1) return;

    const headers = details.responseHeaders;
    const contentTypeHeader = headers.find(h => h.name.toLowerCase() === 'content-type');
    const contentLengthHeader = headers.find(h => h.name.toLowerCase() === 'content-length');
    
    const contentType = contentTypeHeader ? contentTypeHeader.value.toLowerCase().split(';')[0] : '';
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader.value) : 0;

    // Filter by Content-Type
    let isMedia = MEDIA_TYPES.includes(contentType);

    // Filter by Extension if Content-Type is generic (like application/octet-stream)
    if (!isMedia) {
      const url = new URL(details.url);
      const ext = url.pathname.toLowerCase();
      if (EXTENSIONS.some(e => ext.endsWith(e))) {
        isMedia = true;
      }
    }

    if (isMedia) {
      addVideo(details.tabId, details.url, contentType, contentLength);
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Listen for messages from content script (video tags detected in DOM)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'foundVideo' && sender.tab) {
    addVideo(sender.tab.id, message.url, 'video/dom', 0);
  } else if (message.action === 'checkBilibili' && sender.tab) {
    fetchBilibiliVideo(sender.tab.id, message.bvid, message.cid, message.title);
  }
});

// Clear video list when page is refreshed or navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    chrome.storage.local.remove(tabId.toString());
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(tabId.toString());
});

async function fetchBilibiliVideo(tabId, bvid, cid, title) {
  try {
    // fnval=1 requests MP4/FLV (durl)
    const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1&platform=html5&high_quality=1`;
    const res = await fetch(apiUrl);
    const json = await res.json();
    
    let baseFilename = `bilibili_${bvid}`;
    if (title) {
        baseFilename = title.replace(/[\\/:*?"<>|]/g, '_');
    }

    if (json.code === 0 && json.data) {
        let added = false;
        // Check for durl (MP4/FLV)
        if (json.data.durl && json.data.durl.length > 0) {
            const video = json.data.durl[0];
            await addVideo(tabId, video.url, 'video/mp4', video.size, `${baseFilename}.mp4`);
            added = true;
        } 
        
        // If no durl, check dash (fallback)
        if (!added && json.data.dash) {
             const videoTrack = json.data.dash.video[0];
             const audioTrack = json.data.dash.audio ? json.data.dash.audio[0] : null;
             
             await addVideo(tabId, videoTrack.baseUrl, 'video/mp4', 0, `${baseFilename}_video.mp4`);
             if (audioTrack) {
                 await addVideo(tabId, audioTrack.baseUrl, 'audio/mp4', 0, `${baseFilename}_audio.mp4`);
             }
        }
    }
  } catch (e) {
      console.error('Bilibili fetch failed', e);
  }
}

async function addVideo(tabId, url, type, size, customFilename = null) {
  const key = tabId.toString();
  
  // Use local storage to persist somewhat longer or session if available
  // MV3 service workers can terminate, so we rely on storage.
  const data = await chrome.storage.local.get(key);
  let videos = data[key] || [];

  // Avoid duplicates
  if (!videos.some(v => v.url === url)) {
    // Try to guess filename from URL
    let filename = customFilename || 'video';
    if (!customFilename) {
        try {
          const urlObj = new URL(url);
          const path = urlObj.pathname;
          const parts = path.split('/');
          const last = parts[parts.length - 1];
          if (last && last.includes('.')) {
            filename = last;
          } else {
            filename = `video_${Date.now()}`;
            if (type.includes('mp4')) filename += '.mp4';
            else if (type.includes('mpegurl')) filename += '.m3u8';
          }
        } catch (e) {}
    }

    videos.push({
      url,
      type,
      size: formatSize(size),
      filename,
      timestamp: Date.now()
    });
    
    await chrome.storage.local.set({ [key]: videos });
    
    // Update badge
    chrome.action.setBadgeText({ tabId, text: videos.length.toString() });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
  }
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(1) + ' ' + units[i];
}
