// PixivPlus - Follow-feed workbench
// Replaces bookmark_new_illust.php with a reversible split-view browser.

(() => {
  'use strict';

  const ROUTE = '/bookmark_new_illust.php';
  const model = window.PixivPlusWorkbenchModel;
  const SEEN_WORKS_STORAGE_KEY = 'workbenchSeenWorkIds';
  const store = model.createStore();
  const sourceCards = new Map();
  const thumbElements = new Map();
  const workInfoCache = new Map();
  const preloadedOriginalUrls = new Set();
  const preloadedOriginalWorkIds = new Set();
  const failedOriginalWorkIds = new Set();
  const seenWorkIds = new Set();
  const batchSelection = new Set();

  let enabled = true;
  let host = null;
  let shadow = null;
  let shell = null;
  let launcher = null;
  let feed = null;
  let emptyState = null;
  let previewImage = null;
  let loading = null;
  let error = null;
  let title = null;
  let artist = null;
  let facts = null;
  let tags = null;
  let details = null;
  let pageLabel = null;
  let feedPageInput = null;
  let feedPrevButton = null;
  let feedNextButton = null;
  let downloadCurrentButton = null;
  let downloadAllButton = null;
  let bookmarkButton = null;
  let loadOriginalsButton = null;
  let batchBar = null;
  let batchCount = null;
  let currentWorkId = null;
  let currentInfo = null;
  let currentPage = 0;
  let requestVersion = 0;
  let workspaceVisible = false;
  let focusMode = false;
  let batchMode = false;
  let lastBatchIndex = -1;
  let scanQueued = false;
  let nativeLoadRequested = false;
  let nativeScrollBeforeWorkbench = 0;
  let leftWidth = 340;
  let density = 'balanced';
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pointerStart = null;
  let infoPositionQueued = false;
  let preloadOriginalsByDefault = false;
  let originalMode = false;
  let preloadRun = null;
  let autoPreloadTimer = null;

  const t = (key, fallback) => chrome.i18n.getMessage(key) || fallback;

  function isWorkbenchRoute() {
    return location.pathname === ROUTE;
  }

  function init() {
    chrome.storage.local.get({
      workbenchEnabled: true,
      workbenchLeftWidth: 340,
      workbenchDensity: 'balanced',
      workbenchPreloadOriginals: false,
      [SEEN_WORKS_STORAGE_KEY]: []
    }, settings => {
      enabled = settings.workbenchEnabled !== false;
      leftWidth = clamp(Number(settings.workbenchLeftWidth) || 340, 240, 520);
      density = ['compact', 'balanced', 'filmstrip'].includes(settings.workbenchDensity)
        ? settings.workbenchDensity
        : 'balanced';
      preloadOriginalsByDefault = settings.workbenchPreloadOriginals === true;
      originalMode = preloadOriginalsByDefault;
      replaceSeenWorkIds(settings[SEEN_WORKS_STORAGE_KEY]);
      syncRoute();
    });

    chrome.storage.onChanged.addListener(changes => {
      if (changes.workbenchEnabled) {
        enabled = changes.workbenchEnabled.newValue !== false;
        syncRoute();
      }
      if (changes[SEEN_WORKS_STORAGE_KEY]) {
        replaceSeenWorkIds(changes[SEEN_WORKS_STORAGE_KEY].newValue);
        syncSeenState();
      }
      if (changes.workbenchPreloadOriginals) {
        preloadOriginalsByDefault = changes.workbenchPreloadOriginals.newValue === true;
        if (preloadOriginalsByDefault) {
          originalMode = true;
          scheduleAutoOriginalPreload();
        }
      }
    });

    const observer = new MutationObserver(mutations => {
      if (!enabled || !isWorkbenchRoute()) return;
      if (mutations.some(mutation => mutation.addedNodes.length > 0)) scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('popstate', syncRoute);
    setInterval(syncRoute, 800);
  }

  function syncRoute() {
    if (!enabled || !isWorkbenchRoute()) {
      deactivate();
      return;
    }
    ensureUI();
    if (!workspaceVisible && !shell.dataset.userCollapsed) showWorkbench();
    scheduleScan();
  }

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'pixivplus-workbench-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });
    createStyles();
    createMarkup();
    bindEvents();
    document.documentElement.appendChild(host);
    applyDensity();
    shell.style.setProperty('--ppw-left-width', `${leftWidth}px`);
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      [hidden] { display:none!important; }
      button, select { font: inherit; }
      .ppw-shell {
        --ppw-bg:#f4f5f7;--ppw-surface:#fff;--ppw-soft:#eef0f3;--ppw-text:#24272d;
        --ppw-muted:#737984;--ppw-line:#e1e4e9;--ppw-blue:#0096fa;--ppw-blue-soft:#e7f5ff;
        --ppw-danger:#d9365b;--ppw-success:#0b9963;
        position:absolute;inset:0;display:flex;flex-direction:column;pointer-events:auto;
        background:var(--ppw-bg);color:var(--ppw-text);
        font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        .ppw-shell {
          --ppw-bg:#0f1115;--ppw-surface:#17191f;--ppw-soft:#22252c;--ppw-text:#eff1f4;
          --ppw-muted:#9aa1ad;--ppw-line:#2d3139;--ppw-blue:#35a9ff;--ppw-blue-soft:#12354d;
          --ppw-danger:#ff6682;--ppw-success:#4bd79b;
        }
      }
      .ppw-shell[hidden], .ppw-launcher[hidden] { display:none; }
      .ppw-topbar {
        height:58px;flex:0 0 58px;display:flex;align-items:center;gap:12px;padding:0 14px;
        background:var(--ppw-surface);border-bottom:1px solid var(--ppw-line);
      }
      .ppw-brand { display:flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap; }
      .ppw-logo { width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:var(--ppw-blue-soft);color:var(--ppw-blue); }
      .ppw-route-title { font-weight:600;white-space:nowrap; }
      .ppw-summary { color:var(--ppw-muted);white-space:nowrap; }
      .ppw-spacer { flex:1; }
      .ppw-button, .ppw-icon-button, .ppw-select {
        min-height:34px;border:1px solid var(--ppw-line);border-radius:8px;background:var(--ppw-surface);
        color:var(--ppw-text);cursor:pointer;
      }
      .ppw-button { padding:0 11px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap; }
      .ppw-icon-button { width:34px;padding:0;display:grid;place-items:center;font-size:17px; }
      .ppw-button:hover, .ppw-icon-button:hover { background:var(--ppw-soft); }
      .ppw-button.primary { border-color:var(--ppw-blue);background:var(--ppw-blue);color:#fff; }
      .ppw-button.primary:hover { filter:brightness(.96); }
      .ppw-button.active { border-color:var(--ppw-blue);color:var(--ppw-blue);background:var(--ppw-blue-soft); }
      .ppw-button.loading { cursor:progress; }
      .ppw-button:disabled { cursor:default;opacity:.62; }
      .ppw-select { padding:0 30px 0 10px; }
      .ppw-body { min-height:0;overflow:hidden;flex:1;display:grid;grid-template-columns:var(--ppw-left-width) 5px minmax(0,1fr);grid-template-rows:minmax(0,1fr); }
      .ppw-browser { min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--ppw-surface); }
      .ppw-browser-head { height:52px;flex:0 0 52px;display:flex;align-items:center;gap:8px;padding:0 11px;border-bottom:1px solid var(--ppw-line); }
      .ppw-browser-head strong { font-weight:600; }
      .ppw-count { color:var(--ppw-muted);margin-right:auto; }
      .ppw-feed { min-height:0;flex:1;overflow:auto;padding:9px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:8px;overscroll-behavior:contain; }
      .ppw-empty { flex:0 0 100%;min-height:220px;display:grid;place-items:center;text-align:center;color:var(--ppw-muted);padding:30px; }
      .ppw-thumb {
        position:relative;flex:0 0 calc(50% - 4px);width:auto;height:auto;aspect-ratio:1/1;overflow:hidden;padding:0;
        border:2px solid transparent;border-radius:9px;background:var(--ppw-soft);cursor:pointer;
      }
      .ppw-shell[data-density="compact"] .ppw-thumb { flex-basis:calc(33.333333% - 5.333334px); }
      .ppw-shell[data-density="filmstrip"] .ppw-thumb { flex-basis:100%; }
      .ppw-thumb:hover { filter:brightness(.97); }
      .ppw-thumb.selected { border-color:var(--ppw-blue);box-shadow:0 0 0 2px var(--ppw-blue-soft); }
      .ppw-thumb.batch-selected { border-color:var(--ppw-success);box-shadow:0 0 0 2px var(--ppw-soft); }
      .ppw-thumb img { width:100%;height:auto;aspect-ratio:1/1;display:block;object-fit:cover;background:var(--ppw-soft); }
      .ppw-thumb-label { position:absolute;inset:auto 0 0;padding:20px 7px 6px;color:#fff;background:linear-gradient(transparent,rgb(0 0 0/.75));text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px; }
      .ppw-unread { position:absolute;top:7px;left:7px;width:8px;height:8px;border-radius:50%;background:var(--ppw-blue);box-shadow:0 0 0 2px #fff; }
      .ppw-badge { position:absolute;top:6px;right:6px;padding:2px 6px;border-radius:6px;background:rgb(0 0 0/.7);color:#fff;font-size:11px; }
      .ppw-check { position:absolute;top:6px;left:6px;width:21px;height:21px;display:none;place-items:center;border-radius:50%;background:rgb(0 0 0/.62);color:#fff;border:1px solid rgb(255 255 255/.75); }
      .batch .ppw-check { display:grid; }
      .batch .ppw-unread { display:none; }
      .ppw-thumb.batch-selected .ppw-check { background:var(--ppw-success);border-color:var(--ppw-success); }
      .ppw-feed-pager { height:46px;flex:0 0 46px;display:flex;align-items:center;justify-content:center;gap:7px;padding:6px 9px;border-top:1px solid var(--ppw-line);background:var(--ppw-surface); }
      .ppw-feed-page-label { display:flex;align-items:center;gap:5px;color:var(--ppw-muted);font-size:12px;white-space:nowrap; }
      .ppw-feed-page-input { width:48px;height:32px;padding:0;border:1px solid var(--ppw-line);border-radius:7px;background:var(--ppw-surface);color:var(--ppw-text);text-align:center;font:inherit;line-height:30px;font-variant-numeric:tabular-nums;appearance:textfield; }
      .ppw-feed-page-input:focus { outline:2px solid var(--ppw-blue-soft);border-color:var(--ppw-blue); }
      .ppw-resizer { background:var(--ppw-line);cursor:col-resize;position:relative; }
      .ppw-resizer:hover::after, .ppw-resizer.dragging::after { content:"";position:absolute;inset:0 -2px;background:var(--ppw-blue); }
      .ppw-viewer { min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;background:var(--ppw-bg); }
      .ppw-view-head { height:52px;flex:0 0 52px;display:flex;align-items:center;gap:7px;padding:0 12px;background:var(--ppw-surface);border-bottom:1px solid var(--ppw-line); }
      .ppw-current-title { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;margin-right:auto; }
      .ppw-stage { position:relative;min-height:0;flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:26px 54px;background:radial-gradient(circle at center,var(--ppw-surface),var(--ppw-bg) 75%);touch-action:none; }
      .ppw-image { display:block;max-width:100%;max-height:100%;object-fit:contain;transform-origin:center;user-select:none;-webkit-user-drag:none;box-shadow:0 18px 48px rgb(0 0 0/.22); }
      .ppw-image[hidden] { display:none; }
      .ppw-loading, .ppw-error { position:absolute;inset:0;display:grid;place-items:center;color:var(--ppw-muted);text-align:center;padding:30px; }
      .ppw-loading[hidden], .ppw-error[hidden] { display:none; }
      .ppw-spinner { width:28px;height:28px;border:3px solid var(--ppw-line);border-top-color:var(--ppw-blue);border-radius:50%;animation:ppw-spin .8s linear infinite; }
      @keyframes ppw-spin { to { transform:rotate(360deg); } }
      .ppw-work-nav { position:absolute;top:50%;translate:0 -50%;width:38px;height:54px;border:0;border-radius:10px;background:var(--ppw-surface);color:var(--ppw-text);box-shadow:0 6px 18px rgb(0 0 0/.16);cursor:pointer;font-size:24px; }
      .ppw-work-prev { left:11px; }.ppw-work-next { right:11px; }
      .ppw-page-nav { position:absolute;left:50%;bottom:12px;translate:-50% 0;display:flex;align-items:center;gap:7px;padding:4px;border-radius:9px;background:var(--ppw-surface);box-shadow:0 6px 18px rgb(0 0 0/.16); }
      .ppw-page-nav[hidden] { display:none; }
      .ppw-page-label { min-width:52px;text-align:center;color:var(--ppw-muted);font-variant-numeric:tabular-nums; }
      .ppw-zoom { position:absolute;right:12px;bottom:12px;display:flex;gap:4px;padding:4px;border-radius:9px;background:var(--ppw-surface);box-shadow:0 6px 18px rgb(0 0 0/.16); }
      .ppw-details {
        position:absolute;z-index:3;min-height:0;display:grid;grid-template-columns:32px minmax(0,1fr);
        align-items:center;gap:8px;padding:9px;border:1px solid color-mix(in srgb,var(--ppw-line) 68%,transparent);
        border-radius:12px;background:color-mix(in srgb,var(--ppw-surface) 72%,transparent);
        box-shadow:0 8px 24px rgb(20 28 40/.1),inset 0 1px 0 rgb(255 255 255/.26);
        backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);
        opacity:.78;transition:opacity .16s ease,background .16s ease,box-shadow .16s ease;
      }
      .ppw-details:hover,.ppw-details:focus-within { opacity:1;background:color-mix(in srgb,var(--ppw-surface) 88%,transparent);box-shadow:0 10px 30px rgb(20 28 40/.15); }
      .ppw-details[data-placement="bottom"] { grid-template-columns:32px minmax(130px,1fr) auto; }
      .ppw-details[data-overlay="true"] { background:color-mix(in srgb,var(--ppw-surface) 86%,transparent); }
      .ppw-avatar { width:32px;height:32px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;background:var(--ppw-blue-soft);color:var(--ppw-blue);font-weight:700; }
      .ppw-identity { min-width:0; }.ppw-title { font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }.ppw-facts { margin-top:2px;color:var(--ppw-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px; }
      .ppw-tags { grid-column:1/-1;display:flex;justify-content:flex-start;gap:5px;flex-wrap:wrap;max-width:none;padding-top:2px; }
      .ppw-details[data-placement="bottom"] .ppw-tags { grid-column:auto;justify-content:flex-end;flex-wrap:nowrap;overflow:hidden;padding-top:0; }
      .ppw-tag { padding:3px 7px;border-radius:999px;background:var(--ppw-soft);color:var(--ppw-muted);font-size:11px;white-space:nowrap; }
      .ppw-tag.extra { display:none; }.ppw-details:hover .ppw-tag.extra { display:inline-flex; }.ppw-details:hover .ppw-tag.more { display:none; }
      .ppw-shortcuts { flex:0 0 31px;display:flex;align-items:center;gap:13px;padding:0 420px 0 15px;background:var(--ppw-surface);border-top:1px solid var(--ppw-line);color:var(--ppw-muted);font-size:12px;white-space:nowrap;overflow:hidden; }
      kbd { min-width:20px;padding:1px 4px;border:1px solid var(--ppw-line);border-radius:5px;background:var(--ppw-soft);color:var(--ppw-text);text-align:center;box-shadow:0 1px 0 var(--ppw-line); }
      .ppw-toast { position:absolute;left:50%;bottom:112px;translate:-50% 0;padding:9px 13px;border-radius:9px;background:var(--ppw-surface);box-shadow:0 8px 28px rgb(0 0 0/.24);color:var(--ppw-text);z-index:5; }
      .ppw-toast[hidden] { display:none; }
      .ppw-batch-bar { position:absolute;left:50%;bottom:108px;translate:-50% 0;display:flex;align-items:center;gap:8px;padding:7px;border:1px solid var(--ppw-line);border-radius:11px;background:var(--ppw-surface);box-shadow:0 10px 32px rgb(0 0 0/.24);z-index:4; }
      .ppw-batch-bar[hidden] { display:none; }
      .ppw-launcher { position:absolute;right:20px;top:74px;pointer-events:auto;border:1px solid rgb(255 255 255/.65);border-radius:999px;padding:11px 16px;background:#0096fa;color:#fff;box-shadow:0 8px 30px rgb(0 0 0/.3);cursor:pointer;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .ppw-launcher:hover { filter:brightness(.96);transform:translateY(-1px); }
      .focus .ppw-topbar, .focus .ppw-browser, .focus .ppw-resizer, .focus .ppw-details, .focus .ppw-shortcuts { display:none; }
      .focus .ppw-body { grid-template-columns:1fr; }
      .focus .ppw-view-head { background:var(--ppw-surface); }
      @media (max-width:900px) {
        .ppw-summary,.ppw-shortcuts > span:nth-child(n+3),.ppw-button .label { display:none; }
        .ppw-body { grid-template-columns:116px 0 minmax(0,1fr); }
        .ppw-resizer { display:none; }
        .ppw-feed { padding:7px; }
        .ppw-thumb { flex-basis:100%!important; }
        .ppw-browser-head strong,.ppw-browser-head .ppw-count,.ppw-browser-head .density { display:none; }
        .ppw-browser-head { justify-content:center; }
        .ppw-stage { padding:18px 43px; }
      }
      @media (max-width:640px) {
        .ppw-stage { padding:14px 42px; }
        .ppw-shortcuts { padding-right:330px; }
      }
      @media (prefers-reduced-motion:reduce) { .ppw-spinner { animation:none; } * { scroll-behavior:auto!important;transition:none!important; } }
    `;
    shadow.appendChild(style);
  }

  function createMarkup() {
    shell = document.createElement('section');
    shell.className = 'ppw-shell';
    shell.setAttribute('aria-label', 'PixivPlus Workbench');
    shell.innerHTML = `
      <header class="ppw-topbar">
        <div class="ppw-brand"><span class="ppw-logo">✦</span><span>PixivPlus</span></div>
        <span class="ppw-route-title" id="ppw-route-title"></span>
        <span class="ppw-summary" id="ppw-summary"></span>
        <span class="ppw-spacer"></span>
        <button class="ppw-button" id="ppw-load-originals" type="button"><span>◉</span><span class="label"></span></button>
        <select class="ppw-select" id="ppw-filter" aria-label="Filter artworks">
          <option value="all"></option><option value="unread"></option>
        </select>
        <button class="ppw-button" id="ppw-original" type="button"></button>
      </header>
      <div class="ppw-body">
        <aside class="ppw-browser" aria-label="Artwork thumbnails">
          <div class="ppw-browser-head">
            <strong id="ppw-feed-title"></strong><span class="ppw-count" id="ppw-count">0</span>
            <button class="ppw-icon-button density" id="ppw-density" type="button" aria-label="Change thumbnail density">▦</button>
            <button class="ppw-icon-button" id="ppw-batch-toggle" type="button" aria-label="Select multiple artworks">☑</button>
          </div>
          <div class="ppw-feed" id="ppw-feed"><div class="ppw-empty" id="ppw-empty"></div></div>
          <nav class="ppw-feed-pager" aria-label="Feed pagination">
            <button class="ppw-icon-button" id="ppw-feed-prev" type="button">‹</button>
            <label class="ppw-feed-page-label"><span id="ppw-feed-page-prefix"></span><input class="ppw-feed-page-input" id="ppw-feed-page" type="text" inputmode="numeric" pattern="[0-9]*"><span id="ppw-feed-page-suffix"></span></label>
            <button class="ppw-icon-button" id="ppw-feed-next" type="button">›</button>
          </nav>
        </aside>
        <div class="ppw-resizer" id="ppw-resizer" role="separator" aria-label="Resize thumbnail browser"></div>
        <main class="ppw-viewer">
          <div class="ppw-view-head">
            <div class="ppw-current-title" id="ppw-current-title"></div>
            <button class="ppw-button" id="ppw-bookmark" type="button"><span>♡</span><span class="label"></span></button>
            <button class="ppw-button" id="ppw-open" type="button"><span>↗</span><span class="label"></span></button>
            <button class="ppw-button" id="ppw-download-all" type="button" hidden><span>⇊</span><span class="label"></span></button>
            <button class="ppw-button primary" id="ppw-download-current" type="button"><span>↓</span><span class="label"></span></button>
          </div>
          <div class="ppw-stage" id="ppw-stage">
            <div class="ppw-loading" id="ppw-loading"><div class="ppw-spinner" aria-label="Loading"></div></div>
            <div class="ppw-error" id="ppw-error" hidden></div>
            <img class="ppw-image" id="ppw-image" alt="" hidden>
            <button class="ppw-work-nav ppw-work-prev" id="ppw-work-prev" type="button" aria-label="Previous artwork">‹</button>
            <button class="ppw-work-nav ppw-work-next" id="ppw-work-next" type="button" aria-label="Next artwork">›</button>
            <div class="ppw-page-nav" id="ppw-page-nav" hidden>
              <button class="ppw-icon-button" id="ppw-page-prev" type="button" aria-label="Previous page">‹</button>
              <span class="ppw-page-label" id="ppw-page-label"></span>
              <button class="ppw-icon-button" id="ppw-page-next" type="button" aria-label="Next page">›</button>
            </div>
            <div class="ppw-zoom">
              <button class="ppw-icon-button" id="ppw-zoom-out" type="button" aria-label="Zoom out">−</button>
              <button class="ppw-icon-button" id="ppw-zoom-reset" type="button" aria-label="Reset zoom">⌗</button>
              <button class="ppw-icon-button" id="ppw-zoom-in" type="button" aria-label="Zoom in">＋</button>
            </div>
            <section class="ppw-details" id="ppw-details" aria-label="Artwork details">
              <div class="ppw-avatar" id="ppw-avatar">P</div>
              <div class="ppw-identity"><div class="ppw-title" id="ppw-title"></div><div class="ppw-facts" id="ppw-facts"></div></div>
              <div class="ppw-tags" id="ppw-tags"></div>
            </section>
            <div class="ppw-batch-bar" id="ppw-batch-bar" hidden>
              <strong id="ppw-batch-count"></strong>
              <button class="ppw-button primary" id="ppw-batch-download" type="button"></button>
              <button class="ppw-button" id="ppw-batch-cancel" type="button"></button>
            </div>
            <div class="ppw-toast" id="ppw-toast" role="status" aria-live="polite" hidden></div>
          </div>
          <footer class="ppw-shortcuts"><span><kbd>J</kbd>/<kbd>K</kbd> <span id="ppw-shortcut-work"></span></span><span><kbd>←</kbd>/<kbd>→</kbd> <span id="ppw-shortcut-page"></span></span><span><kbd>D</kbd> <span id="ppw-shortcut-download"></span></span><span><kbd>B</kbd> <span id="ppw-shortcut-bookmark"></span></span><span><kbd>Space</kbd> <span id="ppw-shortcut-focus"></span></span></footer>
        </main>
      </div>
    `;
    shadow.appendChild(shell);

    launcher = document.createElement('button');
    launcher.className = 'ppw-launcher';
    launcher.type = 'button';
    launcher.hidden = true;
    shadow.appendChild(launcher);

    feed = shadow.getElementById('ppw-feed');
    emptyState = shadow.getElementById('ppw-empty');
    previewImage = shadow.getElementById('ppw-image');
    loading = shadow.getElementById('ppw-loading');
    error = shadow.getElementById('ppw-error');
    title = shadow.getElementById('ppw-title');
    artist = shadow.getElementById('ppw-avatar');
    facts = shadow.getElementById('ppw-facts');
    tags = shadow.getElementById('ppw-tags');
    details = shadow.getElementById('ppw-details');
    pageLabel = shadow.getElementById('ppw-page-label');
    feedPageInput = shadow.getElementById('ppw-feed-page');
    feedPrevButton = shadow.getElementById('ppw-feed-prev');
    feedNextButton = shadow.getElementById('ppw-feed-next');
    downloadCurrentButton = shadow.getElementById('ppw-download-current');
    downloadAllButton = shadow.getElementById('ppw-download-all');
    bookmarkButton = shadow.getElementById('ppw-bookmark');
    loadOriginalsButton = shadow.getElementById('ppw-load-originals');
    batchBar = shadow.getElementById('ppw-batch-bar');
    batchCount = shadow.getElementById('ppw-batch-count');
    localizeUI();
  }

  function localizeUI() {
    shadow.getElementById('ppw-route-title').textContent = t('workbenchTitle', 'Following feed');
    shadow.getElementById('ppw-feed-title').textContent = t('workbenchUnreadFirst', 'Artwork feed');
    shadow.getElementById('ppw-original').textContent = t('workbenchOriginal', 'Original page');
    loadOriginalsButton.querySelector('.label').textContent = t('workbenchLoadOriginals', 'Load page originals');
    loadOriginalsButton.title = t('preloadOriginalsSettingHint', 'Preload the first original image of every artwork in the current feed page.');
    shadow.getElementById('ppw-filter').options[0].textContent = t('workbenchFilterAll', 'All artworks');
    shadow.getElementById('ppw-filter').options[1].textContent = t('workbenchFilterUnread', 'Unread');
    bookmarkButton.querySelector('.label').textContent = t('workbenchBookmark', 'Bookmark');
    shadow.getElementById('ppw-open').querySelector('.label').textContent = t('workbenchOpen', 'Artwork page');
    downloadAllButton.querySelector('.label').textContent = t('workbenchDownloadAll', 'Download all');
    downloadCurrentButton.querySelector('.label').textContent = t('workbenchDownloadCurrent', 'Download original');
    shadow.getElementById('ppw-batch-download').textContent = t('workbenchDownloadSelected', 'Download selected');
    shadow.getElementById('ppw-batch-cancel').textContent = t('workbenchCancelSelection', 'Cancel');
    emptyState.textContent = t('workbenchLoadingFeed', 'Waiting for artworks from the Pixiv feed…');
    launcher.textContent = `✦ ${t('workbenchOpenWorkbench', 'Return to PixivPlus Workbench')}`;
    launcher.setAttribute('aria-label', t('workbenchOpenWorkbench', 'Return to PixivPlus Workbench'));
    shadow.getElementById('ppw-feed-page-prefix').textContent = t('workbenchFeedPage', 'Page');
    shadow.getElementById('ppw-feed-page-suffix').textContent = t('workbenchFeedPageSuffix', '');
    feedPrevButton.setAttribute('aria-label', t('workbenchPreviousFeedPage', 'Previous feed page'));
    feedNextButton.setAttribute('aria-label', t('workbenchNextFeedPage', 'Next feed page'));
    shadow.getElementById('ppw-shortcut-work').textContent = t('workbenchShortcutWork', 'artwork');
    shadow.getElementById('ppw-shortcut-page').textContent = t('workbenchShortcutPage', 'page');
    shadow.getElementById('ppw-shortcut-download').textContent = t('workbenchShortcutDownload', 'download');
    shadow.getElementById('ppw-shortcut-bookmark').textContent = t('workbenchShortcutBookmark', 'bookmark');
    shadow.getElementById('ppw-shortcut-focus').textContent = t('workbenchShortcutFocus', 'focus');
  }

  function bindEvents() {
    shadow.getElementById('ppw-original').addEventListener('click', showOriginalPage);
    loadOriginalsButton.addEventListener('click', () => preloadCurrentPageOriginals(true));
    launcher.addEventListener('click', showWorkbench);
    shadow.getElementById('ppw-work-prev').addEventListener('click', () => moveWork(-1));
    shadow.getElementById('ppw-work-next').addEventListener('click', () => moveWork(1));
    feedPrevButton.addEventListener('click', () => navigateFeedPage(currentFeedPage() - 1));
    feedNextButton.addEventListener('click', () => navigateFeedPage(currentFeedPage() + 1));
    feedPageInput.addEventListener('change', navigateToEnteredFeedPage);
    feedPageInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        navigateToEnteredFeedPage();
      }
    });
    shadow.getElementById('ppw-page-prev').addEventListener('click', () => showPage(currentPage - 1));
    shadow.getElementById('ppw-page-next').addEventListener('click', () => showPage(currentPage + 1));
    shadow.getElementById('ppw-open').addEventListener('click', openCurrentWork);
    bookmarkButton.addEventListener('click', bookmarkCurrentWork);
    downloadCurrentButton.addEventListener('click', downloadCurrentPage);
    downloadAllButton.addEventListener('click', () => currentInfo && window.PixivPlusDownload.downloadAllWork(currentInfo));
    shadow.getElementById('ppw-density').addEventListener('click', cycleDensity);
    shadow.getElementById('ppw-batch-toggle').addEventListener('click', toggleBatchMode);
    shadow.getElementById('ppw-batch-cancel').addEventListener('click', () => setBatchMode(false));
    shadow.getElementById('ppw-batch-download').addEventListener('click', downloadBatch);
    shadow.getElementById('ppw-filter').addEventListener('change', applyFilter);
    shadow.getElementById('ppw-zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
    shadow.getElementById('ppw-zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
    shadow.getElementById('ppw-zoom-reset').addEventListener('click', resetZoom);
    shadow.getElementById('ppw-stage').addEventListener('wheel', onWheel, { passive: false });
    shadow.getElementById('ppw-stage').addEventListener('pointerdown', onPointerDown);
    shadow.getElementById('ppw-stage').addEventListener('pointermove', onPointerMove);
    shadow.getElementById('ppw-stage').addEventListener('pointerup', onPointerUp);
    shadow.getElementById('ppw-stage').addEventListener('pointercancel', onPointerUp);
    details.addEventListener('mouseenter', scheduleInfoIslandPosition);
    details.addEventListener('mouseleave', scheduleInfoIslandPosition);
    window.addEventListener('resize', scheduleInfoIslandPosition, { passive: true });
    if ('ResizeObserver' in window) {
      const infoObserver = new ResizeObserver(scheduleInfoIslandPosition);
      infoObserver.observe(shadow.getElementById('ppw-stage'));
      infoObserver.observe(previewImage);
    }
    feed.addEventListener('scroll', onFeedScroll, { passive: true });
    bindResizer();
    document.addEventListener('keydown', onKeyDown, true);
  }

  function showWorkbench() {
    if (!enabled || !isWorkbenchRoute()) return;
    ensureUI();
    nativeScrollBeforeWorkbench = window.scrollY;
    workspaceVisible = true;
    shell.hidden = false;
    shell.dataset.userCollapsed = '';
    launcher.hidden = true;
    window.PixivPlusDownloadPanel?.setWorkbenchActive(true);
    scheduleInfoIslandPosition();
    syncFeedPagination();
    scheduleScan();
  }

  function showOriginalPage() {
    workspaceVisible = false;
    focusMode = false;
    shell.classList.remove('focus');
    shell.hidden = true;
    shell.dataset.userCollapsed = 'true';
    launcher.hidden = false;
    window.PixivPlusDownloadPanel?.setWorkbenchActive(false);
    window.scrollTo({ top: nativeScrollBeforeWorkbench, behavior: 'auto' });
  }

  function currentFeedPage() {
    const value = Number(new URL(location.href).searchParams.get('p'));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function syncFeedPagination() {
    if (!feedPageInput) return;
    const page = currentFeedPage();
    feedPageInput.value = String(page);
    feedPrevButton.disabled = page <= 1;
    feedNextButton.disabled = store.size === 0;
  }

  function navigateToEnteredFeedPage() {
    const page = Math.max(1, Math.floor(Number(feedPageInput.value) || currentFeedPage()));
    navigateFeedPage(page);
  }

  function navigateFeedPage(page) {
    const nextPage = Math.max(1, Math.floor(Number(page) || 1));
    if (nextPage === currentFeedPage()) {
      feedPageInput.value = String(nextPage);
      return;
    }
    const url = new URL(location.href);
    if (nextPage === 1) url.searchParams.delete('p');
    else url.searchParams.set('p', String(nextPage));
    location.assign(url.href);
  }

  function deactivate() {
    workspaceVisible = false;
    if (shell) shell.hidden = true;
    if (launcher) launcher.hidden = true;
    window.PixivPlusDownloadPanel?.setWorkbenchActive(false);
  }

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scanDocument();
    });
  }

  function scanDocument() {
    if (!enabled || !isWorkbenchRoute()) return;
    const discovered = [];
    for (const link of document.querySelectorAll('a[href*="/artworks/"]')) {
      const id = model.extractWorkId(link.href || link.getAttribute('href'));
      if (!id) continue;
      const card = findSourceCard(link, id);
      const image = link.querySelector('img') || card.querySelector?.('img');
      const userLink = card.querySelector?.('a[href*="/users/"]');
      const titleText = image?.alt || link.getAttribute('aria-label') || '';
      const thumbUrl = image?.currentSrc || image?.src || image?.dataset?.src || '';
      discovered.push({ id, title: titleText, artist: userLink?.textContent?.trim() || '', thumbUrl });
      const previousCard = sourceCards.get(id);
      if (!previousCard?.isConnected || bookmarkControlIn(card)) sourceCards.set(id, card);
    }

    const changes = store.merge(discovered);
    for (const record of changes.added) addThumbnail(record);
    for (const record of changes.updated) updateThumbnail(record);
    updateCounts();
    syncFeedPagination();
    applyFilter();
    if (!currentWorkId && store.size > 0) selectWork(store.all()[0].id, false);
    if (preloadOriginalsByDefault || originalMode) scheduleAutoOriginalPreload();
  }

  function addThumbnail(record) {
    emptyState.hidden = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ppw-thumb';
    button.dataset.workId = record.id;
    button.setAttribute('aria-label', record.title || `${t('workbenchArtwork', 'Artwork')} ${record.id}`);

    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    if (record.thumbUrl) image.src = record.thumbUrl;
    const check = document.createElement('span');
    check.className = 'ppw-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'ppw-thumb-label';
    label.textContent = record.title || record.id;
    button.append(image);
    if (!seenWorkIds.has(record.id)) button.append(createUnreadMarker());
    button.append(check, label);
    button.addEventListener('click', event => onThumbnailClick(event, record.id));
    feed.appendChild(button);
    thumbElements.set(record.id, button);
  }

  function updateThumbnail(record) {
    const button = thumbElements.get(record.id);
    if (!button) return;
    const image = button.querySelector('img');
    if (record.thumbUrl && !image.src) image.src = record.thumbUrl;
    button.querySelector('.ppw-thumb-label').textContent = record.title || record.id;
    button.setAttribute('aria-label', record.title || `${t('workbenchArtwork', 'Artwork')} ${record.id}`);
    let badge = button.querySelector('.ppw-badge');
    const badgeText = record.isUgoira ? t('workbenchUgoiraBadge', 'Ugoira') : record.pageCount > 1 ? `${record.pageCount}P` : '';
    if (badgeText && !badge) {
      badge = document.createElement('span');
      badge.className = 'ppw-badge';
      button.appendChild(badge);
    }
    if (badge) {
      badge.textContent = badgeText;
      badge.hidden = !badgeText;
    }
  }

  function onThumbnailClick(event, id) {
    if (!batchMode) {
      selectWork(id);
      return;
    }
    const index = store.indexOf(id);
    if (event.shiftKey && lastBatchIndex >= 0) {
      const [start, end] = [Math.min(lastBatchIndex, index), Math.max(lastBatchIndex, index)];
      const shouldSelect = !batchSelection.has(id);
      store.all().slice(start, end + 1).forEach(record => {
        if (shouldSelect) batchSelection.add(record.id);
        else batchSelection.delete(record.id);
      });
    } else if (batchSelection.has(id)) {
      batchSelection.delete(id);
    } else {
      batchSelection.add(id);
    }
    lastBatchIndex = index;
    renderBatchSelection();
  }

  async function selectWork(id, scrollIntoView = true) {
    if (!store.get(id)) return;
    currentWorkId = String(id);
    currentInfo = null;
    currentPage = 0;
    markWorkSeen(currentWorkId);
    resetZoom();
    for (const [workId, button] of thumbElements) {
      button.classList.toggle('selected', workId === currentWorkId);
    }
    const selectedButton = thumbElements.get(currentWorkId);
    selectedButton?.querySelector('.ppw-unread')?.remove();
    if (scrollIntoView) selectedButton?.scrollIntoView({ block: 'nearest' });
    updateCounts();
    if (shadow.getElementById('ppw-filter').value === 'unread') applyFilter();

    const record = store.get(currentWorkId);
    setViewerLoading(record);
    const version = ++requestVersion;
    try {
      const info = await getWorkInfoCached(currentWorkId);
      if (version !== requestVersion || currentWorkId !== String(id)) return;
      currentInfo = info;
      const updated = store.update(id, {
        title: info.title,
        artist: info.artist,
        thumbUrl: info.urls.small || info.urls.regular || record.thumbUrl,
        pageCount: info.pageCount,
        isUgoira: info.isUgoira,
        loaded: true
      });
      updateThumbnail(updated);
      renderInfo();
      showPage(0);
      prefetchNext();
    } catch (fetchError) {
      if (version !== requestVersion) return;
      loading.hidden = true;
      error.textContent = friendlyError(fetchError);
      error.hidden = false;
      if (record.thumbUrl) {
        previewImage.src = record.thumbUrl;
        previewImage.hidden = false;
      }
    }
  }

  function setViewerLoading(record) {
    loading.hidden = false;
    error.hidden = true;
    previewImage.hidden = true;
    previewImage.removeAttribute('src');
    shadow.getElementById('ppw-current-title').textContent = record.title || `${t('workbenchArtwork', 'Artwork')} ${record.id}`;
    title.textContent = record.title || `${t('workbenchArtwork', 'Artwork')} ${record.id}`;
    facts.textContent = t('workbenchLoadingDetails', 'Loading artwork details…');
    tags.replaceChildren();
    artist.textContent = (record.artist || 'P').slice(0, 1).toUpperCase();
    downloadAllButton.hidden = true;
    shadow.getElementById('ppw-page-nav').hidden = true;
  }

  function renderInfo() {
    if (!currentInfo) return;
    shadow.getElementById('ppw-current-title').textContent = currentInfo.title;
    title.textContent = currentInfo.title;
    artist.textContent = (currentInfo.artist || 'P').slice(0, 1).toUpperCase();
    bookmarkButton.classList.toggle('active', Boolean(currentInfo.isBookmarked));
    bookmarkButton.querySelector('span').textContent = currentInfo.isBookmarked ? '♥' : '♡';
    bookmarkButton.querySelector('.label').textContent = currentInfo.isBookmarked
      ? t('workbenchBookmarked', 'Bookmarked')
      : t('workbenchBookmark', 'Bookmark');
    downloadAllButton.hidden = currentInfo.pageCount <= 1 && !currentInfo.isUgoira;
    tags.replaceChildren();
    for (const [index, tag] of currentInfo.tags.slice(0, 5).entries()) {
      const span = document.createElement('span');
      span.className = `ppw-tag${index >= 2 ? ' extra' : ''}`;
      span.textContent = `#${tag}`;
      tags.appendChild(span);
    }
    if (currentInfo.tags.length > 2) {
      const more = document.createElement('span');
      more.className = 'ppw-tag more';
      more.textContent = `+${currentInfo.tags.length - 2}`;
      tags.appendChild(more);
    }
    scheduleInfoIslandPosition();
  }

  function showPage(index) {
    if (!currentInfo) return;
    const max = currentInfo.pageUrls.length - 1;
    currentPage = clamp(index, 0, max);
    resetZoom();
    const page = currentInfo.pageUrls[currentPage];
    const originalUrl = page?.original || currentInfo.urls.original || '';
    const regularUrl = page?.regular || currentInfo.urls.regular || currentInfo.urls.small;
    const url = originalUrl && (originalMode || preloadedOriginalUrls.has(originalUrl))
      ? originalUrl
      : (regularUrl || originalUrl);
    loading.hidden = false;
    error.hidden = true;
    previewImage.hidden = true;
    previewImage.alt = `${currentInfo.title} - ${currentPage + 1}`;
    previewImage.onload = () => {
      loading.hidden = true;
      previewImage.hidden = false;
      const format = extensionFromUrl(page?.original || url);
      const animation = currentInfo.isUgoira ? ` · ${t('workbenchUgoiraBadge', 'Ugoira')}` : '';
      facts.textContent = `${currentInfo.artist} · ${previewImage.naturalWidth}×${previewImage.naturalHeight} · ${format}${animation}`;
      scheduleInfoIslandPosition();
    };
    previewImage.onerror = () => {
      loading.hidden = true;
      error.textContent = t('workbenchImageFailed', 'Could not load this preview');
      error.hidden = false;
    };
    previewImage.src = url;
    const multi = currentInfo.pageUrls.length > 1;
    shadow.getElementById('ppw-page-nav').hidden = !multi;
    pageLabel.textContent = multi ? `${currentPage + 1} / ${currentInfo.pageUrls.length}` : '';
    shadow.getElementById('ppw-page-prev').disabled = currentPage === 0;
    shadow.getElementById('ppw-page-next').disabled = currentPage === max;
  }

  function moveWork(delta) {
    const visible = visibleRecords();
    if (!visible.length) return;
    const currentIndex = visible.findIndex(record => record.id === currentWorkId);
    const nextIndex = clamp((currentIndex < 0 ? 0 : currentIndex) + delta, 0, visible.length - 1);
    if (visible[nextIndex]) selectWork(visible[nextIndex].id);
  }

  function visibleRecords() {
    return store.all().filter(record => {
      const button = thumbElements.get(record.id);
      return button && !button.hidden;
    });
  }

  function openCurrentWork() {
    if (currentWorkId) window.open(`https://www.pixiv.net/artworks/${currentWorkId}`, '_blank', 'noopener');
  }

  function bookmarkControlIn(card) {
    if (!card) return null;
    const marker = card.querySelector([
      '[data-click-label="bookmark"]',
      'button[aria-label*="bookmark" i]',
      'button[aria-label*="ブックマーク"]',
      'button[aria-label*="收藏"]',
      'button[title*="bookmark" i]',
      'button[title*="ブックマーク"]',
      'button[title*="收藏"]'
    ].join(','));
    if (marker) return marker.matches('button') ? marker : (marker.querySelector('button') || marker);
    const buttons = [...card.querySelectorAll('button')]
      .filter(button => !button.classList.contains('pp-download-btn'));
    return buttons.length === 1 ? buttons[0] : null;
  }

  function nativeBookmarkButton(workId) {
    const card = sourceCards.get(String(workId));
    return card?.isConnected ? bookmarkControlIn(card) : null;
  }

  async function bookmarkCurrentWork() {
    if (!currentWorkId || !currentInfo || bookmarkButton.disabled) return;
    bookmarkButton.disabled = true;
    try {
      const nativeButton = nativeBookmarkButton(currentWorkId);
      if (nativeButton) {
        nativeButton.click();
        currentInfo.isBookmarked = !currentInfo.isBookmarked;
        if (!currentInfo.isBookmarked) currentInfo.bookmarkId = '';
      } else if (currentInfo.isBookmarked) {
        await window.PixivPlusAPI.unbookmarkWork(currentWorkId, currentInfo.bookmarkId);
        currentInfo.isBookmarked = false;
        currentInfo.bookmarkId = '';
      } else {
        const result = await window.PixivPlusAPI.bookmarkWork(currentWorkId);
        currentInfo.isBookmarked = true;
        currentInfo.bookmarkId = result.bookmarkId || currentInfo.bookmarkId || '';
      }
      renderInfo();
      showToast(t('workbenchBookmarkUpdated', 'Bookmark updated'));
    } catch (bookmarkError) {
      console.warn('[PixivPlus] Bookmark update failed', bookmarkError);
      showToast(t('workbenchBookmarkFailed', 'Could not update bookmark'));
    } finally {
      bookmarkButton.disabled = false;
    }
  }

  function downloadCurrentPage() {
    if (!currentInfo) return;
    if (currentInfo.isUgoira) {
      window.PixivPlusDownload.downloadAllWork(currentInfo);
      return;
    }
    const page = currentInfo.pageUrls[currentPage];
    if (!page?.original) return;
    const filename = window.PixivPlusAPI.generateFilename(currentInfo, currentPage);
    window.PixivPlusDownload.downloadFile(page.original, filename, currentInfo.tags, {
      thumbUrl: page.regular || currentInfo.urls.small || currentInfo.urls.regular || '',
      title: currentInfo.title,
      artist: currentInfo.artist,
      workId: currentInfo.id,
      pageIndex: currentPage
    });
  }

  function toggleBatchMode() {
    setBatchMode(!batchMode);
  }

  function setBatchMode(value) {
    batchMode = Boolean(value);
    shell.classList.toggle('batch', batchMode);
    shadow.getElementById('ppw-batch-toggle').classList.toggle('active', batchMode);
    if (!batchMode) {
      batchSelection.clear();
      lastBatchIndex = -1;
    } else if (currentWorkId) {
      batchSelection.add(currentWorkId);
      lastBatchIndex = store.indexOf(currentWorkId);
    }
    renderBatchSelection();
  }

  function renderBatchSelection() {
    for (const [id, button] of thumbElements) button.classList.toggle('batch-selected', batchSelection.has(id));
    batchCount.textContent = t('workbenchSelectedCount', '{count} selected').replace('{count}', String(batchSelection.size));
    batchBar.hidden = !batchMode;
    shadow.getElementById('ppw-batch-download').disabled = batchSelection.size === 0;
  }

  async function downloadBatch() {
    const ids = [...batchSelection];
    if (!ids.length) return;
    setBatchMode(false);
    showToast(t('workbenchBatchQueued', 'Preparing selected artworks…'));
    await window.PixivPlusDownload.downloadWorks(ids);
  }

  function applyFilter() {
    if (!shadow) return;
    const filter = shadow.getElementById('ppw-filter').value;
    for (const record of store.all()) {
      const visible = filter === 'all'
        || (filter === 'unread' && (record.id === currentWorkId || !seenWorkIds.has(record.id)));
      const button = thumbElements.get(record.id);
      if (button) button.hidden = !visible;
    }
    const visible = visibleRecords();
    if (visible.length && !visible.some(record => record.id === currentWorkId)) selectWork(visible[0].id, false);
    emptyState.hidden = store.size > 0 && visible.length > 0;
    if (!emptyState.hidden && store.size > 0) emptyState.textContent = t('workbenchNoMatches', 'No loaded artworks match this filter');
    updateCounts();
  }

  function cycleDensity() {
    density = density === 'balanced' ? 'compact' : density === 'compact' ? 'filmstrip' : 'balanced';
    applyDensity();
    chrome.storage.local.set({ workbenchDensity: density });
  }

  function applyDensity() {
    if (!shell) return;
    shell.dataset.density = density;
    shadow.getElementById('ppw-density').textContent = density === 'compact' ? '▦' : density === 'filmstrip' ? '▤' : '▥';
  }

  function bindResizer() {
    const resizer = shadow.getElementById('ppw-resizer');
    let startX = 0;
    let startWidth = 0;
    resizer.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startWidth = leftWidth;
      resizer.classList.add('dragging');
      resizer.setPointerCapture(event.pointerId);
    });
    resizer.addEventListener('pointermove', event => {
      if (!resizer.hasPointerCapture(event.pointerId)) return;
      leftWidth = clamp(startWidth + event.clientX - startX, 240, Math.min(520, window.innerWidth * 0.5));
      shell.style.setProperty('--ppw-left-width', `${leftWidth}px`);
    });
    resizer.addEventListener('pointerup', event => {
      if (!resizer.hasPointerCapture(event.pointerId)) return;
      resizer.releasePointerCapture(event.pointerId);
      resizer.classList.remove('dragging');
      chrome.storage.local.set({ workbenchLeftWidth: Math.round(leftWidth) });
    });
  }

  function onFeedScroll() {
    if (feed.scrollHeight - feed.scrollTop - feed.clientHeight > 700 || nativeLoadRequested) return;
    nativeLoadRequested = true;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    setTimeout(() => {
      nativeLoadRequested = false;
      scanDocument();
    }, 900);
  }

  function onWheel(event) {
    if (!currentInfo || previewImage.hidden) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.88 : 1.14));
  }

  function onPointerDown(event) {
    if (zoom <= 1 || event.button !== 0 || event.target.closest?.('button')) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    panX = pointerStart.panX + event.clientX - pointerStart.x;
    panY = pointerStart.panY + event.clientY - pointerStart.y;
    applyTransform();
  }

  function onPointerUp(event) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    pointerStart = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function setZoom(value) {
    zoom = clamp(value, 1, 8);
    if (zoom === 1) { panX = 0; panY = 0; }
    applyTransform();
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }

  function applyTransform() {
    if (previewImage) previewImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    scheduleInfoIslandPosition();
  }

  function scheduleInfoIslandPosition() {
    if (infoPositionQueued) return;
    infoPositionQueued = true;
    requestAnimationFrame(() => {
      infoPositionQueued = false;
      positionInfoIsland();
    });
  }

  function positionInfoIsland() {
    if (!details || !previewImage || previewImage.hidden || !workspaceVisible) return;
    const stage = shadow.getElementById('ppw-stage');
    const stageRect = stage.getBoundingClientRect();
    const imageRect = previewImage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height || !imageRect.width || !imageRect.height) return;

    const rightSpace = stageRect.right - imageRect.right;
    if (rightSpace >= 204) {
      details.dataset.placement = 'side';
      details.dataset.overlay = 'false';
      const width = clamp(rightSpace - 26, 184, 220);
      details.style.width = `${width}px`;
      details.style.left = `${imageRect.right - stageRect.left + 14}px`;
      const maxTop = Math.max(12, stageRect.height - details.offsetHeight - 12);
      const top = clamp(imageRect.top - stageRect.top + 6, 12, maxTop);
      details.style.top = `${top}px`;
      return;
    }

    details.dataset.placement = 'bottom';
    const maxWidth = Math.max(180, stageRect.width - 96);
    const width = Math.min(560, maxWidth, Math.max(260, imageRect.width));
    details.style.width = `${width}px`;
    const sideMargin = Math.min(48, Math.max(8, (stageRect.width - width) / 2));
    const centeredLeft = imageRect.left - stageRect.left + (imageRect.width - width) / 2;
    details.style.left = `${clamp(centeredLeft, sideMargin, stageRect.width - width - sideMargin)}px`;

    const height = details.offsetHeight;
    const belowTop = imageRect.bottom - stageRect.top + 12;
    const fitsBelow = belowTop + height <= stageRect.height - 44;
    details.dataset.overlay = fitsBelow ? 'false' : 'true';
    const overlayTop = imageRect.bottom - stageRect.top - height - 12;
    details.style.top = `${fitsBelow ? belowTop : clamp(overlayTop, 12, Math.max(12, stageRect.height - height - 44))}px`;
  }

  function onKeyDown(event) {
    if (!workspaceVisible || !isWorkbenchRoute() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const key = event.key.toLowerCase();
    if (['BUTTON', 'A'].includes(event.target?.tagName) && (event.code === 'Space' || event.key === 'Enter')) return;
    if (key === 'j') { event.preventDefault(); moveWork(1); }
    else if (key === 'k') { event.preventDefault(); moveWork(-1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); showPage(currentPage - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); showPage(currentPage + 1); }
    else if (key === 'd' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey && currentInfo) window.PixivPlusDownload.downloadAllWork(currentInfo);
      else downloadCurrentPage();
    } else if (key === 'b' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      bookmarkCurrentWork();
    } else if (event.code === 'Space') {
      event.preventDefault();
      focusMode = !focusMode;
      shell.classList.toggle('focus', focusMode);
    } else if (event.key === 'Escape') {
      if (batchMode) setBatchMode(false);
      else if (focusMode) { focusMode = false; shell.classList.remove('focus'); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openCurrentWork();
    }
  }

  function getWorkInfoCached(id) {
    const key = String(id);
    if (!workInfoCache.has(key)) {
      const request = window.PixivPlusAPI.getWorkInfo(key).catch(fetchError => {
        workInfoCache.delete(key);
        throw fetchError;
      });
      workInfoCache.set(key, request);
    }
    return workInfoCache.get(key);
  }

  function scheduleAutoOriginalPreload() {
    if ((!preloadOriginalsByDefault && !originalMode) || !workspaceVisible || store.size === 0) return;
    clearTimeout(autoPreloadTimer);
    autoPreloadTimer = setTimeout(() => preloadCurrentPageOriginals(false), 500);
  }

  function preloadOriginalImage(url) {
    if (!url || preloadedOriginalUrls.has(url)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error('ORIGINAL_PRELOAD_TIMEOUT')), 45000);
      image.decoding = 'async';
      image.onload = () => {
        clearTimeout(timer);
        preloadedOriginalUrls.add(url);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error('ORIGINAL_PRELOAD_FAILED'));
      };
      image.src = url;
    });
  }

  function updatePreloadButton(done, total, state = 'loading') {
    if (!loadOriginalsButton) return;
    loadOriginalsButton.classList.toggle('loading', state === 'loading');
    loadOriginalsButton.classList.toggle('active', state === 'ready');
    loadOriginalsButton.disabled = state === 'loading';
    loadOriginalsButton.querySelector('span').textContent = state === 'ready' ? '✓' : '◉';
    const label = loadOriginalsButton.querySelector('.label');
    if (state === 'loading') {
      label.textContent = t('workbenchOriginalsProgress', 'Originals {done}/{total}')
        .replace('{done}', String(done)).replace('{total}', String(total));
    } else if (state === 'ready') {
      label.textContent = t('workbenchOriginalsReady', 'Originals ready');
    } else {
      label.textContent = t('workbenchLoadOriginals', 'Load page originals');
    }
  }

  function preloadCurrentPageOriginals(manual) {
    if (preloadRun) return preloadRun;
    if (manual) {
      originalMode = true;
      failedOriginalWorkIds.clear();
    }
    const records = store.all().filter(record => (
      !preloadedOriginalWorkIds.has(record.id) && !failedOriginalWorkIds.has(record.id)
    ));
    if (!records.length) {
      updatePreloadButton(0, 0, 'ready');
      if (currentInfo && originalMode) showPage(currentPage);
      return Promise.resolve();
    }

    const total = records.length;
    let cursor = 0;
    let finished = 0;
    let failed = 0;
    updatePreloadButton(0, total, 'loading');

    preloadRun = (async () => {
      const worker = async () => {
        while (cursor < records.length) {
          const record = records[cursor++];
          try {
            const info = await getWorkInfoCached(record.id);
            const originalUrl = info.pageUrls?.[0]?.original || info.urls?.original || '';
            if (!originalUrl) throw new Error('ORIGINAL_URL_MISSING');
            await preloadOriginalImage(originalUrl);
            preloadedOriginalWorkIds.add(record.id);
            const updated = store.update(record.id, {
              title: info.title,
              artist: info.artist,
              thumbUrl: info.urls.small || info.urls.regular || record.thumbUrl,
              pageCount: info.pageCount,
              isUgoira: info.isUgoira,
              loaded: true
            });
            updateThumbnail(updated);
          } catch (preloadError) {
            failed++;
            failedOriginalWorkIds.add(record.id);
            console.warn('[PixivPlus] Original preload failed', record.id, preloadError);
          } finally {
            finished++;
            updatePreloadButton(finished, total, 'loading');
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    })().finally(() => {
      preloadRun = null;
      updatePreloadButton(finished, total, failed === total ? 'idle' : 'ready');
      if (currentInfo && originalMode) showPage(currentPage);
      const message = failed
        ? t('workbenchOriginalsPartial', '{count} originals could not be loaded').replace('{count}', String(failed))
        : t('workbenchOriginalsReady', 'Originals ready');
      showToast(message);
      if (preloadOriginalsByDefault || originalMode) scheduleAutoOriginalPreload();
    });
    return preloadRun;
  }

  function prefetchNext() {
    const index = store.indexOf(currentWorkId);
    const next = store.all()[index + 1];
    if (!next || next.loaded) return;
    const prefetch = () => getWorkInfoCached(next.id).then(info => {
      const updated = store.update(next.id, {
        title: info.title, artist: info.artist,
        thumbUrl: info.urls.small || info.urls.regular || next.thumbUrl,
        pageCount: info.pageCount, isUgoira: info.isUgoira, loaded: true
      });
      updateThumbnail(updated);
    }).catch(() => {});
    if ('requestIdleCallback' in window) window.requestIdleCallback(prefetch, { timeout: 1200 });
    else setTimeout(prefetch, 700);
  }

  function updateCounts() {
    if (!shadow) return;
    const unread = store.all().filter(record => !seenWorkIds.has(record.id)).length;
    shadow.getElementById('ppw-count').textContent = `${unread} / ${store.size}`;
    shadow.getElementById('ppw-summary').textContent = t('workbenchSummary', '{count} artworks · {unread} unread')
      .replace('{count}', String(store.size)).replace('{unread}', String(unread));
  }

  function createUnreadMarker() {
    const unread = document.createElement('span');
    unread.className = 'ppw-unread';
    unread.setAttribute('aria-hidden', 'true');
    return unread;
  }

  function replaceSeenWorkIds(value) {
    seenWorkIds.clear();
    if (!Array.isArray(value)) return;
    for (const id of value) {
      const normalized = String(id || '');
      if (normalized) seenWorkIds.add(normalized);
    }
  }

  function markWorkSeen(id) {
    const normalized = String(id || '');
    if (!normalized || seenWorkIds.has(normalized)) return;
    seenWorkIds.add(normalized);
    chrome.storage.local.set({ [SEEN_WORKS_STORAGE_KEY]: [...seenWorkIds] });
  }

  function syncSeenState() {
    if (!shadow) return;
    for (const record of store.all()) {
      const button = thumbElements.get(record.id);
      if (!button) continue;
      const marker = button.querySelector('.ppw-unread');
      if (seenWorkIds.has(record.id)) marker?.remove();
      else if (!marker) button.insertBefore(createUnreadMarker(), button.querySelector('.ppw-check'));
    }
    updateCounts();
    if (shadow.getElementById('ppw-filter').value === 'unread') applyFilter();
  }

  function showToast(message) {
    const toast = shadow.getElementById('ppw-toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
  }

  function extensionFromUrl(url) {
    return url?.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toUpperCase() || 'IMAGE';
  }

  function findSourceCard(link, workId) {
    let candidate = link.parentElement || link;
    let node = candidate;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const workIds = new Set(
        [...node.querySelectorAll('a[href*="/artworks/"]')]
          .map(anchor => model.extractWorkId(anchor.href || anchor.getAttribute('href')))
          .filter(Boolean)
      );
      if (workIds.size === 1 && workIds.has(workId)) {
        candidate = node;
        if (bookmarkControlIn(node)) break;
      } else if (workIds.size > 1) {
        break;
      }
    }
    return candidate;
  }

  function friendlyError(fetchError) {
    if (fetchError?.message === 'NOT_FOUND') return t('workbenchNotFound', 'This artwork is unavailable');
    if (fetchError?.message === 'FORBIDDEN') return t('workbenchLoginRequired', 'Log in to Pixiv to view this artwork');
    return t('workbenchLoadFailed', 'Could not load this artwork');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  window.PixivPlusWorkbench = {
    isActive: () => workspaceVisible && isWorkbenchRoute(),
    show: showWorkbench,
    showOriginal: showOriginalPage,
    rescan: scheduleScan
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
