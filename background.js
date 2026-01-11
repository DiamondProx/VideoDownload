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

async function addVideo(tabId, url, type, size) {
  const key = tabId.toString();
  
  // Use local storage to persist somewhat longer or session if available
  // MV3 service workers can terminate, so we rely on storage.
  const data = await chrome.storage.local.get(key);
  let videos = data[key] || [];

  // Avoid duplicates
  if (!videos.some(v => v.url === url)) {
    // Try to guess filename from URL
    let filename = 'video';
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
