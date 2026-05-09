// PixivPlus - Hover Preview
// Shows original image overlay with zoom toggle, download and bookmark actions

(() => {
  'use strict';

  const SHOW_DELAY = 400;

  let host = null;
  let overlay = null;
  let imgEl = null;
  let spinnerEl = null;
  let errorEl = null;
  let btnDownload = null;
  let btnBookmark = null;
  let infoEl = null;
  let currentWorkId = null;
  let currentInfo = null;
  let showTimer = null;
  let pendingWorkId = null;
  let zoomed = false;

  let enabled = true;
  let delay = 400;

  chrome.storage.local.get({ hoverPreview: true, hoverDelay: 400 }, (s) => {
    enabled = s.hoverPreview;
    delay = s.hoverDelay;
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hoverPreview !== undefined) enabled = changes.hoverPreview.newValue;
    if (changes.hoverDelay !== undefined) delay = changes.hoverDelay.newValue;
  });

  function ensureUI() {
    if (host) return;

    host = document.createElement('div');
    host.id = 'pp-hover-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .pp-overlay {
        position: fixed; top:0; left:0; right:0; bottom:0;
        display: none; align-items: center; justify-content: center;
        flex-direction: column;
        pointer-events: none;
        background: rgba(0,0,0,0.6);
        animation: pp-in 0.15s ease;
      }
      .pp-overlay.visible { display: flex; pointer-events: auto; }
      @keyframes pp-in { from { opacity:0; } to { opacity:1; } }

      .pp-img-wrap {
        position: relative;
        cursor: zoom-in;
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 90vw;
        max-height: calc(90vh - 60px);
        overflow: hidden;
      }
      .pp-img-wrap.zoomed {
        max-width: none;
        max-height: none;
        overflow: auto;
        cursor: zoom-out;
      }
      .pp-img {
        max-width: 90vw;
        max-height: calc(90vh - 60px);
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        transition: none;
      }
      .pp-img-wrap.zoomed .pp-img {
        max-width: none;
        max-height: none;
      }
      .pp-img.hidden { display: none; }

      .pp-spinner { position: absolute; }
      .pp-spinner.hidden { display: none; }
      .pp-spin {
        width: 36px; height: 36px;
        border: 3px solid rgba(255,255,255,0.2);
        border-top-color: #0096fa;
        border-radius: 50%;
        animation: pp-spin 0.7s linear infinite;
      }
      @keyframes pp-spin { to { transform: rotate(360deg); } }

      .pp-error {
        position: absolute;
        color: #ff6b6b; font-size: 13px;
        background: rgba(0,0,0,0.8);
        padding: 6px 14px; border-radius: 4px;
      }
      .pp-error.hidden { display: none; }

      .pp-info {
        color: rgba(255,255,255,0.6);
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        margin-top: 8px;
        text-align: center;
        max-width: 80vw;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pp-actions {
        display: flex; gap: 10px;
        margin-top: 10px;
      }
      .pp-action-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 6px 14px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: #cdd6f4;
        font-size: 12px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        transition: background 0.15s;
      }
      .pp-action-btn:hover { background: rgba(255,255,255,0.2); }
      .pp-action-btn svg { width: 16px; height: 16px; }

      .pp-hint {
        position: fixed;
        bottom: 12px;
        color: rgba(255,255,255,0.3);
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        pointer-events: none;
      }
    `;
    shadow.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'pp-overlay';

    const wrap = document.createElement('div');
    wrap.className = 'pp-img-wrap';
    wrap.id = 'pp-img-wrap';

    imgEl = document.createElement('img');
    imgEl.className = 'pp-img';

    spinnerEl = document.createElement('div');
    spinnerEl.className = 'pp-spinner';
    spinnerEl.innerHTML = '<div class="pp-spin"></div>';

    errorEl = document.createElement('div');
    errorEl.className = 'pp-error';

    wrap.appendChild(imgEl);
    wrap.appendChild(spinnerEl);
    wrap.appendChild(errorEl);

    infoEl = document.createElement('div');
    infoEl.className = 'pp-info';

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'pp-actions';

    btnBookmark = document.createElement('button');
    btnBookmark.className = 'pp-action-btn';
    btnBookmark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>Bookmark';

    btnDownload = document.createElement('button');
    btnDownload.className = 'pp-action-btn';
    btnDownload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download';

    actions.appendChild(btnBookmark);
    actions.appendChild(btnDownload);

    const hint = document.createElement('div');
    hint.className = 'pp-hint';
    hint.textContent = 'Click image to zoom · Click backdrop to close';

    overlay.appendChild(wrap);
    overlay.appendChild(infoEl);
    overlay.appendChild(actions);
    overlay.appendChild(hint);
    shadow.appendChild(overlay);

    // --- Events ---

    // Click backdrop (overlay itself, not children) to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hide();
      }
    });

    // Click image to toggle zoom
    imgEl.addEventListener('click', () => {
      const w = shadow.getElementById('pp-img-wrap');
      zoomed = !zoomed;
      if (zoomed) {
        w.classList.add('zoomed');
      } else {
        w.classList.remove('zoomed');
      }
    });

    // Download button
    btnDownload.addEventListener('click', () => {
      if (currentWorkId && currentInfo) {
        window.PixivPlusDownload.downloadWork(currentWorkId);
      }
    });

    // Bookmark button - trigger Pixiv's native bookmark
    btnBookmark.addEventListener('click', () => {
      if (!currentWorkId) return;
      const btn = document.querySelector('button[data-click-label="bookmark"], button[aria-label*="bookmark" i], button[aria-label*="ブックマーク"]');
      if (btn) {
        btn.click();
        window.PixivPlusDownloadPanel?.showToast('Bookmarked!', 'success');
      } else {
        window.open(`https://www.pixiv.net/bookmark_add.php?type=illust&illust_id=${currentWorkId}`, '_blank');
      }
    });

    document.body.appendChild(host);
  }

  // --- Trigger ---

  function requestShow(thumbnailEl) {
    if (!enabled) return;
    const workId = extractWorkId(thumbnailEl);
    if (!workId) return;
    if (workId === currentWorkId) return;

    cancelPending();
    pendingWorkId = workId;
    showTimer = setTimeout(() => {
      if (pendingWorkId === workId) show(workId);
    }, delay);
  }

  function cancelOrHide() {
    cancelPending();
  }

  function cancelPending() {
    clearTimeout(showTimer);
    showTimer = null;
    pendingWorkId = null;
  }

  async function show(workId) {
    currentWorkId = workId;
    zoomed = false;
    ensureUI();

    const w = host.shadowRoot.getElementById('pp-img-wrap');
    w.classList.remove('zoomed');

    imgEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    btnDownload.style.display = 'none';
    btnBookmark.style.display = 'none';
    infoEl.textContent = '';
    spinnerEl.classList.remove('hidden');
    overlay.classList.add('visible');

    try {
      const info = await window.PixivPlusAPI.getWorkInfo(workId);
      if (currentWorkId !== workId) return;

      currentInfo = info;

      if (info.isUgoira) {
        showError('Ugoira not supported');
        return;
      }

      const url = info.pageUrls[0]?.original;
      if (!url) throw new Error('No original URL');

      infoEl.textContent = `${info.artist} — ${info.title}`;
      btnDownload.style.display = '';
      btnBookmark.style.display = '';

      imgEl.src = url;
      imgEl.onload = () => {
        if (currentWorkId !== workId) return;
        spinnerEl.classList.add('hidden');
        imgEl.classList.remove('hidden');
      };
      imgEl.onerror = () => {
        if (currentWorkId !== workId) return;
        showError('Failed to load image');
      };
    } catch (err) {
      if (currentWorkId !== workId) return;
      const msg = err.message === 'NOT_FOUND' ? 'Work not found'
                : err.message === 'FORBIDDEN' ? 'Login required'
                : 'Failed to load';
      showError(msg);
    }
  }

  function showError(msg) {
    spinnerEl.classList.add('hidden');
    imgEl.classList.add('hidden');
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    btnDownload.style.display = 'none';
    btnBookmark.style.display = 'none';
    setTimeout(hide, 2000);
  }

  function hide() {
    cancelPending();
    currentWorkId = null;
    currentInfo = null;
    zoomed = false;
    if (overlay) {
      overlay.classList.remove('visible');
      imgEl.src = '';
      imgEl.onload = null;
      imgEl.onerror = null;
    }
  }

  function extractWorkId(el) {
    const link = el.closest('a[href*="/artworks/"]')
              || el.querySelector('a[href*="/artworks/"]')
              || (el.tagName === 'A' && el.href?.includes('/artworks/') ? el : null);
    if (link) {
      const match = link.href.match(/\/artworks\/(\d+)/);
      if (match) return match[1];
    }
    return el.dataset.workId || el.dataset.illustId || null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentWorkId) hide();
  });

  window.PixivPlusHover = { requestShow, cancelOrHide, extractWorkId };
})();
