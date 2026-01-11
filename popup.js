document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) return;

  const key = tab.id.toString();
  const data = await chrome.storage.local.get(key);
  const videos = data[key] || [];

  const list = document.getElementById('video-list');
  list.innerHTML = '';

  if (videos.length === 0) {
    list.innerHTML = '<div class="empty-state">No videos detected on this page.<br>Try playing the video.</div>';
    return;
  }

  videos.forEach((video, index) => {
    const li = document.createElement('li');
    li.className = 'video-item';

    const isM3U8 = video.url.includes('.m3u8') || video.type.includes('mpegurl');
    const typeLabel = isM3U8 ? '<span class="tag-m3u8">M3U8</span>' : '<span class="tag-mp4">MP4</span>';

    li.innerHTML = `
      <div class="video-info">
        <span class="video-name" title="${video.url}">${video.filename}</span>
        <span class="video-meta">${video.size} ${typeLabel}</span>
      </div>
      <div class="actions">
        <button class="btn-download" data-url="${video.url}" data-filename="${video.filename}" data-type="${isM3U8 ? 'm3u8' : 'mp4'}">Download</button>
        <button class="btn-copy" data-url="${video.url}">Copy Link</button>
      </div>
    `;

    list.appendChild(li);
  });

  // Event delegation
  list.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-download')) {
      const url = e.target.getAttribute('data-url');
      const filename = e.target.getAttribute('data-filename');
      const type = e.target.getAttribute('data-type');
      
      if (type === 'm3u8') {
        downloadM3U8(url, filename);
      } else {
        downloadVideo(url, filename);
      }
    } else if (e.target.classList.contains('btn-copy')) {
      const url = e.target.getAttribute('data-url');
      copyToClipboard(url, e.target);
    }
  });
});

function downloadVideo(url, filename) {
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true // Prompt user for location
  });
}

function downloadM3U8(url, filename) {
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  progressContainer.style.display = 'block';
  
  const downloader = new HLSDownloader({
    onProgress: (current, total) => {
      const percent = Math.round((current / total) * 100);
      progressBar.style.width = percent + '%';
      progressText.textContent = `Downloading: ${percent}% (${current}/${total})`;
    },
    onStatus: (msg) => {
      progressText.textContent = msg;
    }
  });

  downloader.download(url, filename).then(() => {
    setTimeout(() => {
      progressContainer.style.display = 'none';
      progressBar.style.width = '0%';
    }, 3000);
  });
}

function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.textContent;
    btnElement.textContent = 'Copied!';
    setTimeout(() => {
      btnElement.textContent = originalText;
    }, 1500);
  });
}
