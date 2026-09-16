# Store Listing Copy

## Single purpose

PixivPlus improves browsing artwork on Pixiv and lets users save the original files they explicitly select through a reliable, visible download queue.

## Permission justifications

- **storage** — Saves extension preferences and download history locally so status and duplicate detection remain available across Pixiv tabs and browser restarts.
- **declarativeNetRequest** — Adds the Pixiv Referer header required by `i.pximg.net`; the bundled rule is limited to Pixiv image requests.
- **www.pixiv.net host access** — Reads the metadata for artwork the user is viewing and injects the preview/download interface on Pixiv pages.
- **i.pximg.net host access** — Retrieves thumbnails, original images, and Ugoira source archives that the user chooses to preview or download.

## Remote code declaration

No. PixivPlus does not download or execute remotely hosted JavaScript, WebAssembly, CSS, or executable code. All extension code is included in the submitted Manifest V3 package.

## Data usage declaration

PixivPlus does not collect, sell, or transmit user data to the developer or any analytics, advertising, or telemetry service. Preferences, directory access, and download history are stored locally. Network requests go only to Pixiv domains and use the user's existing Pixiv session to provide the requested functionality.

## English listing

### Short description

Browse Pixiv in a fast side preview and reliably download original images, multi-page works, and Ugoira source files.

### Description

PixivPlus is a focused browsing and download companion for Pixiv. Hover over an artwork to open a non-blocking side preview, click or press Space for an immersive viewer, and navigate pages and nearby works without repeatedly leaving the feed. Keyboard shortcuts make it easy to bookmark or save the current page while browsing.

Downloads run through a visible queue with bounded concurrency, real cancellation, retry, duplicate detection, filename templates, optional Pixiv tag metadata, and persistent history. Multi-page works include page selection, format and resolution details, Shift range selection, and estimated download size. Ugoira works can be saved as the original frame ZIP together with frame timing JSON.

PixivPlus contains no advertising, analytics, tracking, or remotely hosted code. Settings and download history remain on your device.

### Search terms

Pixiv, artwork, image downloader, original image, illustration, Ugoira, gallery

## 简体中文商店文案

### 简短说明

使用侧边预览快速浏览 Pixiv，并可靠下载原图、多图作品及 Ugoira 动图源文件。

### 详细说明

PixivPlus 是一个专注于 Pixiv 浏览与原图下载的浏览器扩展。将鼠标悬停在作品上即可打开不遮挡页面的侧边预览，点击图片或按 Space 进入沉浸查看模式，并可通过键盘连续浏览作品、翻页、收藏和下载，不必频繁离开信息流。

所有下载都进入可见的任务队列，支持并发限制、真正取消、失败重试、重复文件检测、文件名模板、可选标签元数据以及本地下载历史。多图作品支持页面选择、格式和分辨率信息、Shift 连选以及预计下载体积。Ugoira 动图可保存原始帧 ZIP 和对应的帧延迟 JSON。

PixivPlus 不包含广告、分析、追踪或远程托管代码。设置和下载历史均保存在用户设备本地。

### 搜索关键词

Pixiv、原图下载、插画、图片下载、动图、Ugoira、画廊

## Store assets checklist

- 300×300 square logo based on `icons/icon128.png`.
- At least three screenshots at a consistent 1280×800 or 1366×768 size:
  1. side preview over a Pixiv feed;
  2. immersive viewer with keyboard guide;
  3. multi-page selector and download queue;
  4. bilingual settings page (optional fourth screenshot).
- Screenshots must not expose account names, private bookmarks, or mature artwork.
