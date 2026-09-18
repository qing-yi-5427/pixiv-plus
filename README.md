# PixivPlus

Chrome 扩展插件（Manifest V3），为 Pixiv 增强悬浮预览、批量下载、图片标签写入等功能。

## 功能

### 关注动态工作台
- **双栏刷图** — 在 `bookmark_new_illust.php` 左侧浏览缩略图，右侧持续查看大图，无需反复进入作品页
- **可恢复接管** — 工作台不删除 Pixiv 原页面，可一键返回原版并随时重新打开
- **高效导航** — `J` / `K` 切换作品，方向键翻页，`Space` 进入专注模式
- **批量处理** — 支持 Shift 连选、批量下载、未读筛选和缩略图密度切换
- **原图预载** — 一键并发预载当前作品流的首张原图，也可在设置中默认自动预载
- **可调布局** — 拖动分隔线改变缩略图区宽度，布局偏好保存在本地

### 悬浮预览
- **两段式预览** — 悬浮时使用不遮挡页面的侧边预览，点击图片或按 `Space` 进入沉浸查看
- **拖拽平移** — 单击放大，拖拽移动查看细节，双击退出放大
- **多页翻页** — 通过侧栏按钮或键盘方向键（`←` `→`）浏览多页作品
- **跨作品导航** — 使用 `J` / `K` 在当前页面的作品间快速切换
- **标签面板** — 查看作品所有标签，点击可直接跳转 Pixiv 搜索
- **可调延迟** — 在设置中自定义悬浮触发延迟

### 下载
- **原图画质** — 通过后台 Service Worker 下载原图分辨率图片
- **单页 & 多页** — 多页作品弹出自定义选择面板，可勾选要下载的页面
- **Ugoira 源文件** — 保存原始帧 ZIP，并附带包含逐帧延迟的 JSON
- **文件名模板** — 使用 `{artist}`、`{title}`、`{id}`、`{page}` 自定义文件名
- **自定义目录** — 通过 File System Access API 选择任意下载文件夹
- **进度面板** — 浮动面板显示排队、下载速度和进度，支持真正取消网络请求
- **稳定批量下载** — 最多 3 个并发任务，避免大量原图同时占满内存
- **缩略图状态** — 直接显示排队、下载进度、完成和失败状态
- **快捷操作** — `D` 下载当前页，`Shift+D` 下载整组，`B` 收藏，`?` 查看帮助
- **自动关闭** — 所有下载完成后 3 秒自动收起面板

### 标签写入
- **PNG 元数据** — 通过 iTXt chunk 写入 XMP 标签（可在 Windows 属性中查看）
- **JPEG 元数据** — 通过 APP1 段写入 XMP 标签（可在 Windows 属性中查看）
- **开关控制** — 在插件设置中可开启/关闭标签写入

## 安装

1. 下载或克隆本仓库
2. 在 Edge 中打开 `edge://extensions/`（Chrome 使用 `chrome://extensions/`）
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `pixiv-plus` 文件夹

发布包可通过 `npm run release:check` 生成到 `dist/`；该命令会先运行测试、清单/权限/CSP/远程代码检查，再生成 ZIP 与 SHA-256 校验文件。

## 设置

点击浏览器工具栏中的 PixivPlus 图标打开设置弹窗；点击「展开」或工作台右上角的齿轮可打开完整设置页。设置分为「浏览」「下载」「文件命名」，跟随系统浅色／深色模式。

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 悬浮预览 | 开启 | 开启/关闭悬浮预览功能 |
| 关注动态工作台 | 开启 | 在关注作品页使用双栏浏览工作台 |
| 默认预载当前页原图 | 关闭 | 进入工作台后自动预载当前作品流中每个作品的首张原图 |
| 预览延迟 | 400ms | 悬浮触发延迟时间 |
| 写入图片标签 | 开启 | 将 Pixiv 标签写入下载图片的元数据 |
| 文件名模板 | `{artist}-{title}-{id}` | 下载文件的命名模板 |

设置页同时提供中英文界面，并可调整作品流密度和宽度、原图预载、预览方式、下载并发数、重复文件策略和多图默认行为。改动自动保存，底栏会显示真实保存结果；文件名模板提供单图／多图预览与变量插入，无效模板不会保存。目录在工作台右上角的文件夹按钮选择，「忘记目录」只清除授权引用，不删除已下载文件。

开发时可运行 `node scripts/preview-settings.mjs`，访问终端显示的本地地址测试设置 UI。该页面使用独立的模拟存储，不连接真实扩展、下载目录或 Pixiv 账号；真实扩展联调仍需在浏览器扩展管理页重新加载。

## 技术栈

- **Manifest V3** Chrome 扩展
- **Shadow DOM** 隔离注入 UI 样式
- **Background Service Worker** 绕过 CORS 获取图片
- **declarativeNetRequest** 为 `i.pximg.net` 注入 Referer 请求头
- **File System Access API** 下载到任意目录
- **分块消息流** 在 Service Worker 和 Content Script 间传输图片，避免整图 Data URL 的内存峰值

## 文件结构

```
pixiv-plus/
├── manifest.json              # Manifest V3 配置
├── rules.json                 # declarativeNetRequest Referer 规则
├── background/
│   └── service-worker.js      # 设置接口、图片下载与进度上报
├── lib/
│   ├── workbench-model.js     # 关注动态作品去重、排序与状态模型
│   └── pixiv-api.js           # /ajax/illust/{id} 封装、缓存、文件名生成
├── content/
│   ├── main.js                # 入口、MutationObserver 扫描缩略图
│   ├── hover-preview.js       # 悬浮预览面板
│   ├── bookmark-download.js   # 下载逻辑、元数据注入
│   ├── download-panel.js      # 下载进度面板
│   ├── workbench.js           # 关注动态双栏工作台
│   └── style.css              # 缩略图上的下载图标样式
├── popup/
│   ├── popup.html             # 设置页面
│   ├── popup.js               # 设置逻辑
│   └── popup.css              # 设置样式
└── icons/                     # 扩展图标
```

## License

MIT

隐私政策与发布说明分别见 [PRIVACY.md](PRIVACY.md)、[STORE_LISTING.md](STORE_LISTING.md) 和 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。
