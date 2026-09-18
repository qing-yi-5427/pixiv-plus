// PixivPlus - Content Script Entry Point

(() => {
  'use strict';

  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    window.PixivPlusDownloadPanel.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
