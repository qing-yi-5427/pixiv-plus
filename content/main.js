// PixivPlus - Content Script Entry Point

(() => {
  'use strict';

  const THUMBNAIL_SELECTOR = 'a[href*="/artworks/"]';
  const CARD_SELECTOR = 'li, section';

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    window.PixivPlusDownloadPanel.init();
    scan();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 0) { scan(); return; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function scan() {
    const links = document.querySelectorAll(THUMBNAIL_SELECTOR);
    for (const link of links) {
      if (link.dataset.ppHover) continue;
      link.dataset.ppHover = 'true';
      link.addEventListener('mouseenter', () => window.PixivPlusHover.requestShow(link));
      link.addEventListener('mouseleave', () => window.PixivPlusHover.cancelOrHide());
    }

    const cards = document.querySelectorAll(
      `${CARD_SELECTOR}:has(${THUMBNAIL_SELECTOR}), div:has(> ${THUMBNAIL_SELECTOR})`
    );
    for (const card of cards) {
      if (card.dataset.ppCard) continue;
      card.dataset.ppCard = 'true';
      window.PixivPlusDownload.addDownloadIcon(card);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
