// Shared extension-only UI strings, focus isolation and modal navigation.
(() => {
  'use strict';
  const zh = chrome.i18n.getUILanguage().startsWith('zh');
  const words = {
    'Downloads': '下载', 'Download': '下载', 'Download History': '下载历史',
    'No download history': '暂无下载历史', 'History': '历史', 'Show More': '查看历史',
    'Queued': '排队中', 'Connecting...': '连接中…', 'Saving...': '保存中…',
    'Done': '已完成', 'Failed': '失败', 'Cancelled': '已取消', 'Cached': '使用缓存',
    'Cancel': '取消', 'Retry': '重试', 'Remove': '移除', 'Clear': '清理列表',
    'Close': '关闭', 'Minimize': '收起', 'Cancel all': '全部取消',
    'Pause queued downloads': '暂停排队任务', 'Resume queued downloads': '继续排队任务',
    'Choose download folder': '选择下载目录', 'Folder': '目录', 'not selected': '未选择',
    'Select All': '全选', 'First Only': '仅第一页', 'First Page': '仅第一页', 'Invert': '反选', 'Deselect All': '取消全选',
    'Download Selected': '下载所选页面', 'Selected': '已选择', 'pages': '页',
    'Expand download queue': '展开下载队列', 'Collapse download queue': '收起下载队列',
    'Choose a download folder before downloading': '请先选择下载目录',
    'Could not save download history': '下载历史保存失败',
    'File exists; nothing was overwritten': '文件已存在，未覆盖任何文件',
    'Download failed': '下载失败', 'Download connection closed': '下载连接已断开',
    'Could not allocate a unique filename': '无法分配不重复的文件名',
    'Ugoira ZIP unavailable': '动图源文件不可用', 'Partial save': '部分文件已保存',
    'Loading': '加载中', 'Previous artwork': '上一件作品', 'Next artwork': '下一件作品',
    'Previous page': '上一页', 'Next page': '下一页', 'Zoom out': '缩小',
    'Zoom in': '放大', 'Reset zoom': '重置缩放', 'Artwork details': '作品信息',
    'Filter artworks': '筛选作品', 'Resize artwork feed': '调整作品流宽度',
    'Artwork thumbnails': '作品缩略图', 'Feed pagination': '作品流分页',
    'Resize thumbnail browser': '调整缩略图区域宽度', 'Change thumbnail density': '切换缩略图密度',
    'Select multiple artworks': '选择多件作品', 'PixivPlus Workbench': 'PixivPlus 工作台'
  };
  const prefixes = {
    'Folder access failed: ': '目录访问失败：', 'Download folder: ': '下载目录：',
    'Could not select folder: ': '无法选择目录：', 'File exists or is already queued: ': '文件已存在或已排队：',
    'File already exists: ': '文件已存在：', 'Previously saved file changed; retry stopped: ': '已保存文件发生变化，已停止重试：',
    'Partial save: ': '部分文件已保存：', 'Folder: ': '目录：', 'History (': '历史（',
    'Selected ': '已选择 ', 'HTTP ': '请求失败 HTTP '
  };
  function t(value) {
    const text = String(value);
    if (!zh) return text;
    if (words[text]) return words[text];
    for (const [prefix, translated] of Object.entries(prefixes)) {
      if (text.startsWith(prefix)) return translated + (text.slice(prefix.length) === 'not selected' ? words['not selected'] : text.slice(prefix.length));
    }
    return text.replace(/Connecting\.\.\.|Saving\.\.\.|Queued|Cached|not selected| pages\)/g, match => match === ' pages)' ? ' 页)' : words[match] || match);
  }
  function localize(root) {
    if (!zh || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (['STYLE', 'SCRIPT'].includes(node.parentElement?.tagName)) continue;
      if (node.parentElement?.closest('.pp-download-name, .pp-history-card-title, .pp-history-card-artist')) continue;
      const value = node.textContent;
      const trimmed = value.trim();
      const translated = t(trimmed);
      if (trimmed && trimmed !== translated) node.textContent = value.replace(trimmed, translated);
    }
    for (const element of root.querySelectorAll('[title], [aria-label]')) {
      for (const attribute of ['title', 'aria-label']) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
      }
    }
  }

  const nativeInert = new Map();
  let observer;
  const isExtensionRoot = node => ['pp-panel-host', 'pp-selector-host', 'pixivplus-workbench-host'].includes(node.id);
  function setWorkbenchActive(active) {
    if (!document.body) return;
    if (!active) {
      observer?.disconnect(); observer = null;
      for (const [node, value] of nativeInert) node.inert = value;
      nativeInert.clear(); return;
    }
    const isolate = () => {
      for (const node of document.body.children) {
        if (isExtensionRoot(node) || nativeInert.has(node)) continue;
        nativeInert.set(node, node.inert); node.inert = true;
      }
    };
    isolate();
    if (!observer) { observer = new MutationObserver(isolate); observer.observe(document.body, { childList: true }); }
  }

  let activeDialog = null;
  function openDialog(container, close) {
    activeDialog?.();
    const previous = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
    const changed = new Map();
    const candidates = [...document.body.children, ...document.documentElement.children, ...container.getRootNode().children];
    for (const node of candidates) {
      if (changed.has(node)) continue;
      if (['HEAD', 'BODY', 'STYLE', 'SCRIPT'].includes(node.tagName) || node === container || node.contains(container)) continue;
      if (node.shadowRoot === container.getRootNode()) continue;
      changed.set(node, node.inert); node.inert = true;
    }
    const focusable = () => [...container.querySelectorAll('button, input, select, a[href], [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const finish = () => {
      container.removeEventListener('keydown', keydown);
      for (const [node, value] of changed) node.inert = value;
      activeDialog = null; close(); previous?.focus();
    };
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
      if (event.key === 'Tab') {
        const nodes = focusable();
        const current = event.composedPath()[0];
        if (!nodes.length) { event.preventDefault(); return; }
        if (event.shiftKey && (current === nodes[0] || !nodes.includes(current))) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && (current === nodes.at(-1) || !nodes.includes(current))) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    container.setAttribute('role', 'dialog'); container.setAttribute('aria-modal', 'true');
    container.addEventListener('keydown', keydown);
    activeDialog = finish;
    focusable()[0]?.focus();
    return finish;
  }
  window.PixivPlusUI = { t, localize, setWorkbenchActive, openDialog, isDialogOpen: () => Boolean(activeDialog) };
})();
