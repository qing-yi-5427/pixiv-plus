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

function loadApi(fetchImpl, settings = {}) {
  const storage = {
    filenameTemplate: '{artist}-{title}-{id}',
    ...settings
  };
  const context = {
    window: {},
    document: { querySelector: () => null, cookie: '' },
    chrome: {
      storage: {
        local: { get: (_defaults, callback) => callback(storage) },
        onChanged: { addListener: () => {} }
      }
    },
    fetch: fetchImpl,
    console,
    setTimeout: callback => {
      callback();
      return 0;
    }
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
