// PixivPlus - Hover Preview
// Modern dark panel with right-side action bar, page/work navigation, drag-to-pan zoom

(() => {
  'use strict';

  let host = null;
  let overlay = null;
  let imgEl = null;
  let spinnerEl = null;
  let errorEl = null;
  let btnDownload = null;
  let btnBookmark = null;
  let btnClose = null;
  let btnPrev = null;
  let btnNext = null;
  let pageInfoEl = null;
  let infoEl = null;
  let currentWorkId = null;
  let currentInfo = null;
  let currentPage = 0;
  let currentTriggerEl = null;
  let showTimer = null;
  let pendingWorkId = null;
  let zoomed = false;

  // Drag state
  let dragging = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panX = 0;
  let panY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let lastClickTime = 0;

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

  function getWorkList() {
    const links = document.querySelectorAll('a[href*="/artworks/"]');
    const seen = new Set();
    const result = [];
    for (const link of links) {
      const match = link.href.match(/\/artworks\/(\d+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ id, el: link });
    }
    return result;
  }

  function findWorkIndex() {
    if (!currentWorkId) return -1;
    const list = getWorkList();
    return list.findIndex(w => w.id === currentWorkId);
  }

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
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        animation: pp-in 0.2s cubic-bezier(0.16,1,0.3,1);
      }
      .pp-overlay.visible { display: flex; pointer-events: auto; }
      @keyframes pp-in { from { opacity:0; } to { opacity:1; } }

      .pp-panel {
        display: flex;
        background: #0a0a0c;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.1);
        overflow: hidden;
        max-width: 92vw;
        max-height: 90vh;
        animation: pp-panel-in 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      @keyframes pp-panel-in {
        from { opacity:0; transform: scale(0.95) translateY(8px); }
        to { opacity:1; transform: scale(1) translateY(0); }
      }

      .pp-main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 0;
        flex: 1;
        padding: 12px;
        position: relative;
        overflow: hidden;
      }
      .pp-main.zoomed {
        padding: 0;
      }
      .pp-main.zoomed .pp-info {
        display: none;
      }

      .pp-img-wrap {
        position: relative;
        cursor: zoom-in;
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        max-height: calc(85vh - 60px);
        overflow: hidden;
        border-radius: 8px;
        background: #111114;
      }
      .pp-img-wrap.zoomed {
        max-width: none;
        max-height: none;
        width: 100%;
        height: 90vh;
        flex: 1;
        overflow: hidden;
        cursor: grab;
        align-items: flex-start;
        justify-content: flex-start;
        border-radius: 0;
      }
      .pp-img-wrap.zoomed.dragging {
        cursor: grabbing;
      }
      .pp-img {
        max-width: 100%;
        max-height: calc(85vh - 60px);
        object-fit: contain;
        display: block;
        transition: none;
        user-select: none;
        -webkit-user-drag: none;
      }
      .pp-img-wrap.zoomed .pp-img {
        max-width: none;
        max-height: none;
        min-width: 100%;
        min-height: 100%;
        object-fit: none;
        transform-origin: 0 0;
      }
      .pp-img.hidden { display: none; }

      .pp-spinner { position: absolute; }
      .pp-spinner.hidden { display: none; }
      .pp-spin {
        width: 36px; height: 36px;
        border: 3px solid rgba(255,255,255,0.1);
        border-top-color: #5E6AD2;
        border-radius: 50%;
        animation: pp-spin 0.7s linear infinite;
      }
      @keyframes pp-spin { to { transform: rotate(360deg); } }

      .pp-error {
        position: absolute;
        color: #ff6b6b; font-size: 13px;
        background: #1a1a1e;
        border: 1px solid rgba(255,107,107,0.2);
        padding: 8px 16px; border-radius: 8px;
      }
      .pp-error.hidden { display: none; }

      .pp-info {
        color: #8A8F98;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        margin-top: 10px;
        text-align: center;
        max-width: 80%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pp-sidebar {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 8px;
        gap: 4px;
        background: #0e0e11;
        border-left: 1px solid rgba(255,255,255,0.06);
        min-width: 52px;
      }

      .pp-sidebar-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: transparent;
        border: none;
        border-radius: 10px;
        color: #8A8F98;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .pp-sidebar-btn:hover {
        background: rgba(255,255,255,0.08);
        color: #EDEDEF;
      }
      .pp-sidebar-btn:active {
        background: rgba(255,255,255,0.12);
      }
      .pp-sidebar-btn svg {
        width: 20px;
        height: 20px;
      }
      .pp-sidebar-btn.hidden { display: none; }
      .pp-sidebar-btn.disabled {
        opacity: 0.3;
        pointer-events: none;
      }

      .pp-close-btn {
        color: #6B7080;
        margin-bottom: 8px;
      }
      .pp-close-btn:hover {
        background: rgba(255,255,255,0.06);
        color: #EDEDEF;
      }

      .pp-sidebar-sep {
        width: 24px;
        height: 1px;
        background: rgba(255,255,255,0.06);
        margin: 4px 0;
      }

      .pp-sidebar-label {
        color: #5A5F6A;
        font-size: 9px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        text-align: center;
        margin-top: -2px;
        user-select: none;
      }

      .pp-page-info {
        color: #5A5F6A;
        font-size: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        text-align: center;
        user-select: none;
        line-height: 1.2;
      }

      .pp-hint {
        position: fixed;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255,255,255,0.25);
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        pointer-events: none;
      }
    `;
    shadow.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'pp-overlay';

    const panel = document.createElement('div');
    panel.className = 'pp-panel';

    // Main area
    const main = document.createElement('div');
    main.className = 'pp-main';

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

    main.appendChild(wrap);
    main.appendChild(infoEl);

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'pp-sidebar';

    btnClose = document.createElement('button');
    btnClose.className = 'pp-sidebar-btn pp-close-btn';
    btnClose.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btnClose.title = 'Close (Esc)';

    const sep1 = document.createElement('div');
    sep1.className = 'pp-sidebar-sep';

    btnDownload = document.createElement('button');
    btnDownload.className = 'pp-sidebar-btn';
    btnDownload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    btnDownload.title = 'Download';

    const labelDownload = document.createElement('div');
    labelDownload.className = 'pp-sidebar-label';
    labelDownload.textContent = 'Save';

    btnBookmark = document.createElement('button');
    btnBookmark.className = 'pp-sidebar-btn';
    btnBookmark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
    btnBookmark.title = 'Bookmark';

    const labelBookmark = document.createElement('div');
    labelBookmark.className = 'pp-sidebar-label';
    labelBookmark.textContent = 'Like';

    const sep2 = document.createElement('div');
    sep2.className = 'pp-sidebar-sep';

    btnPrev = document.createElement('button');
    btnPrev.className = 'pp-sidebar-btn';
    btnPrev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>';
    btnPrev.title = 'Previous (←)';

    pageInfoEl = document.createElement('div');
    pageInfoEl.className = 'pp-page-info';

    btnNext = document.createElement('button');
    btnNext.className = 'pp-sidebar-btn';
    btnNext.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
    btnNext.title = 'Next (→)';

    sidebar.appendChild(btnClose);
    sidebar.appendChild(sep1);
    sidebar.appendChild(btnDownload);
    sidebar.appendChild(labelDownload);
    sidebar.appendChild(btnBookmark);
    sidebar.appendChild(labelBookmark);
    sidebar.appendChild(sep2);
    sidebar.appendChild(btnPrev);
    sidebar.appendChild(pageInfoEl);
    sidebar.appendChild(btnNext);

    panel.appendChild(main);
    panel.appendChild(sidebar);

    const hint = document.createElement('div');
    hint.className = 'pp-hint';
    hint.textContent = 'Click image to zoom · Drag to pan · ← → navigate · Esc to close';

    overlay.appendChild(panel);
    overlay.appendChild(hint);
    shadow.appendChild(overlay);

    // --- Events ---

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hide();
      }
    });

    // Zoom toggle on click (only without drag)
    wrap.addEventListener('mousedown', (e) => {
      if (!zoomed) return;
      e.preventDefault();
      dragging = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      wrap.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      panX = panStartX + dx;
      panY = panStartY + dy;
      clampAndApplyPan();
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const w = host?.shadowRoot?.getElementById('pp-img-wrap');
      if (w) w.classList.remove('dragging');
    });

    imgEl.addEventListener('click', (e) => {
      if (dragMoved) return;
      const now = Date.now();
      if (zoomed) {
        if (now - lastClickTime < 350) {
          exitZoom();
          lastClickTime = 0;
        } else {
          lastClickTime = now;
        }
        return;
      }
      const w = shadow.getElementById('pp-img-wrap');
      const m = shadow.querySelector('.pp-main');
      zoomed = true;
      panX = 0;
      panY = 0;
      applyPan();
      w.classList.add('zoomed');
      m.classList.add('zoomed');
    });

    btnClose.addEventListener('click', () => hide());

    btnDownload.addEventListener('click', () => {
      if (currentWorkId && currentInfo) {
        window.PixivPlusDownload.downloadWork(currentWorkId);
      }
    });

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

    btnPrev.addEventListener('click', () => navigate(-1));
    btnNext.addEventListener('click', () => navigate(1));

    document.body.appendChild(host);
  }

  function exitZoom() {
    const w = host?.shadowRoot?.getElementById('pp-img-wrap');
    const m = host?.shadowRoot?.querySelector('.pp-main');
    zoomed = false;
    panX = 0;
    panY = 0;
    imgEl.style.transform = '';
    if (w) w.classList.remove('zoomed', 'dragging');
    if (m) m.classList.remove('zoomed');
  }

  function applyPan() {
    if (!imgEl) return;
    imgEl.style.transform = `translate(${panX}px, ${panY}px)`;
  }

  function clampAndApplyPan() {
    const wrap = host?.shadowRoot?.getElementById('pp-img-wrap');
    if (!wrap || !imgEl) return;

    const wrapRect = wrap.getBoundingClientRect();
    const imgW = imgEl.naturalWidth;
    const imgH = imgEl.naturalHeight;

    const maxPanX = Math.max(0, (imgW - wrapRect.width) / 2);
    const maxPanY = Math.max(0, (imgH - wrapRect.height) / 2);

    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));

    applyPan();
  }

  function updatePageUI() {
    if (!currentInfo) return;
    const totalPages = currentInfo.pageUrls.length;
    const workIdx = findWorkIndex();
    const workList = getWorkList();
    const atFirstWork = workIdx <= 0;
    const atLastWork = workIdx >= workList.length - 1;

    if (totalPages > 1) {
      const atFirstPage = currentPage === 0;
      const atLastPage = currentPage === totalPages - 1;
      btnPrev.classList.toggle('disabled', atFirstPage && atFirstWork);
      btnNext.classList.toggle('disabled', atLastPage && atLastWork);
      pageInfoEl.textContent = `${currentPage + 1}/${totalPages}`;
    } else {
      btnPrev.classList.toggle('disabled', atFirstWork);
      btnNext.classList.toggle('disabled', atLastWork);
      pageInfoEl.textContent = '';
    }

    btnPrev.classList.remove('hidden');
    btnNext.classList.remove('hidden');
  }

  // Navigate: direction = -1 (prev) or +1 (next)
  // Multi-page: flip pages within same work, cross to adjacent work at edges
  // Single-page: switch between works directly
  function navigate(dir) {
    if (!currentInfo) return;
    const totalPages = currentInfo.pageUrls.length;

    if (totalPages > 1) {
      const nextPage = currentPage + dir;
      if (nextPage >= 0 && nextPage < totalPages) {
        goToPage(nextPage);
        return;
      }
      // Cross to adjacent work
      switchWork(dir);
    } else {
      switchWork(dir);
    }
  }

  function switchWork(dir) {
    const workList = getWorkList();
    const idx = workList.findIndex(w => w.id === currentWorkId);
    if (idx < 0) return;

    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= workList.length) return;

    const nextWork = workList[nextIdx];
    currentTriggerEl = nextWork.el;
    show(nextWork.id);
  }

  function goToPage(page) {
    if (!currentInfo) return;
    const total = currentInfo.pageUrls.length;
    if (page < 0 || page >= total) return;
    if (page === currentPage) return;

    currentPage = page;
    const url = currentInfo.pageUrls[page]?.original;
    if (!url) return;

    if (zoomed) {
      panX = 0;
      panY = 0;
      applyPan();
    }

    imgEl.classList.add('hidden');
    spinnerEl.classList.remove('hidden');

    imgEl.src = url;
    imgEl.onload = () => {
      spinnerEl.classList.add('hidden');
      imgEl.classList.remove('hidden');
    };
    imgEl.onerror = () => {
      spinnerEl.classList.add('hidden');
      showError('Failed to load image');
    };

    updatePageUI();
  }

  // --- Trigger ---

  function requestShow(thumbnailEl) {
    if (!enabled) return;
    const workId = extractWorkId(thumbnailEl);
    if (!workId) return;
    if (workId === currentWorkId) return;

    cancelPending();
    currentTriggerEl = thumbnailEl;
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
    currentPage = 0;
    zoomed = false;
    panX = 0;
    panY = 0;
    ensureUI();

    const w = host.shadowRoot.getElementById('pp-img-wrap');
    const m = host.shadowRoot.querySelector('.pp-main');
    w.classList.remove('zoomed');
    w.classList.remove('dragging');
    if (m) m.classList.remove('zoomed');
    applyPan();

    imgEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    btnDownload.classList.add('hidden');
    btnBookmark.classList.add('hidden');
    pageInfoEl.textContent = '';
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
      btnDownload.classList.remove('hidden');
      btnBookmark.classList.remove('hidden');
      updatePageUI();

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
    btnDownload.classList.add('hidden');
    btnBookmark.classList.add('hidden');
    btnPrev.classList.add('hidden');
    btnNext.classList.add('hidden');
    pageInfoEl.textContent = '';
    setTimeout(hide, 2000);
  }

  function hide() {
    cancelPending();
    currentWorkId = null;
    currentInfo = null;
    currentPage = 0;
    zoomed = false;
    panX = 0;
    panY = 0;
    dragging = false;
    currentTriggerEl = null;
    if (overlay) {
      overlay.classList.remove('visible');
      imgEl.src = '';
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.style.transform = '';
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
    if (e.key === 'ArrowLeft' && currentWorkId) navigate(-1);
    if (e.key === 'ArrowRight' && currentWorkId) navigate(1);
  });

  window.PixivPlusHover = { requestShow, cancelOrHide, extractWorkId };
})();
