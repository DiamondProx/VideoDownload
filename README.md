# Video Downloader Pro

A Chrome Extension to download videos (MP4, M3U8, etc.) from any website.

## Features
- Detects video files automatically (MP4, WebM, M3U8, etc.).
- Detects videos embedded in `<video>` tags.
- **Auto-Conversion**: Automatically converts M3U8 streams to MP4 files.
- Allows downloading videos or copying the URL.
- Supports Manifest V3 (Chrome 88+).

## Installation

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select this directory (`d:\GitHub\VideoDL`).
5. The extension is now installed!

## Usage

### How to use the Popup
1. **Pin the Extension**: Click the "Puzzle Piece" icon in Chrome's toolbar, find "Video Downloader Pro", and click the "Pin" icon. This makes it always visible.
2. **Visit a Page**: Go to a website with a video (e.g., a news site, video portal).
3. **Play Video**: Start playing the video. This is crucial for the extension to detect the media stream.
4. **Check Icon**: The extension icon will show a green badge with a number (e.g., "1") indicating detected videos.
5. **Open Popup**: Click the extension icon. You will see a list of detected videos.
6. **Download**:
   - **MP4**: Click "Download" to save directly.
   - **M3U8**: Click "Download". A progress bar will appear. Wait for it to finish "Merging and converting". A "Save As" dialog will appear with the `.mp4` file.

## Troubleshooting
- **File saved as .txt?**: This happens if the original URL had no extension. The latest version forces `.mp4` extension. Please refresh the extension.
- **Download fails?**: Some encrypted streams (DRM) are not supported.
