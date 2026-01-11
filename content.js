// content.js
console.log("Video Downloader Content Script Loaded");

function scanForVideos() {
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    if (video.src && video.src.startsWith('http')) {
      chrome.runtime.sendMessage({
        action: 'foundVideo',
        url: video.src
      });
    }
    // Check for source elements inside video
    const sources = video.querySelectorAll('source');
    sources.forEach(source => {
      if (source.src && source.src.startsWith('http')) {
        chrome.runtime.sendMessage({
          action: 'foundVideo',
          url: source.src
        });
      }
    });
  });
}

// Initial scan
scanForVideos();

// Observe DOM changes
const observer = new MutationObserver(() => {
  scanForVideos();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
