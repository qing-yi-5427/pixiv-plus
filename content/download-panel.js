// PixivPlus - Download Panel
// Floating panel in bottom-right corner showing download progress, speed, completion toasts

(() => {
  'use strict';

  let panelHost = null;
  let downloads = new Map(); // filename -> element
  let panelVisible = false;
  let autoCloseTimer = null;

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
      .pp-panel-footer {
        padding: 8px 14px;
        border-top: 1px solid rgba(255,255,255,0.06);
        display: flex;
        justify-content: flex-end;
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
    shadow.getElementById('pp-panel-clear').addEventListener('click', () => {
      const body = shadow.getElementById('pp-panel-body');
      body.querySelectorAll('.pp-download-item[data-state="in_progress"]').forEach(el => {
        const url = el.dataset.url;
        if (url) window.PixivPlusDownload?.cancelDownload(url);
      });
      body.innerHTML = '';
      downloads.clear();
      updateCount(shadow);
    });

    document.body.appendChild(panelHost);
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
        updateCount(shadow);
      });
    }

    const fill = item.querySelector('.pp-download-bar-fill');
    const status = item.querySelector('.pp-download-status');

    const actions = item.querySelector('.pp-download-actions');

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

      clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(() => {
        const active = body.querySelectorAll('.pp-download-item[data-state="in_progress"]').length;
        if (active === 0) {
          panel.classList.remove('visible');
          panelVisible = false;
        }
      }, 3000);
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

    updateCount(shadow);
  }

  function updateCount(shadow) {
    if (!shadow) shadow = panelHost?.shadowRoot;
    const body = shadow?.getElementById('pp-panel-body');
    const countEl = shadow?.getElementById('pp-panel-count');
    if (!body || !countEl) return;
    const active = body.querySelectorAll('.pp-download-item[data-state="in_progress"]').length;
    countEl.textContent = active > 0 ? `(${active})` : '';
  }

  function showToast(message, type) {
    if (!panelHost) return;
    const shadow = panelHost.shadowRoot;
    const toast = document.createElement('div');
    toast.className = `pp-toast ${type || 'info'}`;
    toast.textContent = message;
    shadow.appendChild(toast);

    // Stack toasts: each new toast goes above existing ones
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
    updateDownload
  };
})();
