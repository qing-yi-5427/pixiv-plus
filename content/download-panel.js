// PixivPlus - Download Panel
// Floating panel showing active downloads only; history modal via Show More

(() => {
  'use strict';

  let panelHost = null;
  let downloads = new Map(); // filename -> element
  let metaStore = new Map(); // filename -> { thumbUrl, title, artist }
  let panelVisible = false;
  let autoCloseTimer = null;
  let history = [];

  const MAX_HISTORY = 100;
  const STORAGE_KEY = 'pp_download_history';

  function init() {
    panelHost = document.createElement('div');
    panelHost.id = 'pp-panel-host';
    panelHost.style.cssText = 'position:fixed;bottom:0;right:0;width:100%;height:100%;pointer-events:none;z-index:2147483649;';
    const shadow = panelHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .pp-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 340px;
        max-height: 400px;
        background: #0a0a0c;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1);
        color: #EDEDEF;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        display: none;
        flex-direction: column;
        pointer-events: auto;
        overflow: hidden;
      }
      .pp-panel.visible { display: flex; }
      .pp-panel.minimized .pp-panel-body,
      .pp-panel.minimized .pp-panel-footer { display: none; }
      .pp-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .pp-panel-header:hover { background: rgba(255,255,255,0.04); }
      .pp-panel-title {
        font-weight: 600;
        font-size: 13px;
      }
      .pp-panel-count {
        color: #5E6AD2;
        margin-left: 6px;
      }
      .pp-panel-controls {
        display: flex;
        gap: 6px;
      }
      .pp-panel-controls button {
        background: none;
        border: none;
        color: #8A8F98;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .pp-panel-controls button:hover { color: #EDEDEF; background: rgba(255,255,255,0.06); }
      .pp-panel-body {
        overflow-y: auto;
        flex: 1;
        max-height: 280px;
        padding: 6px 0;
      }
      .pp-download-item {
        padding: 8px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .pp-download-item:last-child { border-bottom: none; }
      .pp-download-name {
        font-size: 12px;
        color: #8A8F98;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-bottom: 6px;
      }
      .pp-download-bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pp-download-bar {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        overflow: hidden;
      }
      .pp-download-bar-fill {
        height: 100%;
        background: #5E6AD2;
        border-radius: 2px;
        transition: width 0.3s ease;
        width: 0%;
      }
      .pp-download-bar-fill.complete { background: rgba(94,106,210,0.6); }
      .pp-download-bar-fill.error { background: rgba(255,107,107,0.7); }
      .pp-download-status {
        font-size: 11px;
        color: #5A5F6A;
        white-space: nowrap;
        min-width: 80px;
        text-align: right;
      }
      .pp-download-status.complete { color: #5E6AD2; }
      .pp-download-status.cancelled { color: #8A8F98; }
      .pp-download-status.error { color: rgba(255,107,107,0.8); }
      .pp-download-actions {
        display: flex;
        gap: 4px;
        margin-left: 6px;
        flex-shrink: 0;
      }
      .pp-download-actions button {
        background: none;
        border: none;
        color: #5A5F6A;
        cursor: pointer;
        padding: 2px 4px;
        font-size: 14px;
        line-height: 1;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .pp-download-actions button:hover { color: #EDEDEF; background: rgba(255,255,255,0.08); }

      /* Footer */
      .pp-panel-footer {
        padding: 8px 14px;
        border-top: 1px solid rgba(255,255,255,0.06);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .pp-panel-footer button {
        padding: 6px 14px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        color: #8A8F98;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.15s, color 0.15s;
      }
      .pp-panel-footer button:hover { background: rgba(255,255,255,0.1); color: #EDEDEF; }
      .pp-show-more {
        background: rgba(94,106,210,0.12) !important;
        border-color: rgba(94,106,210,0.2) !important;
        color: #5E6AD2 !important;
      }
      .pp-show-more:hover { background: rgba(94,106,210,0.22) !important; }

      /* History modal */
      .pp-history-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        animation: pp-hist-in 0.2s cubic-bezier(0.16,1,0.3,1);
        z-index: 2147483648;
      }
      .pp-history-overlay.visible { display: flex; }
      @keyframes pp-hist-in { from { opacity:0; } to { opacity:1; } }
      .pp-history-panel {
        background: #0a0a0c;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1);
        padding: 20px;
        max-width: 720px;
        width: 90vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        color: #EDEDEF;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        animation: pp-hist-panel-in 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      @keyframes pp-hist-panel-in {
        from { opacity:0; transform:scale(0.95) translateY(8px); }
        to { opacity:1; transform:scale(1) translateY(0); }
      }
      .pp-history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .pp-history-title {
        font-size: 15px;
        font-weight: 600;
        color: #EDEDEF;
      }
      .pp-history-count {
        font-size: 12px;
        color: #5A5F6A;
        margin-left: 8px;
        font-weight: 400;
      }
      .pp-history-close {
        background: none;
        border: none;
        color: #8A8F98;
        cursor: pointer;
        font-size: 18px;
        padding: 4px 8px;
        border-radius: 6px;
        transition: color 0.15s, background 0.15s;
      }
      .pp-history-close:hover { color: #EDEDEF; background: rgba(255,255,255,0.06); }
      .pp-history-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 10px;
        overflow-y: auto;
        flex: 1;
        padding: 4px;
      }
      .pp-history-card {
        border-radius: 8px;
        overflow: hidden;
        background: #111114;
        border: 1px solid rgba(255,255,255,0.04);
        transition: border-color 0.15s, transform 0.15s;
      }
      .pp-history-card:hover { border-color: rgba(255,255,255,0.1); transform: translateY(-1px); }
      .pp-history-card-thumb {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
        background: #0a0a0c;
      }
      .pp-history-card-placeholder {
        width: 100%;
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111114;
        color: #3A3F4A;
        font-size: 24px;
      }
      .pp-history-card-info {
        padding: 6px 8px;
      }
      .pp-history-card-title {
        font-size: 11px;
        color: #8A8F98;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pp-history-card-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 3px;
      }
      .pp-history-card-artist {
        font-size: 10px;
        color: #5A5F6A;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        margin-right: 6px;
      }
      .pp-history-card-state {
        font-size: 10px;
        flex-shrink: 0;
      }
      .pp-history-card-state.complete { color: #5E6AD2; }
      .pp-history-card-state.cancelled { color: #8A8F98; }
      .pp-history-card-state.error { color: rgba(255,107,107,0.8); }
      .pp-history-empty {
        grid-column: 1 / -1;
        text-align: center;
        color: #5A5F6A;
        font-size: 13px;
        padding: 40px 0;
      }

      /* Toast */
      .pp-toast {
        position: fixed;
        bottom: 20px;
        right: 380px;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        color: #EDEDEF;
        pointer-events: none;
        transform: translateX(120%);
        transition: transform 0.3s cubic-bezier(0.16,1,0.3,1);
        z-index: 2147483647;
        max-width: 340px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .pp-toast.visible { transform: translateX(0); }
      .pp-toast.info { background: rgba(14,14,17,0.95); border-color: rgba(94,106,210,0.3); }
      .pp-toast.success { background: rgba(14,14,17,0.95); border-color: rgba(94,106,210,0.5); }
      .pp-toast.error { background: rgba(14,14,17,0.95); border-color: rgba(255,107,107,0.3); }
      .pp-toast.warning { background: rgba(14,14,17,0.95); border-color: rgba(255,180,50,0.3); }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'pp-panel';
    panel.id = 'pp-download-panel';
    panel.innerHTML = `
      <div class="pp-panel-header" id="pp-panel-header">
        <span><span class="pp-panel-title">Downloads</span><span class="pp-panel-count" id="pp-panel-count"></span></span>
        <div class="pp-panel-controls">
          <button id="pp-panel-minimize" title="Minimize">_</button>
          <button id="pp-panel-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="pp-panel-body" id="pp-panel-body"></div>
      <div class="pp-panel-footer">
        <button id="pp-show-more" class="pp-show-more" style="display:none;">Show More</button>
        <button id="pp-panel-clear">Clear</button>
      </div>
    `;
    shadow.appendChild(panel);

    // Events
    shadow.getElementById('pp-panel-header').addEventListener('click', () => {
      panel.classList.toggle('minimized');
    });
    shadow.getElementById('pp-panel-close').addEventListener('click', () => {
      panel.classList.remove('visible');
      panelVisible = false;
    });
    shadow.getElementById('pp-show-more').addEventListener('click', () => {
      showHistoryModal(shadow);
    });
    shadow.getElementById('pp-panel-clear').addEventListener('click', () => {
      const body = shadow.getElementById('pp-panel-body');
      body.querySelectorAll('.pp-download-item[data-state="in_progress"]').forEach(el => {
        const url = el.dataset.url;
        if (url) window.PixivPlusDownload?.cancelDownload(url);
      });
      body.innerHTML = '';
      downloads.clear();
      metaStore.clear();
      updateCount(shadow);
    });

    document.body.appendChild(panelHost);
    loadHistory();
  }

  function updateDownload(data, shadow) {
    if (!shadow) shadow = panelHost?.shadowRoot;
    if (!shadow) return;

    const panel = shadow.getElementById('pp-download-panel');
    const body = shadow.getElementById('pp-panel-body');

    if (!panelVisible) {
      panel.classList.add('visible');
      panelVisible = true;
    }

    // Ensure panel host is last in DOM so it renders above hover preview
    if (panelHost.nextElementSibling) {
      document.body.appendChild(panelHost);
    }

    // Store metadata when first seen (in_progress with thumbUrl/title/artist)
    if (data.thumbUrl || data.title || data.artist) {
      const existing = metaStore.get(data.filename);
      metaStore.set(data.filename, {
        thumbUrl: data.thumbUrl || existing?.thumbUrl || '',
        title: data.title || existing?.title || '',
        artist: data.artist || existing?.artist || ''
      });
    }

    let item = downloads.get(data.filename);
    if (!item) {
      item = document.createElement('div');
      item.className = 'pp-download-item';
      item.dataset.url = data.url || '';
      item.innerHTML = `
        <div class="pp-download-name" title="${escapeHtml(data.filename)}">${escapeHtml(data.filename)}</div>
        <div class="pp-download-bar-row">
          <div class="pp-download-bar"><div class="pp-download-bar-fill"></div></div>
          <div class="pp-download-status"></div>
          <div class="pp-download-actions">
            <button class="pp-dl-cancel" title="Cancel">&#10005;</button>
            <button class="pp-dl-remove" title="Remove">&#128465;</button>
          </div>
        </div>
      `;
      body.appendChild(item);
      downloads.set(data.filename, item);

      // Cancel button
      item.querySelector('.pp-dl-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url && item.dataset.state === 'in_progress') {
          window.PixivPlusDownload?.cancelDownload(url);
        }
        item.remove();
        downloads.delete(data.filename);
        metaStore.delete(data.filename);
        updateCount(shadow);
      });

      // Remove button
      item.querySelector('.pp-dl-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url && item.dataset.state === 'in_progress') {
          window.PixivPlusDownload?.cancelDownload(url);
        }
        item.remove();
        downloads.delete(data.filename);
        metaStore.delete(data.filename);
        updateCount(shadow);
      });
    }

    const fill = item.querySelector('.pp-download-bar-fill');
    const status = item.querySelector('.pp-download-status');
    const actions = item.querySelector('.pp-download-actions');
    const prevState = item.dataset.state || null;

    if (data.state === 'in_progress') {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      const pct = data.totalBytes > 0 ? Math.round((data.bytesReceived / data.totalBytes) * 100) : 0;
      fill.style.width = `${pct}%`;
      fill.className = 'pp-download-bar-fill';
      status.className = 'pp-download-status';
      status.textContent = `${pct}% ${data.speed || ''}`;
      item.dataset.state = 'in_progress';
      if (actions) actions.style.display = '';
    } else if (data.state === 'complete') {
      fill.style.width = '100%';
      fill.className = 'pp-download-bar-fill complete';
      status.className = 'pp-download-status complete';
      status.textContent = 'Done';
      item.dataset.state = 'complete';
      if (actions) actions.style.display = 'none';
    } else if (data.state === 'interrupted') {
      fill.className = 'pp-download-bar-fill error';
      status.className = 'pp-download-status error';
      status.textContent = data.error || 'Failed';
      item.dataset.state = 'interrupted';
      if (actions) actions.style.display = 'none';
    } else if (data.state === 'cancelled') {
      fill.className = 'pp-download-bar-fill error';
      status.className = 'pp-download-status cancelled';
      status.textContent = 'Cancelled';
      item.dataset.state = 'cancelled';
      if (actions) actions.style.display = 'none';
    }

    // Move completed item to history and remove from panel
    if (['complete', 'interrupted', 'cancelled'].includes(data.state) && prevState === 'in_progress') {
      const meta = metaStore.get(data.filename) || {};
      addToHistory(data, meta);
      metaStore.delete(data.filename);

      setTimeout(() => {
        item.remove();
        downloads.delete(data.filename);
        updateCount(shadow);
        updateShowMoreButton(shadow);
      }, 800);

      updateShowMoreButton(shadow);

      // Auto-hide panel when all downloads finished
      clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(() => {
        const body = shadow.getElementById('pp-panel-body');
        const active = body?.querySelectorAll('.pp-download-item[data-state="in_progress"]').length || 0;
        if (active === 0) {
          panel.classList.remove('visible');
          panelVisible = false;
        }
      }, 3000);
    }

    updateCount(shadow);
  }

  function addToHistory(data, meta) {
    history.unshift({
      filename: data.filename,
      thumbUrl: meta.thumbUrl || '',
      title: meta.title || '',
      artist: meta.artist || '',
      state: data.state,
      error: data.error || '',
      timestamp: Date.now()
    });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory();
  }

  function loadHistory() {
    chrome.storage.local.get(STORAGE_KEY, result => {
      if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
        history = result[STORAGE_KEY];
        updateShowMoreButton(panelHost?.shadowRoot);
      }
    });
  }

  function saveHistory() {
    chrome.storage.local.set({ [STORAGE_KEY]: history });
  }

  function isDuplicate(filename) {
    return history.some(h => h.filename === filename && h.state === 'complete');
  }

  function updateShowMoreButton(shadow) {
    if (!shadow) shadow = panelHost?.shadowRoot;
    const btn = shadow?.getElementById('pp-show-more');
    if (!btn) return;
    if (history.length > 0) {
      btn.style.display = '';
      btn.textContent = `History (${history.length})`;
    } else {
      btn.style.display = 'none';
    }
  }

  function updateCount(shadow) {
    if (!shadow) shadow = panelHost?.shadowRoot;
    const body = shadow?.getElementById('pp-panel-body');
    const countEl = shadow?.getElementById('pp-panel-count');
    if (!body || !countEl) return;
    const active = body.querySelectorAll('.pp-download-item[data-state="in_progress"]').length;
    countEl.textContent = active > 0 ? `(${active})` : '';
  }

  function showHistoryModal(shadow) {
    if (!shadow) shadow = panelHost?.shadowRoot;
    if (!shadow) return;

    let overlay = shadow.getElementById('pp-history-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'pp-history-overlay';
      overlay.id = 'pp-history-overlay';
      overlay.innerHTML = `
        <div class="pp-history-panel">
          <div class="pp-history-header">
            <span><span class="pp-history-title">Download History</span><span class="pp-history-count" id="pp-history-count"></span></span>
            <button class="pp-history-close" id="pp-history-close">&times;</button>
          </div>
          <div class="pp-history-grid" id="pp-history-grid"></div>
        </div>
      `;
      shadow.appendChild(overlay);

      shadow.getElementById('pp-history-close').addEventListener('click', () => {
        overlay.classList.remove('visible');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('visible');
      });
    }

    // Populate grid
    const grid = shadow.getElementById('pp-history-grid');
    const countEl = shadow.getElementById('pp-history-count');
    grid.innerHTML = '';

    if (history.length === 0) {
      grid.innerHTML = '<div class="pp-history-empty">No download history</div>';
    } else {
      for (const item of history) {
        const card = document.createElement('div');
        card.className = 'pp-history-card';

        const thumbHtml = item.thumbUrl
          ? `<img class="pp-history-card-thumb" src="${escapeHtml(item.thumbUrl)}" loading="lazy" onerror="this.outerHTML='<div class=\\'pp-history-card-placeholder\\'>&#128444;</div>'">`
          : `<div class="pp-history-card-placeholder">&#128444;</div>`;

        const stateLabel = item.state === 'complete' ? 'Done'
          : item.state === 'interrupted' ? 'Failed'
          : 'Cancelled';

        card.innerHTML = `
          ${thumbHtml}
          <div class="pp-history-card-info">
            <div class="pp-history-card-title" title="${escapeHtml(item.title || item.filename)}">${escapeHtml(item.title || item.filename)}</div>
            <div class="pp-history-card-meta">
              <span class="pp-history-card-artist">${escapeHtml(item.artist || '')}</span>
              <span class="pp-history-card-state ${item.state}">${stateLabel}</span>
            </div>
          </div>
        `;
        grid.appendChild(card);
      }
    }

    if (countEl) countEl.textContent = `(${history.length})`;
    overlay.classList.add('visible');
  }

  function showToast(message, type) {
    if (!panelHost) return;
    const shadow = panelHost.shadowRoot;
    const toast = document.createElement('div');
    toast.className = `pp-toast ${type || 'info'}`;
    toast.textContent = message;
    shadow.appendChild(toast);

    const existingToasts = shadow.querySelectorAll('.pp-toast.visible');
    const offset = existingToasts.length * 52;
    toast.style.bottom = (20 + offset) + 'px';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('visible');
      });
    });

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.PixivPlusDownloadPanel = {
    init,
    showToast,
    updateDownload,
    isDuplicate
  };
})();
