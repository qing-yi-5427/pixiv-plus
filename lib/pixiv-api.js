// PixivPlus - Pixiv API Wrapper
// Fetches work info via /ajax/illust/{id}, handles caching and rate limiting

(() => {
  'use strict';

  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const WORK_CACHE_LIMIT = 200;
  const USER_CACHE_LIMIT = 100;
  const MIN_REQUEST_INTERVAL = 500; // 500ms between API calls
  const RETRY_DELAY = 60 * 1000; // 60s on 429

  const cache = new Map();
  const userCache = new Map();
  let lastRequestTime = 0;
  const requestQueue = [];
  let requestRunning = false;

  function pruneCache(entries, limit) {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.timestamp >= CACHE_TTL) entries.delete(key);
    }
    while (entries.size > limit) entries.delete(entries.keys().next().value);
  }

  function readCache(entries, key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp >= CACHE_TTL) {
      entries.delete(key);
      return null;
    }
    // Map order tracks recency; reads do not extend metadata freshness.
    entries.delete(key);
    entries.set(key, entry);
    return entry.data;
  }

  function writeCache(entries, key, data, limit) {
    entries.delete(key);
    entries.set(key, { data, timestamp: Date.now() });
    pruneCache(entries, limit);
  }

  function pruneCaches() {
    pruneCache(cache, WORK_CACHE_LIMIT);
    pruneCache(userCache, USER_CACHE_LIMIT);
  }

  // Also reclaim stale entries on idle, long-lived tabs, not just on cache reads.
  setInterval(pruneCaches, 60 * 1000);

  function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
  }

  function waitForRequest(ms, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  function enqueueRequest(task, { signal, priority } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const entry = { task, resolve, reject, signal, priority, abort: null };
      entry.abort = () => {
        const index = requestQueue.indexOf(entry);
        if (index >= 0) { requestQueue.splice(index, 1); reject(signal.reason); }
        signal.removeEventListener('abort', entry.abort);
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      if (priority === 'foreground') {
        const firstBackground = requestQueue.findIndex(item => item.priority !== 'foreground');
        requestQueue.splice(firstBackground < 0 ? requestQueue.length : firstBackground, 0, entry);
      } else requestQueue.push(entry);
      Promise.resolve().then(pumpRequests);
    });
  }

  async function pumpRequests() {
    if (requestRunning) return;
    requestRunning = true;
    while (requestQueue.length) {
      const entry = requestQueue.shift();
      entry.signal?.removeEventListener('abort', entry.abort);
      try { checkAbort(entry.signal); entry.resolve(await entry.task()); }
      catch (error) { entry.reject(error); }
    }
    requestRunning = false;
  }

  function sanitizeFilename(name) {
    return String(name || '')
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
  }

  function truncateName(name, maxLen) {
    const characters = Array.from(name);
    if (characters.length <= maxLen) return name;
    return characters.slice(0, maxLen - 3).join('') + '...';
  }

  function truncateUtf8(name, maxBytes) {
    const encoder = new TextEncoder();
    if (encoder.encode(name).length <= maxBytes) return name;
    let result = '', size = 0;
    for (const character of name) {
      const bytes = encoder.encode(character).length;
      if (size + bytes > maxBytes - 3) break;
      result += character; size += bytes;
    }
    return result + '...';
  }

  async function timedFetch(url, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    checkAbort(options.signal);
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), 30000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Read the body while the timeout/cancellation signal is still active.
      let json;
      try { json = await response.json(); }
      catch (error) { checkAbort(controller.signal); if (response.ok) throw error; json = {}; }
      checkAbort(controller.signal);
      return { status: response.status, ok: response.ok, json: async () => json };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async function fetchWithRateLimit(url, signal) {
    checkAbort(signal);
    const now = Date.now();
    const wait = Math.max(0, MIN_REQUEST_INTERVAL - (now - lastRequestTime));
    if (wait > 0) {
      await waitForRequest(wait, signal);
    }
    checkAbort(signal);
    lastRequestTime = Date.now();

    const resp = await timedFetch(url, { credentials: 'include', signal });

    if (resp.status === 429) {
      console.warn('[PixivPlus] Rate limited, retrying in 60s');
      await waitForRequest(RETRY_DELAY, signal);
      checkAbort(signal);
      lastRequestTime = Date.now();
      const retry = await timedFetch(url, { credentials: 'include', signal });
      if (retry.status === 429) throw new Error('RATE_LIMITED');
      if (!retry.ok) throw new Error(`HTTP_${retry.status}`);
      return retry;
    }

    if (resp.status === 404) throw new Error('NOT_FOUND');
    if (resp.status === 403) throw new Error('FORBIDDEN');
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
    return resp;
  }

  async function getWorkInfo(workId, { signal, priority, fresh = false } = {}) {
    workId = String(workId);
    checkAbort(signal);
    // Check cache
    if (fresh) cache.delete(workId);
    const cached = fresh ? null : readCache(cache, workId);
    if (cached) return cached;

    // Serialize requests
    return enqueueRequest(async () => {
      checkAbort(signal);
      // Double-check cache after queue wait
      const cached2 = fresh ? null : readCache(cache, workId);
      if (cached2) return cached2;

      const resp = await fetchWithRateLimit(`/ajax/illust/${workId}`, signal);
      const json = await resp.json();
      checkAbort(signal);

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
        bookmarkId: body.bookmarkData?.id ? String(body.bookmarkData.id) : '',
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
        const pagesResp = await fetchWithRateLimit(`/ajax/illust/${workId}/pages`, signal);
        const pagesJson = await pagesResp.json();
        checkAbort(signal);
        if (pagesJson.error || !Array.isArray(pagesJson.body)) throw new Error('INVALID_RESPONSE');
        data.pageUrls = pagesJson.body.map(page => ({
          original: page.urls?.original || '',
          regular: page.urls?.regular || ''
        })).filter(page => page.original || page.regular);
      } else {
        data.pageUrls = buildPageUrls(data);
      }

      if (data.pageUrls.length === 0) throw new Error('NO_IMAGE_URL');

      writeCache(cache, workId, data, WORK_CACHE_LIMIT);
      return data;
    }, { signal, priority });
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

  function generateFilename(workInfo, pageIndex, template = filenameTemplate) {
    const artist = truncateName(sanitizeFilename(workInfo.artist), 50);
    const title = truncateName(sanitizeFilename(workInfo.title), 80);
    const id = workInfo.id;
    const page = workInfo.pageCount > 1 ? `_p${pageIndex}` : '';
    const url = workInfo.pageUrls[pageIndex]?.original || '';
    const ext = url.match(/\.(png|jpg|jpeg|gif|webp)$/)?.[0] || '.png';

    const templateHasPage = template.includes('{page}');
    let name = template
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
    // Leave room for rename suffixes and Ugoira .frames.json companions.
    return `${truncateUtf8(name, 220 - new TextEncoder().encode(suffix + ext).length)}${suffix}${ext}`;
  }

  // --- User info & follow API ---

  async function getUserInfo(userId) {
    userId = String(userId);
    const cached = readCache(userCache, userId);
    if (cached) return cached;

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

    writeCache(userCache, userId, data, USER_CACHE_LIMIT);
    return data;
  }

  async function getUgoiraMeta(workId, { signal } = {}) {
    return enqueueRequest(async () => {
      const resp = await fetchWithRateLimit(`/ajax/illust/${workId}/ugoira_meta`, signal);
      const json = await resp.json();
      if (json.error || !json.body) throw new Error('UGOIRA_META_UNAVAILABLE');
      return {
        zipUrl: json.body.originalSrc || json.body.src || '',
        mimeType: json.body.mime_type || 'application/zip',
        frames: Array.isArray(json.body.frames) ? json.body.frames : []
      };
    }, { signal });
  }

  function tokenFromJson(raw) {
    if (!raw) return '';
    try {
      const data = JSON.parse(raw);
      const queue = [data];
      for (let index = 0; index < queue.length && index < 1000; index++) {
        const value = queue[index];
        if (!value || typeof value !== 'object') continue;
        if (typeof value.token === 'string' && value.token.length > 8) return value.token;
        for (const child of Object.values(value)) {
          if (child && typeof child === 'object') queue.push(child);
        }
      }
    } catch {}
    return '';
  }

  function getCsrfToken() {
    const globalData = document.querySelector('#meta-global-data, meta[name="global-data"]');
    const globalToken = tokenFromJson(globalData?.getAttribute('content'));
    if (globalToken) return globalToken;

    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (csrfMeta?.content) return csrfMeta.content;

    for (const script of document.querySelectorAll(
      '#__NEXT_DATA__, #meta-preload-data, script[type="application/json"]'
    )) {
      const token = tokenFromJson(script.textContent);
      if (token) return token;
    }

    const match = document.cookie.match(/(?:^|;\s*)token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function postPixivMutation(url, payload, errorCode) {
    const token = getCsrfToken();
    if (!token) throw new Error('CSRF_TOKEN_MISSING');
    const resp = await timedFetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'x-csrf-token': token,
        'x-requested-with': 'XMLHttpRequest'
      },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`${errorCode}_HTTP_${resp.status}`);
    if (json.error) throw new Error(`${errorCode}_${json.message || 'REJECTED'}`);
    return json;
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

  async function bookmarkWork(workId) {
    const json = await postPixivMutation('/ajax/illusts/bookmarks/add', {
      illust_id: String(workId),
      restrict: 0,
      comment: '',
      tags: []
    }, 'BOOKMARK_FAILED');
    const bookmarkId = json.body?.last_bookmark_id || json.body?.bookmark_id || '';
    const cached = cache.get(String(workId));
    if (cached) {
      cached.data.isBookmarked = true;
      cached.data.bookmarkId = bookmarkId ? String(bookmarkId) : cached.data.bookmarkId;
    }
    return { bookmarkId: bookmarkId ? String(bookmarkId) : '' };
  }

  async function unbookmarkWork(workId, bookmarkId) {
    if (!bookmarkId) throw new Error('BOOKMARK_ID_REQUIRED');
    await postPixivMutation('/ajax/illusts/bookmarks/delete', {
      bookmark_id: String(bookmarkId)
    }, 'UNBOOKMARK_FAILED');
    const cached = cache.get(String(workId));
    if (cached) {
      cached.data.isBookmarked = false;
      cached.data.bookmarkId = '';
    }
  }

  window.PixivPlusAPI = {
    pruneCaches,
    getWorkInfo,
    getUgoiraMeta,
    generateFilename,
    getUserInfo,
    followUser,
    unfollowUser,
    bookmarkWork,
    unbookmarkWork
  };
})();
