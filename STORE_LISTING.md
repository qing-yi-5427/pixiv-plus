# Store Listing Copy

## Single purpose

PixivPlus turns Pixiv's followed-artworks feed into a split-view workbench and lets users save the original files they explicitly select through a reliable, visible download queue.

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

Browse Pixiv in a split-view workbench and reliably download original images, multi-page works, and Ugoira source files.

### Description

PixivPlus is a focused browsing and download companion for Pixiv. Its following-feed workbench places a resizable thumbnail browser on the left and a large, original-ratio preview on the right. It supports persistent unread state, density controls, range selection, keyboard navigation, focus mode, and manual or automatic preloading of each artwork's first original image on the current feed page. Settings are organized around browsing, downloads, and file naming.

Downloads run through a visible queue with bounded concurrency, real cancellation, retry, duplicate detection, filename templates, optional Pixiv tag metadata, and persistent history. Multi-page works include page selection, format and resolution details, Shift range selection, and estimated download size. Ugoira works can be saved as the original frame ZIP together with frame timing JSON.

PixivPlus contains no advertising, analytics, tracking, or remotely hosted code. Settings and download history remain on your device.

### Search terms

Pixiv, artwork, image downloader, original image, illustration, Ugoira, gallery

## 简体中文商店文案

### 简短说明

使用双栏工作台快速浏览 Pixiv，并可靠下载原图、多图作品及 Ugoira 动图源文件。

### 详细说明

PixivPlus 是一个专注于 Pixiv 浏览与原图下载的浏览器扩展。关注动态工作台将缩略图浏览器放在左侧，将大幅原比例预览放在右侧，支持持久已读状态、未读筛选、密度调整、Shift 连选、键盘导航和专注模式。可一键加载当前作品流每个作品的首张原图，也可设置为自动加载。设置页围绕浏览、下载与文件命名组织。

所有下载都进入可见的任务队列，支持并发限制、真正取消、失败重试、重复文件检测、文件名模板、可选标签元数据以及本地下载历史。多图作品支持页面选择、格式和分辨率信息、Shift 连选以及预计下载体积。Ugoira 动图可保存原始帧 ZIP 和对应的帧延迟 JSON。

PixivPlus 不包含广告、分析、追踪或远程托管代码。设置和下载历史均保存在用户设备本地。

### 搜索关键词

Pixiv、原图下载、插画、图片下载、动图、Ugoira、画廊

## Store assets checklist

- 300×300 square logo based on `icons/icon128.png`.
- At least three screenshots at a consistent 1280×800 or 1366×768 size:
  1. split-view following-feed workbench;
  2. workbench focus mode with keyboard guide;
  3. multi-page selector and download queue;
  4. bilingual settings page (optional fourth screenshot).
- Screenshots must not expose account names, private bookmarks, or mature artwork.
