// PixivPlus - Download Module
// Handles image downloading: background fetches, content script writes to file system

(() => {
  'use strict';

  let dirHandle = null;
  const activeFetches = new Map(); // url -> filename

  // --- IndexedDB for directory handle ---

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('pixivplus', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('handles')) {
          req.result.createObjectStore('handles');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDirHandle(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'downloadDir');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadDirHandle() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('downloadDir');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  // --- Directory handle management ---

  async function getDirHandle(userGesture) {
    if (dirHandle) {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return dirHandle;
      if (userGesture) {
        const req = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') return dirHandle;
      }
    }

    const stored = await loadDirHandle();
    if (stored) {
      dirHandle = stored;
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return dirHandle;
      if (userGesture) {
        const req = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') return dirHandle;
      }
    }

    if (!userGesture) return null;

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = handle;
      await saveDirHandle(handle);
      return handle;
    } catch (e) {
      return null;
    }
  }

  // --- Download logic ---

  async function downloadFile(url, filename) {
    const panel = window.PixivPlusDownloadPanel;
    activeFetches.set(url, filename);

    panel.updateDownload({
      filename,
      state: 'in_progress',
      bytesReceived: 0,
      totalBytes: 0,
      speed: 'Connecting...'
    });

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'fetchImage',
        url
      });

      activeFetches.delete(url);

      if (resp.error) throw new Error(resp.error);

      const blob = await fetch(resp.dataUrl).then(r => r.blob());

      const handle = await getDirHandle(true);
      if (handle) {
        await writeFile(handle, filename, blob);
        panel.updateDownload({ filename, state: 'complete' });
        panel.showToast(`Downloaded: ${filename}`, 'success');
        return;
      }

      await browserDownload(blob, filename);
      panel.updateDownload({ filename, state: 'complete' });
      panel.showToast(`Downloaded: ${filename}`, 'success');

    } catch (err) {
      activeFetches.delete(url);
      panel.updateDownload({
        filename,
        state: 'interrupted',
        error: err.message
      });
      panel.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function downloadWork(workId) {
    try {
      const info = await window.PixivPlusAPI.getWorkInfo(workId);
      if (info.isUgoira) {
        window.PixivPlusDownloadPanel.showToast('Ugoira not supported', 'warning');
        return;
      }
      if (info.pageCount === 1) {
        const url = info.pageUrls[0]?.original;
        if (!url) throw new Error('No URL');
        const filename = window.PixivPlusAPI.generateFilename(info, 0);
        downloadFile(url, filename);
      } else {
        showMultiImageSelector(info);
      }
    } catch (err) {
      window.PixivPlusDownloadPanel.showToast(`Error: ${err.message}`, 'error');
    }
  }

  async function writeFile(dirHandle, filename, blob) {
    const safeName = filename.replace(/[<>:"|?*]/g, '_');
    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function browserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // --- Progress listener ---

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'fetch-progress') {
      const filename = activeFetches.get(msg.url);
      if (filename) {
        window.PixivPlusDownloadPanel.updateDownload({
          filename,
          state: 'in_progress',
          bytesReceived: msg.received,
          totalBytes: msg.total,
          speed: msg.speed
        });
      }
    }
  });

  // --- Popup messages (getDirInfo, resetDir) ---

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getDirInfo') {
      (async () => {
        try {
          const handle = await getDirHandle(false);
          sendResponse({ name: handle ? handle.name : null });
        } catch {
          sendResponse({ name: null });
        }
      })();
      return true;
    }
    if (msg.type === 'resetDir') {
      dirHandle = null;
      openDB().then(db => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('downloadDir');
      }).catch(() => {});
      sendResponse({ ok: true });
    }
  });

  // --- Download icon on thumbnails ---

  function addDownloadIcon(card) {
    if (card.querySelector('.pp-download-btn')) return;
    const link = card.querySelector('a[href*="/artworks/"]')
              || (card.tagName === 'A' && card.href?.includes('/artworks/') ? card : null);
    if (!link) return;
    const workIdMatch = link.href.match(/\/artworks\/(\d+)/);
    if (!workIdMatch) return;

    const btn = document.createElement('button');
    btn.className = 'pp-download-btn';
    btn.title = 'Download original';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await downloadWork(workIdMatch[1]);
    });

    card.style.position = card.style.position || 'relative';
    card.appendChild(btn);
  }

  // --- Multi-image selector ---

  let selectorHost = null;

  function showMultiImageSelector(info) {
    if (!selectorHost) createSelectorPanel();
    const shadow = selectorHost.shadowRoot;
    const grid = shadow.getElementById('pp-selector-grid');
    const title = shadow.getElementById('pp-selector-title');
    const container = shadow.getElementById('pp-selector-container');

    title.textContent = `${info.artist} - ${info.title} (${info.pageCount} pages)`;
    grid.innerHTML = '';
    const checkboxes = [];

    for (let i = 0; i < info.pageUrls.length; i++) {
      const pageUrl = info.pageUrls[i];
      const item = document.createElement('div');
      item.className = 'pp-selector-item';
      const img = document.createElement('img');
      img.className = 'pp-selector-thumb';
      img.src = pageUrl.regular || pageUrl.original;
      img.loading = 'lazy';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'pp-selector-check';
      check.checked = true;
      check.dataset.index = i;
      checkboxes.push(check);
      const label = document.createElement('span');
      label.className = 'pp-selector-page-num';
      label.textContent = `P${i}`;
      item.appendChild(img);
      item.appendChild(check);
      item.appendChild(label);
      item.addEventListener('click', (e) => {
        if (e.target !== check) check.checked = !check.checked;
      });
      grid.appendChild(item);
    }

    shadow.getElementById('pp-btn-select-all').onclick = () => checkboxes.forEach(c => c.checked = true);
    shadow.getElementById('pp-btn-deselect-all').onclick = () => checkboxes.forEach(c => c.checked = false);
    shadow.getElementById('pp-btn-download-selected').onclick = () => {
      const selected = checkboxes.filter(c => c.checked).map(c => parseInt(c.dataset.index));
      if (selected.length === 0) return;
      for (const idx of selected) {
        const url = info.pageUrls[idx].original;
        const filename = window.PixivPlusAPI.generateFilename(info, idx);
        downloadFile(url, filename);
      }
      container.classList.remove('visible');
    };
    shadow.getElementById('pp-btn-cancel').onclick = () => container.classList.remove('visible');
    container.classList.add('visible');
  }

  function createSelectorPanel() {
    selectorHost = document.createElement('div');
    selectorHost.id = 'pp-selector-host';
    selectorHost.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;';
    const shadow = selectorHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      #pp-selector-container { position:fixed;top:0;left:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;pointer-events:auto;background:rgba(0,0,0,0.7);z-index:2147483646; }
      #pp-selector-container.visible { display:flex; }
      .pp-selector-panel { background:#1e1e2e;border-radius:12px;padding:20px;max-width:80vw;max-height:80vh;display:flex;flex-direction:column;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
      #pp-selector-title { font-size:14px;margin-bottom:12px;color:#a6adc8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw; }
      .pp-selector-actions { display:flex;gap:8px;margin-bottom:12px; }
      .pp-selector-actions button { padding:6px 14px;border:1px solid #45475a;background:#313244;color:#cdd6f4;border-radius:6px;cursor:pointer;font-size:13px; }
      .pp-selector-actions button:hover { background:#45475a; }
      #pp-selector-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;overflow-y:auto;max-height:55vh;padding:4px; }
      .pp-selector-item { position:relative;cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:border-color 0.15s; }
      .pp-selector-item:has(.pp-selector-check:checked) { border-color:#0096fa; }
      .pp-selector-thumb { width:100%;display:block;border-radius:4px;background:#181825; }
      .pp-selector-check { position:absolute;top:6px;left:6px;width:18px;height:18px;cursor:pointer;accent-color:#0096fa; }
      .pp-selector-page-num { position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.7);color:#cdd6f4;font-size:11px;padding:2px 6px;border-radius:3px; }
      .pp-selector-footer { display:flex;justify-content:flex-end;gap:8px;margin-top:16px; }
      .pp-selector-footer button { padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500; }
      #pp-btn-cancel { background:#313244;color:#cdd6f4; }
      #pp-btn-cancel:hover { background:#45475a; }
      #pp-btn-download-selected { background:#0096fa;color:#fff; }
      #pp-btn-download-selected:hover { background:#0070d0; }
    `;
    shadow.appendChild(style);
    const container = document.createElement('div');
    container.id = 'pp-selector-container';
    container.innerHTML = `
      <div class="pp-selector-panel">
        <div id="pp-selector-title"></div>
        <div class="pp-selector-actions">
          <button id="pp-btn-select-all">Select All</button>
          <button id="pp-btn-deselect-all">Deselect All</button>
        </div>
        <div id="pp-selector-grid"></div>
        <div class="pp-selector-footer">
          <button id="pp-btn-cancel">Cancel</button>
          <button id="pp-btn-download-selected">Download Selected</button>
        </div>
      </div>
    `;
    shadow.appendChild(container);
    document.body.appendChild(selectorHost);
  }

  window.PixivPlusDownload = { downloadFile, downloadWork, addDownloadIcon };
})();
