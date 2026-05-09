// PixivPlus - Pixiv API Wrapper
// Fetches work info via /ajax/illust/{id}, handles caching and rate limiting

(() => {
  'use strict';

  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const MIN_REQUEST_INTERVAL = 500; // 500ms between API calls
  const RETRY_DELAY = 60 * 1000; // 60s on 429

  const cache = new Map();
  let lastRequestTime = 0;
  let requestQueue = Promise.resolve();

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  }

  function truncateName(name, maxLen) {
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 3) + '...';
  }

  async function fetchWithRateLimit(url) {
    const now = Date.now();
    const wait = Math.max(0, MIN_REQUEST_INTERVAL - (now - lastRequestTime));
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    lastRequestTime = Date.now();

    const resp = await fetch(url, { credentials: 'include' });

    if (resp.status === 429) {
      console.warn('[PixivPlus] Rate limited, retrying in 60s');
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      lastRequestTime = Date.now();
      const retry = await fetch(url, { credentials: 'include' });
      if (retry.status === 429) throw new Error('RATE_LIMITED');
      return retry;
    }

    if (resp.status === 404) throw new Error('NOT_FOUND');
    if (resp.status === 403) throw new Error('FORBIDDEN');
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
    return resp;
  }

  async function getWorkInfo(workId) {
    // Check cache
    const cached = cache.get(workId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // Serialize requests
    return requestQueue = requestQueue.then(async () => {
      // Double-check cache after queue wait
      const cached2 = cache.get(workId);
      if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
        return cached2.data;
      }

      const resp = await fetchWithRateLimit(`/ajax/illust/${workId}`);
      const json = await resp.json();

      if (!json.body) throw new Error('INVALID_RESPONSE');

      const body = json.body;
      console.log('[PixivPlus] tags raw:', JSON.stringify(body.tags?.tags?.slice(0, 3)));
      const data = {
        id: body.id,
        title: body.title || 'Untitled',
        artist: body.userName || 'Unknown',
        pageCount: body.pageCount || 1,
        isUgoira: body.illustType === 2,
        tags: (body.tags?.tags || []).map(t => t.tag).filter(Boolean),
        urls: {
          original: body.urls?.original || '',
          regular: body.urls?.regular || '',
          small: body.urls?.small || ''
        },
        originalImageUrl: body.metaSinglePage?.originalImageUrl || ''
      };

      // Build all page URLs
      data.pageUrls = buildPageUrls(data);

      cache.set(workId, { data, timestamp: Date.now() });
      return data;
    });
  }

  function buildPageUrls(workInfo) {
    const urls = [];

    if (workInfo.pageCount === 1) {
      urls.push({
        original: workInfo.originalImageUrl || workInfo.urls.original,
        regular: workInfo.urls.regular
      });
      return urls;
    }

    // Multi-page: template from page 0 URL
    const template = workInfo.urls.original;
    const regTemplate = workInfo.urls.regular;
    if (!template) return urls;

    const ext = template.match(/\.(png|jpg|jpeg|gif|webp)$/)?.[0] || '.png';

    for (let i = 0; i < workInfo.pageCount; i++) {
      const origUrl = template.replace(/_p0(\.\w+)$/, `_p${i}${ext}`);
      const regUrl = regTemplate ? regTemplate.replace(/_p0(\.\w+)$/, `_p${i}${ext}`) : '';
      urls.push({ original: origUrl, regular: regUrl });
    }

    return urls;
  }

  // Default template, can be overridden via chrome.storage
  let filenameTemplate = '{artist}-{title}-{id}';

  chrome.storage.local.get({ filenameTemplate: '{artist}-{title}-{id}' }, (s) => {
    filenameTemplate = s.filenameTemplate;
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.filenameTemplate) filenameTemplate = changes.filenameTemplate.newValue;
  });

  function generateFilename(workInfo, pageIndex) {
    const artist = truncateName(sanitizeFilename(workInfo.artist), 50);
    const title = truncateName(sanitizeFilename(workInfo.title), 80);
    const id = workInfo.id;
    const page = workInfo.pageCount > 1 ? `_p${pageIndex}` : '';
    const url = workInfo.pageUrls[pageIndex]?.original || '';
    const ext = url.match(/\.(png|jpg|jpeg|gif|webp)$/)?.[0] || '.png';

    let name = filenameTemplate
      .replace(/\{artist\}/g, artist)
      .replace(/\{title\}/g, title)
      .replace(/\{id\}/g, id)
      .replace(/\{page\}/g, page);

    // Sanitize any path separators or illegal chars introduced by template
    name = name.replace(/[\\/:*?"<>|]/g, '_');
    return `${name}${page && !name.includes('_p') ? page : ''}${ext}`;
  }

  window.PixivPlusAPI = { getWorkInfo, generateFilename };
})();
