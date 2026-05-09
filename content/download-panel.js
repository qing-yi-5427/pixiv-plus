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
        background: #1e1e2e;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        color: #cdd6f4;
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
        border-bottom: 1px solid #313244;
      }
      .pp-panel-header:hover { background: #252536; }
      .pp-panel-title {
        font-weight: 600;
        font-size: 13px;
      }
      .pp-panel-count {
        color: #0096fa;
        margin-left: 6px;
      }
      .pp-panel-controls {
        display: flex;
        gap: 6px;
      }
      .pp-panel-controls button {
        background: none;
        border: none;
        color: #a6adc8;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
      }
      .pp-panel-controls button:hover { color: #fff; }
      .pp-panel-body {
        overflow-y: auto;
        flex: 1;
        max-height: 280px;
        padding: 6px 0;
      }
      .pp-download-item {
        padding: 8px 14px;
        border-bottom: 1px solid #252536;
      }
      .pp-download-item:last-child { border-bottom: none; }
      .pp-download-name {
        font-size: 12px;
        color: #a6adc8;
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
        background: #313244;
        border-radius: 2px;
        overflow: hidden;
      }
      .pp-download-bar-fill {
        height: 100%;
        background: #0096fa;
        border-radius: 2px;
        transition: width 0.3s ease;
        width: 0%;
      }
      .pp-download-bar-fill.complete { background: #40c057; }
      .pp-download-bar-fill.error { background: #ff6b6b; }
      .pp-download-status {
        font-size: 11px;
        color: #6c7086;
        white-space: nowrap;
        min-width: 80px;
        text-align: right;
      }
      .pp-download-status.complete { color: #40c057; }
      .pp-download-status.error { color: #ff6b6b; }
      .pp-panel-footer {
        padding: 8px 14px;
        border-top: 1px solid #313244;
        display: flex;
        justify-content: flex-end;
      }
      .pp-panel-footer button {
        padding: 4px 12px;
        background: #313244;
        border: none;
        color: #a6adc8;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      .pp-panel-footer button:hover { background: #45475a; }

      /* Toast */
      .pp-toast {
        position: fixed;
        bottom: 430px;
        right: 20px;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        color: #fff;
        pointer-events: none;
        transform: translateX(120%);
        transition: transform 0.3s ease;
        z-index: 2147483647;
        max-width: 340px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pp-toast.visible { transform: translateX(0); }
      .pp-toast.info { background: #0096fa; }
      .pp-toast.success { background: #40c057; }
      .pp-toast.error { background: #ff6b6b; }
      .pp-toast.warning { background: #f59f00; color: #1e1e2e; }
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
      body.querySelectorAll('.pp-download-item[data-state="complete"], .pp-download-item[data-state="interrupted"]').forEach(el => el.remove());
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
      item.innerHTML = `
        <div class="pp-download-name" title="${escapeHtml(data.filename)}">${escapeHtml(data.filename)}</div>
        <div class="pp-download-bar-row">
          <div class="pp-download-bar"><div class="pp-download-bar-fill"></div></div>
          <div class="pp-download-status"></div>
        </div>
      `;
      body.appendChild(item);
      downloads.set(data.filename, item);
    }

    const fill = item.querySelector('.pp-download-bar-fill');
    const status = item.querySelector('.pp-download-status');

    if (data.state === 'in_progress') {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      const pct = data.totalBytes > 0 ? Math.round((data.bytesReceived / data.totalBytes) * 100) : 0;
      fill.style.width = `${pct}%`;
      fill.className = 'pp-download-bar-fill';
      status.className = 'pp-download-status';
      status.textContent = `${pct}% ${data.speed || ''}`;
      item.dataset.state = 'in_progress';
    } else if (data.state === 'complete') {
      fill.style.width = '100%';
      fill.className = 'pp-download-bar-fill complete';
      status.className = 'pp-download-status complete';
      status.textContent = 'Done ✓';
      item.dataset.state = 'complete';
      showToast(`Downloaded: ${data.filename}`, 'success');

      // Auto-close panel 3s after all downloads complete
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
      showToast(`Failed: ${data.filename}`, 'error');
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
