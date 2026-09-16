// PixivPlus - Content Script Entry Point

(() => {
  'use strict';

  const THUMBNAIL_SELECTOR = 'a[href*="/artworks/"]';

  let initialized = false;
  let scanScheduled = false;

  function init() {
    if (initialized) return;
    initialized = true;

    window.PixivPlusDownloadPanel.init();
    scan();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 0) { scheduleScan(); return; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  function scan() {
    const links = document.querySelectorAll(THUMBNAIL_SELECTOR);
    for (const link of links) {
      if (!link.dataset.ppHover) {
        link.dataset.ppHover = 'true';
        link.addEventListener('mouseenter', () => window.PixivPlusHover.requestShow(link));
        link.addEventListener('mouseleave', () => window.PixivPlusHover.cancelOrHide());
      }

      const card = link.closest('li, section') || link.parentElement;
      if (card && !card.dataset.ppCard) {
        card.dataset.ppCard = 'true';
        window.PixivPlusDownload.addDownloadIcon(card);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
