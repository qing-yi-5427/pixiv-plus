# PixivPlus

A Chrome extension (Manifest V3) that enhances the Pixiv browsing experience with hover preview, batch download, and image metadata embedding.

## Features

### Hover Preview
- **Full-size preview** — Hover over any thumbnail to view the original image in a modern dark panel
- **Drag-to-pan zoom** — Click to zoom in, drag to pan around, double-click to zoom out
- **Page navigation** — Browse multi-page works with arrow buttons or keyboard (`←` `→`)
- **Cross-work navigation** — Navigate between works on the current page
- **Tags panel** — View all tags of the current work, click to search on Pixiv
- **Configurable delay** — Adjust hover trigger delay in settings

### Download
- **Original quality** — Downloads original-resolution images via background service worker
- **Single-page & multi-page** — Multi-page works show a selection grid
- **Filename template** — Customize filenames with `{artist}`, `{title}`, `{id}`, `{page}`
- **Custom download directory** — Pick any folder via File System Access API
- **Progress panel** — Floating panel with download speed, progress bar, cancel/remove buttons
- **Auto-close** — Panel automatically closes 3 seconds after all downloads complete

### Tag Embedding
- **PNG metadata** — Writes tags as XMP via iTXt chunk (viewable in Windows Properties)
- **JPEG metadata** — Writes tags as XMP via APP1 segment (viewable in Windows Properties)
- **Toggle** — Enable/disable tag embedding in plugin settings

## Installation

1. Download or clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `pixiv-plus` folder

## Settings

Access via the PixivPlus icon in the Chrome toolbar:

| Setting | Default | Description |
|---------|---------|-------------|
| Hover Preview | On | Enable/disable hover preview |
| Preview Delay | 400ms | Delay before showing preview |
| Embed Tags in Image | On | Write Pixiv tags into downloaded image metadata |
| Filename Template | `{artist}-{title}-{id}` | Template for downloaded filenames |

## Tech Stack

- **Manifest V3** Chrome Extension
- **Shadow DOM** for all injected UI (style isolation)
- **Background Service Worker** for CORS-free image fetching
- **declarativeNetRequest** for Referer header injection on `i.pximg.net`
- **File System Access API** for downloads to arbitrary directories
- **Base64 data URL** transfer between service worker and content script

## File Structure

```
pixiv-plus/
├── manifest.json              # Manifest V3 config
├── rules.json                 # declarativeNetRequest Referer rules
├── background/
│   └── service-worker.js      # Settings API, image fetch with progress
├── lib/
│   └── pixiv-api.js           # /ajax/illust/{id} wrapper, caching, filename gen
├── content/
│   ├── main.js                # Entry point, MutationObserver
│   ├── hover-preview.js       # Hover preview overlay UI
│   ├── bookmark-download.js   # Download logic, metadata injection
│   ├── download-panel.js      # Floating progress panel
│   └── style.css              # Download icon overlay on thumbnails
├── popup/
│   ├── popup.html             # Settings UI
│   ├── popup.js               # Settings logic
│   └── popup.css              # Settings styles
└── icons/                     # Extension icons
```

## License

MIT
