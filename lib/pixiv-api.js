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

  function enqueueRequest(task) {
    const result = requestQueue.catch(() => {}).then(task);
    // Keep the shared tail fulfilled so one inaccessible work cannot poison
    // every later preview/download request on the page.
    requestQueue = result.catch(() => {});
    return result;
  }

  function sanitizeFilename(name) {
    return String(name || '')
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
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
    return enqueueRequest(async () => {
      // Double-check cache after queue wait
      const cached2 = cache.get(workId);
      if (cached2 && Date.now() - cached2.timestamp < CACHE_TTL) {
        return cached2.data;
      }

      const resp = await fetchWithRateLimit(`/ajax/illust/${workId}`);
      const json = await resp.json();

      if (json.error || !json.body || Array.isArray(json.body)) throw new Error('INVALID_RESPONSE');

      const body = json.body;
      const data = {
        id: body.id,
        title: body.title || 'Untitled',
        artist: body.userName || 'Unknown',
        userId: body.userId || '',
        pageCount: body.pageCount || 1,
        isUgoira: body.illustType === 2,
        isBookmarked: Boolean(body.bookmarkData),
        tags: (body.tags?.tags || []).map(t => t.tag).filter(Boolean),
        urls: {
          original: body.urls?.original || '',
          regular: body.urls?.regular || '',
          small: body.urls?.small || ''
        },
        originalImageUrl: body.metaSinglePage?.originalImageUrl || ''
      };

      // Pixiv does not consistently expose original URLs on the illust detail
      // response. The pages endpoint is authoritative for multi-page works and
      // also preserves per-page file extensions.
      if (data.pageCount > 1 || !(data.originalImageUrl || data.urls.original)) {
        const pagesResp = await fetchWithRateLimit(`/ajax/illust/${workId}/pages`);
        const pagesJson = await pagesResp.json();
        if (pagesJson.error || !Array.isArray(pagesJson.body)) throw new Error('INVALID_RESPONSE');
        data.pageUrls = pagesJson.body.map(page => ({
          original: page.urls?.original || '',
          regular: page.urls?.regular || ''
        })).filter(page => page.original || page.regular);
      } else {
        data.pageUrls = buildPageUrls(data);
      }

      if (data.pageUrls.length === 0) throw new Error('NO_IMAGE_URL');

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

    for (let i = 0; i < workInfo.pageCount; i++) {
      const origUrl = template.replace(/_p0(?=\.[^.]+$)/, `_p${i}`);
      const regUrl = regTemplate ? regTemplate.replace(/_p0(?=(?:_[^./]+)?\.[^.]+$)/, `_p${i}`) : '';
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

    const templateHasPage = filenameTemplate.includes('{page}');
    let name = filenameTemplate
      .replace(/\{artist\}/g, artist)
      .replace(/\{title\}/g, title)
      .replace(/\{id\}/g, id)
      .replace(/\{page\}/g, page);

    // Sanitize any path separators or illegal chars introduced by template,
    // then leave enough room for the extension on common file systems.
    name = sanitizeFilename(name);
    if (!name) name = id || 'pixiv-image';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const suffix = page && !templateHasPage ? page : '';
    const maxStemLength = 200 - suffix.length;
    name = truncateName(name, Math.max(1, maxStemLength));
    return `${name}${suffix}${ext}`;
  }

  // --- User info & follow API ---

  const userCache = new Map();

  async function getUserInfo(userId) {
    const cached = userCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const resp = await fetchWithRateLimit(`/ajax/user/${userId}`);
    const json = await resp.json();
    if (!json.body) throw new Error('INVALID_RESPONSE');

    const body = json.body;
    const data = {
      userId: body.userId || userId,
      name: body.name || '',
      avatar: body.imageBig || body.image || '',
      isFollowed: !!body.isFollowed
    };

    userCache.set(userId, { data, timestamp: Date.now() });
    return data;
  }

  async function getUgoiraMeta(workId) {
    return enqueueRequest(async () => {
      const resp = await fetchWithRateLimit(`/ajax/illust/${workId}/ugoira_meta`);
      const json = await resp.json();
      if (json.error || !json.body) throw new Error('UGOIRA_META_UNAVAILABLE');
      return {
        zipUrl: json.body.originalSrc || json.body.src || '',
        mimeType: json.body.mime_type || 'application/zip',
        frames: Array.isArray(json.body.frames) ? json.body.frames : []
      };
    });
  }

  function getCsrfToken() {
    const meta = document.querySelector('#meta-global-data');
    if (meta) {
      try {
        const data = JSON.parse(meta.getAttribute('content'));
        if (data.token) return data.token;
      } catch {}
    }
    const match = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function followUser(userId) {
    const resp = await fetch(`/ajax/user/${userId}/follow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken()
      },
      body: JSON.stringify({ user_id: String(userId), restrict: 'public' }),
      credentials: 'include'
    });
    if (!resp.ok) throw new Error('FOLLOW_FAILED');
    const cached = userCache.get(String(userId));
    if (cached) cached.data.isFollowed = true;
  }

  async function unfollowUser(userId) {
    const resp = await fetch(`/ajax/user/${userId}/follow/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken()
      },
      body: JSON.stringify({ user_id: String(userId) }),
      credentials: 'include'
    });
    if (!resp.ok) throw new Error('UNFOLLOW_FAILED');
    const cached = userCache.get(String(userId));
    if (cached) cached.data.isFollowed = false;
  }

  window.PixivPlusAPI = { getWorkInfo, getUgoiraMeta, generateFilename, getUserInfo, followUser, unfollowUser };
})();
