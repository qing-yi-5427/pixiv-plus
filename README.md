# PixivPlus

Chrome 扩展插件（Manifest V3），为 Pixiv 增强悬浮预览、批量下载、图片标签写入等功能。

## 功能

### 悬浮预览
- **原图预览** — 鼠标悬停缩略图即可在深色面板中查看原图
- **拖拽平移** — 单击放大，拖拽移动查看细节，双击退出放大
- **多页翻页** — 通过侧栏按钮或键盘方向键（`←` `→`）浏览多页作品
- **跨作品导航** — 在当前页面的作品间快速切换
- **标签面板** — 查看作品所有标签，点击可直接跳转 Pixiv 搜索
- **可调延迟** — 在设置中自定义悬浮触发延迟

### 下载
- **原图画质** — 通过后台 Service Worker 下载原图分辨率图片
- **单页 & 多页** — 多页作品弹出自定义选择面板，可勾选要下载的页面
- **文件名模板** — 使用 `{artist}`、`{title}`、`{id}`、`{page}` 自定义文件名
- **自定义目录** — 通过 File System Access API 选择任意下载文件夹
- **进度面板** — 浮动面板显示下载速度、进度条，支持取消和删除
- **自动关闭** — 所有下载完成后 3 秒自动收起面板

### 标签写入
- **PNG 元数据** — 通过 iTXt chunk 写入 XMP 标签（可在 Windows 属性中查看）
- **JPEG 元数据** — 通过 APP1 段写入 XMP 标签（可在 Windows 属性中查看）
- **开关控制** — 在插件设置中可开启/关闭标签写入

## 安装

1. 下载或克隆本仓库
2. 在 Chrome 中打开 `chrome://extensions/`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `pixiv-plus` 文件夹

## 设置

点击 Chrome 工具栏中的 PixivPlus 图标打开设置：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 悬浮预览 | 开启 | 开启/关闭悬浮预览功能 |
| 预览延迟 | 400ms | 悬浮触发延迟时间 |
| 写入图片标签 | 开启 | 将 Pixiv 标签写入下载图片的元数据 |
| 文件名模板 | `{artist}-{title}-{id}` | 下载文件的命名模板 |

## 技术栈

- **Manifest V3** Chrome 扩展
- **Shadow DOM** 隔离注入 UI 样式
- **Background Service Worker** 绕过 CORS 获取图片
- **declarativeNetRequest** 为 `i.pximg.net` 注入 Referer 请求头
- **File System Access API** 下载到任意目录
- **Base64 Data URL** 在 Service Worker 和 Content Script 间传输图片数据

## 文件结构

```
pixiv-plus/
├── manifest.json              # Manifest V3 配置
├── rules.json                 # declarativeNetRequest Referer 规则
├── background/
│   └── service-worker.js      # 设置接口、图片下载与进度上报
├── lib/
│   └── pixiv-api.js           # /ajax/illust/{id} 封装、缓存、文件名生成
├── content/
│   ├── main.js                # 入口、MutationObserver 扫描缩略图
│   ├── hover-preview.js       # 悬浮预览面板
│   ├── bookmark-download.js   # 下载逻辑、元数据注入
│   ├── download-panel.js      # 下载进度面板
│   └── style.css              # 缩略图上的下载图标样式
├── popup/
│   ├── popup.html             # 设置页面
│   ├── popup.js               # 设置逻辑
│   └── popup.css              # 设置样式
└── icons/                     # 扩展图标
```

## License

MIT
