const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'pixiv-api.js'),
  'utf8'
);

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

function loadApi(fetchImpl, settings = {}, csrfToken = '', overrides = {}) {
  const storage = {
    filenameTemplate: '{artist}-{title}-{id}',
    ...settings
  };
  const context = {
    window: {},
    document: {
      querySelector: selector => selector.includes('#meta-global-data') && csrfToken
        ? { getAttribute: () => JSON.stringify({ token: csrfToken }) }
        : null,
      querySelectorAll: () => [],
      cookie: ''
    },
    chrome: {
      storage: {
        local: { get: (_defaults, callback) => callback(storage) },
        onChanged: { addListener: () => {} }
      }
    },
    fetch: fetchImpl,
    console,
    DOMException,
    clearTimeout,
    setInterval: () => 0,
    setTimeout: callback => {
      callback();
      return 0;
    },
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(apiSource, context);
  return context.window.PixivPlusAPI;
}

function workBody(overrides = {}) {
  return {
    id: '42',
    title: 'Work',
    userName: 'Artist',
    userId: '7',
    pageCount: 1,
    illustType: 0,
    tags: { tags: [] },
    urls: {
      original: 'https://i.pximg.net/42_p0.jpg',
      regular: 'https://i.pximg.net/42_p0_master1200.jpg',
      small: 'https://i.pximg.net/42_p0_square1200.jpg'
    },
    metaSinglePage: { originalImageUrl: 'https://i.pximg.net/42_p0.jpg' },
    ...overrides
  };
}

test('a failed work request does not poison the serialized request queue', async () => {
  const api = loadApi(async url => {
    if (url.endsWith('/bad')) return response({ error: true, body: [] }, 404);
    return response({ error: false, body: workBody() });
  });

  await assert.rejects(api.getWorkInfo('bad'), /NOT_FOUND/);
  const result = await api.getWorkInfo('42');
  assert.equal(result.id, '42');
  assert.equal(result.pageUrls[0].original, 'https://i.pximg.net/42_p0.jpg');
});

test('multi-page works use the authoritative pages endpoint', async () => {
  const calls = [];
  const api = loadApi(async url => {
    calls.push(url);
    if (url.endsWith('/pages')) {
      return response({
        error: false,
        body: [
          { urls: { original: 'https://i.pximg.net/42_p0.png', regular: 'https://i.pximg.net/42_p0_master1200.jpg' } },
          { urls: { original: 'https://i.pximg.net/42_p1.jpg', regular: 'https://i.pximg.net/42_p1_master1200.jpg' } }
        ]
      });
    }
    return response({
      error: false,
      body: workBody({
        pageCount: 2,
        urls: { original: null, regular: null, small: null },
        metaSinglePage: {}
      })
    });
  });

  const result = await api.getWorkInfo('42');
  assert.deepEqual(calls, ['/ajax/illust/42', '/ajax/illust/42/pages']);
  assert.equal(result.pageUrls.length, 2);
  assert.equal(result.pageUrls[1].original, 'https://i.pximg.net/42_p1.jpg');
  assert.equal(result.pageUrls[1].regular, 'https://i.pximg.net/42_p1_master1200.jpg');
});

test('page suffix is not suppressed by _p text in the title', () => {
  const api = loadApi(async () => response({ error: false, body: workBody() }));
  const filename = api.generateFilename({
    id: '42',
    artist: 'Artist',
    title: 'contains_p text',
    pageCount: 2,
    pageUrls: [{ original: 'https://i.pximg.net/42_p0.png' }]
  }, 0);

  assert.equal(filename, 'Artist-contains_p text-42_p0.png');
});

test('filenames are bounded and avoid reserved Windows device names', () => {
  const api = loadApi(async () => response({ error: false, body: workBody() }), {
    filenameTemplate: '{title}'
  });
  const reserved = api.generateFilename({
    id: '42', artist: 'Artist', title: 'CON', pageCount: 1,
    pageUrls: [{ original: 'https://i.pximg.net/42_p0.jpg' }]
  }, 0);
  const long = api.generateFilename({
    id: '42', artist: 'Artist', title: 'x'.repeat(500), pageCount: 1,
    pageUrls: [{ original: 'https://i.pximg.net/42_p0.jpg' }]
  }, 0);

  assert.equal(reserved, '_CON.jpg');
  assert.ok(long.length <= 204);
  assert.ok(long.endsWith('.jpg'));
});

test('settings preview uses the download filename rules without changing the active template', () => {
  const api = loadApi(async () => response({}), { filenameTemplate: '{artist}-{id}' });
  const work = { id: '42', artist: 'Artist', title: 'CON', pageCount: 2, pageUrls: [{ original: 'https://i.pximg.net/42.jpg' }] };
  assert.equal(api.generateFilename(work, 0, '{title}'), '_CON_p0.jpg');
  assert.equal(api.generateFilename(work, 0, '{id}{page}'), '42_p0.jpg');
  assert.equal(api.generateFilename(work, 0), 'Artist-42_p0.jpg');
});

test('ugoira metadata exposes the source ZIP and frame timing', async () => {
  const api = loadApi(async url => {
    assert.equal(url, '/ajax/illust/42/ugoira_meta');
    return response({
      error: false,
      body: {
        originalSrc: 'https://i.pximg.net/ugoira/42.zip',
        mime_type: 'application/zip',
        frames: [{ file: '000000.jpg', delay: 60 }]
      }
    });
  });

  const result = await api.getUgoiraMeta('42');
  assert.equal(result.zipUrl, 'https://i.pximg.net/ugoira/42.zip');
  assert.deepEqual(JSON.parse(JSON.stringify(result.frames)), [{ file: '000000.jpg', delay: 60 }]);
});

test('bookmark actions use Pixiv AJAX endpoints without opening another page', async () => {
  const calls = [];
  const api = loadApi(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/add')) return response({ error: false, body: { last_bookmark_id: '99' } });
    return response({ error: false, body: {} });
  }, {}, 'csrf-token');

  const added = await api.bookmarkWork('42');
  await api.unbookmarkWork('42', added.bookmarkId);

  assert.equal(added.bookmarkId, '99');
  assert.equal(calls[0].url, '/ajax/illusts/bookmarks/add');
  assert.equal(calls[0].options.headers['x-csrf-token'], 'csrf-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    illust_id: '42', restrict: 0, comment: '', tags: []
  });
  assert.equal(calls[1].url, '/ajax/illusts/bookmarks/delete');
  assert.deepEqual(JSON.parse(calls[1].options.body), { bookmark_id: '99' });
});

test('metadata cache expires after five minutes without mutating visible artwork', async () => {
  let now = 1000000;
  let calls = 0;
  let sweep;
  const api = loadApi(async () => {
    calls++;
    return response({ body: workBody({ title: `Version ${calls}` }) });
  }, {}, '', {
    Date: { now: () => now },
    setInterval: (fn, ms) => { assert.equal(ms, 60000); sweep = fn; }
  });
  const visible = await api.getWorkInfo('42');
  now += 299999;
  assert.equal(await api.getWorkInfo(42), visible);
  now++;
  sweep();
  assert.notEqual(await api.getWorkInfo('42'), visible);
  assert.equal(calls, 2);
  assert.equal(visible.title, 'Version 1');
});

test('artwork cache uses least-recently-used eviction at 200 entries', async () => {
  let calls = 0;
  const api = loadApi(async () => { calls++; return response({ body: workBody() }); });
  for (let id = 1; id <= 200; id++) await api.getWorkInfo(id);
  await api.getWorkInfo(1); // Protect the most recently accessed entry.
  await api.getWorkInfo(201);
  await api.getWorkInfo(1);
  assert.equal(calls, 201);
  await api.getWorkInfo(2);
  assert.equal(calls, 202);
});

test('user metadata is bounded to 100 entries', async () => {
  let calls = 0;
  const api = loadApi(async () => { calls++; return response({ body: { name: 'Artist' } }); });
  for (let id = 1; id <= 101; id++) await api.getUserInfo(id);
  await api.getUserInfo(101);
  assert.equal(calls, 101);
  await api.getUserInfo(1);
  assert.equal(calls, 102);
});

test('aborted queued preload never starts a request or poisons the queue', async () => {
  let release;
  const calls = [];
  const api = loadApi(async url => {
    calls.push(url);
    if (url.endsWith('/1')) await new Promise(resolve => { release = resolve; });
    return response({ body: workBody() });
  });
  const first = api.getWorkInfo('1');
  await new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController();
  const cancelled = api.getWorkInfo('2', { signal: controller.signal });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort();
  release();
  await first;
  await rejected;
  await api.getWorkInfo('3');
  assert.deepEqual(calls, ['/ajax/illust/1', '/ajax/illust/3']);
});

test('aborting a rate-limit wait cancels its timer and allows foreground requests', async () => {
  const waits = new Map();
  let token = 0;
  let calls = 0;
  const api = loadApi(async () => {
    calls++;
    return calls === 1 ? response({}, 429) : response({ body: workBody() });
  }, {}, '', {
    Date: { now: () => 1000000 },
    setTimeout: (fn, ms) => { const id = ++token; waits.set(id, { fn, ms }); return id; },
    clearTimeout: id => waits.delete(id)
  });
  const controller = new AbortController();
  const pending = api.getWorkInfo('1', { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...waits.values()][0].ms, 60000);
  controller.abort();
  await rejected;
  assert.equal(waits.size, 0);
  const foreground = api.getWorkInfo('2');
  await new Promise(resolve => setImmediate(resolve));
  for (const [id, timer] of waits) { waits.delete(id); timer.fn(); }
  await foreground;
  assert.equal(calls, 2);
});

test('cancelling an in-flight metadata request propagates the signal to fetch', async () => {
  let receivedSignal;
  const api = loadApi(async (url, { signal }) => {
    if (url.endsWith('/1')) {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    return response({ body: workBody() });
  });
  const controller = new AbortController();
  const pending = api.getWorkInfo('1', { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(receivedSignal, controller.signal);
  controller.abort();
  await rejected;
  assert.equal((await api.getWorkInfo('2')).id, '42');
});
