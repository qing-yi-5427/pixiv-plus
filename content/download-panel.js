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
  let sessionTotal = 0;
  let sessionFinished = 0;
  const sessionFiles = new Set();

  const MAX_HISTORY = 100;
  const STORAGE_KEY = 'pp_download_history';

  function init() {
    if (panelHost) return;
    panelHost = document.createElement('div');
    panelHost.id = 'pp-panel-host';
    panelHost.style.cssText = 'position:fixed;bottom:0;right:0;width:100%;height:100%;pointer-events:none;z-index:2147483649;';
    panelHost.dataset.workbench = window.PixivPlusWorkbench?.isActive() ? 'true' : 'false';
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
      .pp-panel.minimized { width:auto;min-width:220px;border-radius:999px; }
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
      .pp-panel-summary { color:#5A5F6A;font-size:11px;margin-left:8px; }
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
      .pp-download-status.queued { color: #8A8F98; }
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
      #pp-choose-folder { max-width:145px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
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
      .pp-history-card-state.error,.pp-history-card-state.interrupted { color: rgba(255,107,107,0.8); }
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

      /* PixivPlus 2 workbench download center */
      :host {
        --pp-panel-bottom:18px;--pp-bg:#fff;--pp-soft:#f1f3f6;--pp-text:#24272d;
        --pp-muted:#737984;--pp-line:#e1e4e9;--pp-blue:#0096fa;--pp-blue-soft:#e7f5ff;
        --pp-success:#0b9963;--pp-danger:#d9365b;color-scheme:light dark;
      }
      :host([data-workbench="true"]) { --pp-panel-bottom:0px; }
      .pp-panel {
        bottom:var(--pp-panel-bottom);right:16px;width:min(316px,calc(100vw - 24px));max-height:318px;
        background:var(--pp-bg);border:1px solid var(--pp-line);border-radius:12px;
        box-shadow:0 16px 42px rgb(26 35 48/.2),0 2px 8px rgb(26 35 48/.08);
        color:var(--pp-text);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .pp-panel.minimized { width:auto;min-width:196px;border-radius:10px; }
      .pp-panel-header { min-height:42px;padding:7px 8px 7px 11px;border-bottom:1px solid var(--pp-line); }
      .pp-panel-header:hover { background:var(--pp-soft); }
      .pp-panel-title { font-size:13px;color:var(--pp-text); }
      .pp-panel-title::before { content:"↓";display:inline-grid;place-items:center;width:22px;height:22px;margin-right:7px;border-radius:7px;background:var(--pp-blue-soft);color:var(--pp-blue);font-weight:700; }
      .pp-panel-count { color:var(--pp-blue);margin-left:5px; }
      .pp-panel-summary { color:var(--pp-muted);font-size:11px;margin-left:6px; }
      .pp-panel-controls { gap:2px; }
      .pp-panel-inline { display:none;min-width:0; }
      .pp-inline-current { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pp-text); }
      .pp-inline-track { height:3px;overflow:hidden;border-radius:999px;background:var(--pp-soft); }
      .pp-inline-fill { display:block;width:0;height:100%;border-radius:inherit;background:var(--pp-blue);transition:width .2s ease; }
      .pp-inline-fill.complete { background:var(--pp-success); }
      .pp-inline-fill.error { background:var(--pp-danger); }
      .pp-inline-status { min-width:78px;text-align:right;color:var(--pp-muted);font-size:10px;white-space:nowrap; }
      .pp-panel-controls button,.pp-download-actions button {
        width:28px;height:28px;padding:0;display:grid;place-items:center;background:transparent;
        border:0;border-radius:7px;color:var(--pp-muted);font-size:14px;transition:background .15s,color .15s;
      }
      .pp-panel-controls button:hover,.pp-download-actions button:hover { color:var(--pp-text);background:var(--pp-soft); }
      .pp-panel-body { max-height:204px;padding:5px;overflow-y:auto;scrollbar-width:thin; }
      .pp-download-item {
        display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:9px;
        min-height:52px;padding:6px;border:0;border-radius:9px;
      }
      .pp-download-item + .pp-download-item { margin-top:3px; }
      .pp-download-item:hover { background:var(--pp-soft); }
      .pp-download-item:not(.has-thumb) { grid-template-columns:minmax(0,1fr) auto; }
      .pp-download-thumb { width:38px;height:38px;border-radius:7px;overflow:hidden;background:var(--pp-soft); }
      .pp-download-thumb[hidden] { display:none; }
      .pp-download-thumb img { width:100%;height:100%;display:block;object-fit:cover; }
      .pp-download-main { min-width:0; }
      .pp-download-name { margin:0 0 6px;color:var(--pp-text);font-size:12px;font-weight:500; }
      .pp-download-bar-row { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center; }
      .pp-download-bar { height:4px;background:var(--pp-soft);border-radius:999px; }
      .pp-download-bar-fill { background:var(--pp-blue);border-radius:999px;transition:width .2s ease; }
      .pp-download-bar-fill.complete { background:var(--pp-success); }
      .pp-download-bar-fill.error { background:var(--pp-danger); }
      .pp-download-status { min-width:auto;color:var(--pp-muted);font-size:10px;text-align:right; }
      .pp-download-status.complete { color:var(--pp-success); }
      .pp-download-status.queued,.pp-download-status.cancelled { color:var(--pp-muted); }
      .pp-download-status.error { color:var(--pp-danger); }
      .pp-download-actions { margin:0;gap:1px; }
      .pp-download-actions button { width:25px;height:25px;font-size:12px; }
      .pp-panel-footer { min-height:40px;padding:6px 8px;border-top:1px solid var(--pp-line);gap:5px; }
      .pp-panel-footer button {
        min-width:0;padding:5px 8px;background:var(--pp-soft);border:1px solid transparent;
        border-radius:7px;color:var(--pp-muted);font-size:11px;
      }
      .pp-panel-footer button:hover { background:var(--pp-blue-soft);color:var(--pp-text); }
      #pp-choose-folder { max-width:132px;margin-right:auto; }
      .pp-show-more { background:var(--pp-blue-soft)!important;border-color:transparent!important;color:var(--pp-blue)!important; }
      .pp-show-more:hover { filter:brightness(.97); }
      .pp-history-overlay { background:rgb(18 24 32/.42);backdrop-filter:blur(6px); }
      .pp-history-panel { background:var(--pp-bg);border:1px solid var(--pp-line);box-shadow:0 24px 70px rgb(18 24 32/.28);color:var(--pp-text); }
      .pp-history-title { color:var(--pp-text); }
      .pp-history-count,.pp-history-card-artist,.pp-history-empty { color:var(--pp-muted); }
      .pp-history-close { color:var(--pp-muted); }
      .pp-history-close:hover { color:var(--pp-text);background:var(--pp-soft); }
      .pp-history-card { background:var(--pp-soft);border-color:var(--pp-line); }
      .pp-history-card:hover { border-color:var(--pp-blue); }
      .pp-history-card-thumb,.pp-history-card-placeholder { background:var(--pp-soft); }
      .pp-history-card-title { color:var(--pp-text); }
      .pp-history-card-state.complete { color:var(--pp-success); }
      .pp-history-card-state.cancelled { color:var(--pp-muted); }
      .pp-history-card-state.error,.pp-history-card-state.interrupted { color:var(--pp-danger); }
      .pp-toast {
        right:344px;bottom:calc(var(--pp-panel-bottom) + var(--pp-toast-offset,0px));padding:9px 12px;
        background:var(--pp-bg)!important;border:1px solid var(--pp-line)!important;border-radius:9px;
        box-shadow:0 10px 32px rgb(26 35 48/.18);color:var(--pp-text);font-size:12px;
      }
      .pp-toast.success { border-left:3px solid var(--pp-success)!important; }
      .pp-toast.error { border-left:3px solid var(--pp-danger)!important; }
      .pp-toast.info { border-left:3px solid var(--pp-blue)!important; }
      :host([data-workbench="true"]) .pp-panel,
      :host([data-workbench="true"]) .pp-panel.minimized {
        bottom:0;right:0;width:clamp(300px,36vw,420px);min-width:0;height:31px;max-height:31px;
        border:0;border-left:1px solid var(--pp-line);border-radius:0;box-shadow:none;overflow:hidden;
      }
      :host([data-workbench="true"]) .pp-panel-header {
        height:31px;min-height:31px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;
        justify-content:stretch;gap:8px;padding:3px 7px 3px 8px;border:0;cursor:default;
      }
      :host([data-workbench="true"]) .pp-panel-header:hover { background:var(--pp-bg); }
      :host([data-workbench="true"]) .pp-panel-heading { display:flex;align-items:center; }
      :host([data-workbench="true"]) .pp-panel-title { width:22px;font-size:0; }
      :host([data-workbench="true"]) .pp-panel-title::before { width:22px;height:22px;margin:0;font-size:12px;border-radius:7px; }
      :host([data-workbench="true"]) .pp-panel-summary { display:none; }
      :host([data-workbench="true"]) .pp-panel-inline { display:grid;grid-template-columns:minmax(72px,1fr) 92px auto;align-items:center;gap:7px; }
      :host([data-workbench="true"]) .pp-panel-controls button { width:23px;height:23px;font-size:12px; }
      :host([data-workbench="true"]) #pp-panel-minimize,
      :host([data-workbench="true"]) #pp-panel-close,
      :host([data-workbench="true"]) .pp-panel-body,
      :host([data-workbench="true"]) .pp-panel-footer { display:none; }
      :host([data-workbench="true"]) .pp-toast { right:12px;bottom:42px; }
      @media (prefers-color-scheme:dark) {
        :host { --pp-bg:#17191f;--pp-soft:#22252c;--pp-text:#eff1f4;--pp-muted:#9aa1ad;--pp-line:#2d3139;--pp-blue:#35a9ff;--pp-blue-soft:#12354d;--pp-success:#4bd79b;--pp-danger:#ff6682; }
      }
      @media (max-width:680px) {
        .pp-panel { right:12px; }
        .pp-toast { right:12px;bottom:calc(var(--pp-panel-bottom) + 58px);max-width:calc(100vw - 24px); }
        :host([data-workbench="true"]) .pp-panel,:host([data-workbench="true"]) .pp-panel.minimized { right:0;width:330px;max-width:calc(100vw - 116px); }
        :host([data-workbench="true"]) .pp-panel-inline { grid-template-columns:minmax(62px,1fr) 72px auto;gap:5px; }
      }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'pp-panel';
    panel.id = 'pp-download-panel';
    panel.innerHTML = `
      <div class="pp-panel-header" id="pp-panel-header">
        <span class="pp-panel-heading"><span class="pp-panel-title">Downloads</span><span class="pp-panel-count" id="pp-panel-count"></span><span class="pp-panel-summary" id="pp-panel-summary"></span></span>
        <div class="pp-panel-inline" aria-live="polite">
          <span class="pp-inline-current" id="pp-inline-current"></span>
          <span class="pp-inline-track"><i class="pp-inline-fill" id="pp-inline-fill"></i></span>
          <span class="pp-inline-status" id="pp-inline-status"></span>
        </div>
        <div class="pp-panel-controls">
          <button id="pp-panel-pause" title="Pause queued downloads">Ⅱ</button>
          <button id="pp-panel-cancel-all" title="Cancel all">×</button>
          <button id="pp-panel-minimize" title="Minimize">−</button>
          <button id="pp-panel-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="pp-panel-body" id="pp-panel-body"></div>
      <div class="pp-panel-footer">
        <button id="pp-choose-folder" title="Choose download folder">Folder: not selected</button>
        <button id="pp-show-more" class="pp-show-more" style="display:none;">Show More</button>
        <button id="pp-panel-clear">Clear</button>
      </div>
    `;
    shadow.appendChild(panel);

    // Events
    shadow.getElementById('pp-panel-header').addEventListener('click', () => {
      if (panelHost.dataset.workbench === 'true') return;
      panel.classList.toggle('minimized');
    });
    shadow.getElementById('pp-panel-close').addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.remove('visible');
      panelVisible = false;
    });
    shadow.getElementById('pp-panel-minimize').addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('minimized');
    });
    shadow.getElementById('pp-panel-pause').addEventListener('click', e => {
      e.stopPropagation();
      const paused = window.PixivPlusDownload?.toggleQueuePaused();
      e.currentTarget.textContent = paused ? '▶' : 'Ⅱ';
      e.currentTarget.title = paused ? 'Resume queued downloads' : 'Pause queued downloads';
    });
    shadow.getElementById('pp-panel-cancel-all').addEventListener('click', e => {
      e.stopPropagation();
      window.PixivPlusDownload?.cancelAllDownloads();
    });
    shadow.getElementById('pp-show-more').addEventListener('click', () => {
      showHistoryModal(shadow);
    });
    shadow.getElementById('pp-choose-folder').addEventListener('click', () => {
      window.PixivPlusDownload?.chooseDirectory();
    });
    shadow.getElementById('pp-panel-clear').addEventListener('click', () => {
      const body = shadow.getElementById('pp-panel-body');
      const activeItems = body.querySelectorAll('.pp-download-item[data-state="in_progress"], .pp-download-item[data-state="queued"]');
      activeItems.forEach(el => {
        const url = el.dataset.url;
        if (url) window.PixivPlusDownload?.cancelDownload(url);
      });
      if (activeItems.length === 0) {
        body.innerHTML = '';
        downloads.clear();
        metaStore.clear();
        updateCount(shadow);
      }
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

    // Keep the download controls above the workbench and page-selection dialog.
    if (panelHost.nextElementSibling) {
      document.body.appendChild(panelHost);
    }

    // Store metadata when first seen (in_progress with thumbUrl/title/artist)
    if (data.thumbUrl || data.title || data.artist) {
      const existing = metaStore.get(data.filename);
      metaStore.set(data.filename, {
        thumbUrl: data.thumbUrl || existing?.thumbUrl || '',
        title: data.title || existing?.title || '',
        artist: data.artist || existing?.artist || '',
        workId: data.workId || existing?.workId || '',
        pageIndex: data.pageIndex ?? existing?.pageIndex ?? 0
      });
    }

    let item = downloads.get(data.filename);
    if (!item) {
      item = document.createElement('div');
      item.className = 'pp-download-item';
      item.dataset.url = data.url || '';
      item.innerHTML = `
        <div class="pp-download-thumb" hidden><img alt=""></div>
        <div class="pp-download-main">
          <div class="pp-download-name"></div>
          <div class="pp-download-bar-row">
            <div class="pp-download-bar"><div class="pp-download-bar-fill"></div></div>
            <div class="pp-download-status"></div>
          </div>
        </div>
        <div class="pp-download-actions">
          <button class="pp-dl-cancel" title="Cancel">&#10005;</button>
          <button class="pp-dl-retry" title="Retry" style="display:none;">&#8635;</button>
          <button class="pp-dl-remove" title="Remove">&#128465;</button>
        </div>
      `;
      const name = item.querySelector('.pp-download-name');
      name.textContent = data.filename;
      name.title = data.filename;
      body.appendChild(item);
      downloads.set(data.filename, item);

      if (!sessionFiles.has(data.filename)) {
        sessionFiles.add(data.filename);
        sessionTotal++;
      }

      // Cancel button
      item.querySelector('.pp-dl-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url && ['queued', 'in_progress'].includes(item.dataset.state)) {
          window.PixivPlusDownload?.cancelDownload(url);
          return;
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
        if (url && ['queued', 'in_progress'].includes(item.dataset.state)) {
          window.PixivPlusDownload?.cancelDownload(url);
          return;
        }
        item.remove();
        downloads.delete(data.filename);
        metaStore.delete(data.filename);
        updateCount(shadow);
      });

      item.querySelector('.pp-dl-retry').addEventListener('click', e => {
        e.stopPropagation();
        window.PixivPlusDownload?.retryDownload(data.filename);
      });
    }

    syncItemThumbnail(item, data);

    const fill = item.querySelector('.pp-download-bar-fill');
    const status = item.querySelector('.pp-download-status');
    const actions = item.querySelector('.pp-download-actions');
    const retry = item.querySelector('.pp-dl-retry');
    const cancel = item.querySelector('.pp-dl-cancel');
    const prevState = item.dataset.state || null;

    if (data.state === 'queued') {
      if (item.dataset.sessionFinished === 'true') {
        sessionFinished = Math.max(0, sessionFinished - 1);
        item.dataset.sessionFinished = 'false';
      }
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      fill.style.width = '0%';
      fill.className = 'pp-download-bar-fill';
      status.className = 'pp-download-status queued';
      status.textContent = data.speed || 'Queued';
      item.dataset.state = 'queued';
      item.dataset.progress = '0';
      if (actions) actions.style.display = '';
      if (retry) retry.style.display = 'none';
      if (cancel) cancel.style.display = '';
    } else if (data.state === 'in_progress') {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
      const pct = data.totalBytes > 0 ? Math.round((data.bytesReceived / data.totalBytes) * 100) : 0;
      fill.style.width = `${pct}%`;
      fill.className = 'pp-download-bar-fill';
      status.className = 'pp-download-status';
      status.textContent = `${pct}% ${data.speed || ''}`;
      item.dataset.state = 'in_progress';
      item.dataset.progress = String(pct);
      if (actions) actions.style.display = '';
      if (retry) retry.style.display = 'none';
      if (cancel) cancel.style.display = '';
    } else if (data.state === 'complete') {
      fill.style.width = '100%';
      fill.className = 'pp-download-bar-fill complete';
      status.className = 'pp-download-status complete';
      status.textContent = 'Done';
      item.dataset.state = 'complete';
      item.dataset.progress = '100';
      if (actions) actions.style.display = 'none';
    } else if (data.state === 'interrupted') {
      fill.className = 'pp-download-bar-fill error';
      status.className = 'pp-download-status error';
      status.textContent = data.error || 'Failed';
      item.dataset.state = 'interrupted';
      item.dataset.progress = item.dataset.progress || '0';
      if (actions) actions.style.display = '';
      if (retry) retry.style.display = '';
      if (cancel) cancel.style.display = 'none';
    } else if (data.state === 'cancelled') {
      fill.className = 'pp-download-bar-fill error';
      status.className = 'pp-download-status cancelled';
      status.textContent = 'Cancelled';
      item.dataset.state = 'cancelled';
      item.dataset.progress = item.dataset.progress || '0';
      if (actions) actions.style.display = 'none';
    }

    // Move completed item to history and remove from panel
    if (['complete', 'interrupted', 'cancelled'].includes(data.state) && ['queued', 'in_progress'].includes(prevState)) {
      if (item.dataset.sessionFinished !== 'true') {
        sessionFinished++;
        item.dataset.sessionFinished = 'true';
      }
      const meta = metaStore.get(data.filename) || {};
      addToHistory(data, meta);
      metaStore.delete(data.filename);

      if (data.state !== 'interrupted') {
        setTimeout(() => {
          item.remove();
          downloads.delete(data.filename);
          updateCount(shadow);
          updateShowMoreButton(shadow);
        }, 800);
      }

      updateShowMoreButton(shadow);

      if (data.state !== 'interrupted') {
        // Keep failures visible so the retry action remains discoverable.
        clearTimeout(autoCloseTimer);
        autoCloseTimer = setTimeout(() => {
          const body = shadow.getElementById('pp-panel-body');
          const active = body?.querySelectorAll('.pp-download-item[data-state="queued"], .pp-download-item[data-state="in_progress"]').length || 0;
          const failures = body?.querySelectorAll('.pp-download-item[data-state="interrupted"]').length || 0;
          if (active === 0 && failures === 0) {
            panel.classList.remove('visible');
            panelVisible = false;
          }
        }, 3000);
      }
    }

    updateCount(shadow);
  }

  function addToHistory(data, meta) {
    history.unshift({
      filename: data.filename,
      thumbUrl: meta.thumbUrl || '',
      title: meta.title || '',
      artist: meta.artist || '',
      workId: meta.workId || '',
      pageIndex: meta.pageIndex ?? 0,
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
    const active = body.querySelectorAll('.pp-download-item[data-state="queued"], .pp-download-item[data-state="in_progress"]').length;
    countEl.textContent = active > 0 ? `(${active})` : '';
    const summary = shadow?.getElementById('pp-panel-summary');
    if (summary) summary.textContent = sessionTotal > 0 ? `${sessionFinished}/${sessionTotal}` : '';
    updateInlineProgress(shadow, body);
  }

  function updateInlineProgress(shadow, body) {
    const label = shadow?.getElementById('pp-inline-current');
    const fill = shadow?.getElementById('pp-inline-fill');
    const status = shadow?.getElementById('pp-inline-status');
    if (!label || !fill || !status || !body) return;

    const items = [...body.querySelectorAll('.pp-download-item')];
    const activeItems = items.filter(item => ['queued', 'in_progress'].includes(item.dataset.state));
    const failedItems = items.filter(item => item.dataset.state === 'interrupted');
    const current = activeItems.find(item => item.dataset.state === 'in_progress')
      || activeItems[0]
      || failedItems[0]
      || items[0];

    if (!current) {
      label.textContent = 'Downloads';
      status.textContent = sessionTotal ? `${sessionFinished}/${sessionTotal}` : '';
      fill.style.width = '0%';
      fill.className = 'pp-inline-fill';
      return;
    }

    const name = current.querySelector('.pp-download-name')?.textContent || 'Download';
    const extra = activeItems.length > 1 ? ` +${activeItems.length - 1}` : '';
    label.textContent = `${name}${extra}`;
    label.title = name;
    status.textContent = current.querySelector('.pp-download-status')?.textContent || '';

    const progressItems = activeItems.length ? activeItems : [current];
    const progress = Math.round(progressItems.reduce((sum, item) => sum + Number(item.dataset.progress || 0), 0) / progressItems.length);
    fill.style.width = `${progress}%`;
    fill.className = `pp-inline-fill${current.dataset.state === 'interrupted' ? ' error' : current.dataset.state === 'complete' ? ' complete' : ''}`;
  }

  function setFolderName(name) {
    const button = panelHost?.shadowRoot?.getElementById('pp-choose-folder');
    if (button) button.textContent = `Folder: ${name || 'not selected'}`;
  }

  function setWorkbenchActive(active) {
    if (!panelHost) return;
    panelHost.dataset.workbench = active ? 'true' : 'false';
    if (active) panelHost.shadowRoot?.getElementById('pp-download-panel')?.classList.remove('minimized');
  }

  function syncItemThumbnail(item, data) {
    const meta = metaStore.get(data.filename) || {};
    const url = data.thumbUrl || meta.thumbUrl || '';
    if (!url) return;
    const wrapper = item.querySelector('.pp-download-thumb');
    const image = wrapper?.querySelector('img');
    if (!wrapper || !image || image.src === url) return;
    image.onload = () => {
      wrapper.hidden = false;
      item.classList.add('has-thumb');
    };
    image.onerror = () => {
      wrapper.hidden = true;
      item.classList.remove('has-thumb');
    };
    image.src = url;
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

        const stateLabel = item.state === 'complete' ? 'Done'
          : item.state === 'interrupted' ? 'Failed'
          : 'Cancelled';

        const placeholder = document.createElement('div');
        placeholder.className = 'pp-history-card-placeholder';
        placeholder.textContent = '🖼';

        if (item.thumbUrl) {
          const thumb = document.createElement('img');
          thumb.className = 'pp-history-card-thumb';
          thumb.src = item.thumbUrl;
          thumb.loading = 'lazy';
          thumb.alt = '';
          thumb.addEventListener('error', () => thumb.replaceWith(placeholder), { once: true });
          card.appendChild(thumb);
        } else {
          card.appendChild(placeholder);
        }

        const info = document.createElement('div');
        info.className = 'pp-history-card-info';
        const title = document.createElement('div');
        title.className = 'pp-history-card-title';
        title.textContent = item.title || item.filename;
        title.title = item.title || item.filename;
        const meta = document.createElement('div');
        meta.className = 'pp-history-card-meta';
        const artist = document.createElement('span');
        artist.className = 'pp-history-card-artist';
        artist.textContent = item.artist || '';
        const state = document.createElement('span');
        state.className = `pp-history-card-state ${['complete', 'interrupted', 'cancelled'].includes(item.state) ? item.state : 'cancelled'}`;
        state.textContent = stateLabel;
        meta.append(artist, state);
        info.append(title, meta);
        card.appendChild(info);
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
    toast.style.setProperty('--pp-toast-offset', `${offset}px`);

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

  window.PixivPlusDownloadPanel = {
    init,
    showToast,
    updateDownload,
    isDuplicate,
    setFolderName,
    setWorkbenchActive
  };
})();
