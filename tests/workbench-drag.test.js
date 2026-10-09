const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const timers = new Map(), objects = new Map(), revoked = [], files = [];
  let nextId = 0, cached = null;
  const image = { hidden: false, alt: 'Artwork <unsafe "bad"> & "title"',
    src: 'blob:preview', currentSrc: 'blob:preview', dataset: { originalUrl: 'https://i.pximg.net/work_p0.jpg' },
    closest: () => null, style: {} };
  const captured = new Set();
  const stage = { dataset: {}, closest: () => null, setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
  class TestURL extends URL {
    static createObjectURL(blob) { const url = 'blob:export-' + (++nextId); objects.set(url, blob); return url; }
    static revokeObjectURL(url) { revoked.push(url); objects.delete(url); }
  }
  const context = { URL: TestURL, Blob, File, window: {
    PixivPlusWorkbenchModel: { createStore: () => ({}) },
    PixivPlusOriginalCache: { peek: () => cached, get() { throw new Error('Drag must not start a transfer'); } },
    PixivPlusAPI: { generateFilename: (info, page) => `${info.id}_p${page}.jpg` },
    PixivPlusDownload: { downloadFile() { throw new Error('Drag must not enqueue a download'); } }
  }, chrome: { i18n: { getMessage: () => '' } },
  document: { hidden: false, readyState: 'loading', addEventListener() {} },
  location: { href: 'https://www.pixiv.net/bookmark_new_illust.php' },
  setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
  clearTimeout: id => timers.delete(id), requestAnimationFrame() {} };
  const hooks = `
    previewImage = testImage;
    currentInfo = { id: '1', pageUrls: [{ original: 'https://i.pximg.net/work_p0.jpg' },
      { original: 'https://i.pximg.net/work_p1.jpg' }], urls: {} };
    window.dragTest = {
      start: onImageDragStart, end: onImageDragEnd, release: releaseDragExport,
      down: onPointerDown, move: onPointerMove, up: onPointerUp, zoom: setZoom,
      usePreview(blob) { previewBlob = blob; },
      page(index) { currentPage = index; }, info(value) { currentInfo = value; },
      state() { return { active: imageDragActive, panX, panY, zoom, pointer: !!pointerStart }; }
    };
  `;
  context.testImage = image;
  vm.runInNewContext(fs.readFileSync(require.resolve('../content/workbench.js'), 'utf8')
    .replace('  window.PixivPlusWorkbench = {', hooks + '\n  window.PixivPlusWorkbench = {'), context);
  function drag(options = {}) {
    const data = new Map();
    const event = { prevented: false, shiftKey: false,
      preventDefault() { this.prevented = true; },
      dataTransfer: { setData: (type, value) => data.set(type, value), items: { add: file => files.push(file) } },
      ...options };
    context.window.dragTest.start(event);
    return { event, data };
  }
  function pointer(target = image, options = {}) {
    return { target, currentTarget: stage, pointerId: 7, pointerType: 'mouse', button: 0,
      clientX: 100, clientY: 120, shiftKey: false, prevented: false,
      preventDefault() { this.prevented = true; }, ...options };
  }
  return { ...context.window.dragTest, image, stage, files, timers, objects, revoked, captured, drag, pointer,
    cache(blob) { cached = blob; }, expire() { for (const { fn } of [...timers.values()]) fn(); } };
}

test('uncached dragging exports stable original URL/escaped HTML without downloads or fetching', () => {
  const h = harness(), { event, data } = h.drag();
  assert.equal(event.prevented, false);
  assert.equal(event.dataTransfer.effectAllowed, 'copyLink');
  assert.equal(data.get('text/uri-list'), 'https://i.pximg.net/work_p0.jpg');
  assert.equal(data.get('text/plain'), data.get('text/uri-list'));
  assert.equal(data.get('DownloadURL'), 'image/jpeg:1_p0.jpg:https://i.pximg.net/work_p0.jpg');
  assert.match(data.get('text/html'), /src="https:\/\/i\.pximg\.net\/work_p0.jpg"/);
  assert.match(data.get('text/html'), /&lt;unsafe &quot;bad&quot;&gt; &amp; &quot;title&quot;/);
  assert.equal(h.files.length, 0);
  assert.equal(h.objects.size, 0);
});

test('cached dragging supplies exact original bytes and a named File synchronously', async () => {
  const h = harness(), blob = new Blob(['original bytes'], { type: 'image/jpeg' });
  h.cache(blob);
  const { data } = h.drag();
  assert.equal(h.files[0].name, '1_p0.jpg');
  assert.equal(h.files[0].type, 'image/jpeg');
  assert.equal(await h.files[0].text(), 'original bytes');
  assert.equal(h.objects.get(data.get('DownloadURL').split(':').slice(2).join(':')), blob);
  assert.equal(data.get('text/uri-list'), 'https://i.pximg.net/work_p0.jpg');
});

test('visible original remains exportable after byte-cache expiry and drag URL outlives dragend', () => {
  const h = harness(), blob = new Blob(['visible original'], { type: 'image/jpeg' });
  h.usePreview(blob);
  h.drag();
  h.end();
  assert.equal(h.objects.size, 1);
  assert.equal([...h.timers.values()][0].ms, 60000);
  assert.equal(h.state().active, false);
  h.expire();
  assert.equal(h.objects.size, 0);
  assert.equal(h.timers.size, 0);
});

test('only the current multi-page original is exported, never the first-page cached preview', () => {
  const h = harness();
  h.usePreview(new Blob(['first page'], { type: 'image/jpeg' }));
  h.page(1);
  const { data } = h.drag();
  assert.equal(h.files.length, 0);
  assert.equal(data.get('DownloadURL'), 'image/jpeg:1_p1.jpg:https://i.pximg.net/work_p1.jpg');
});

test('repeated exports retain at most one independent URL and release on lifecycle cleanup', () => {
  const h = harness(); h.cache(new Blob(['original'], { type: 'image/jpeg' }));
  h.drag(); h.end(); const first = [...h.objects.keys()][0];
  h.drag();
  assert.equal(h.objects.size, 1);
  assert.deepEqual(h.revoked, [first]);
  assert.equal(h.timers.size, 0);
  h.release();
  assert.equal(h.objects.size, 0);
  assert.equal(h.state().active, false);
});

test('missing File-item support keeps native image, stable URL and downloadable cached bytes', () => {
  const h = harness(); h.cache(new Blob(['original'], { type: 'image/jpeg' }));
  const data = new Map();
  const { event } = h.drag({ dataTransfer: { setData: (type, value) => data.set(type, value),
    items: { add() { throw new Error('Unsupported file items'); } } } });
  assert.equal(event.prevented, false);
  assert.match(data.get('DownloadURL'), /^image\/jpeg:1_p0.jpg:blob:export-/);
});

test('plain image drag never captures the mouse, even when zoomed in', () => {
  for (const zoom of [1, 2, 8]) {
    const h = harness(); h.zoom(zoom); const event = h.pointer(); h.down(event);
    assert.equal(event.prevented, false);
    assert.equal(h.captured.size, 0);
    assert.equal(h.drag().event.prevented, false);
  }
});

test('Shift, middle-button, touch, and background drags pan while controls never pan', () => {
  for (const mode of ['shift', 'middle', 'touch', 'background']) {
    const h = harness(); h.zoom(2);
    const event = h.pointer(mode === 'background' ? h.stage : h.image,
      { shiftKey: mode === 'shift', button: mode === 'middle' ? 1 : 0, pointerType: mode === 'touch' ? 'touch' : 'mouse' });
    h.down(event); assert.equal(h.captured.size, 1); assert.equal(event.prevented, true);
    assert.equal(h.drag().event.prevented, true);
    h.move({ ...event, clientX: 130, clientY: 160 });
    assert.equal(h.state().panX, 30); assert.equal(h.state().panY, 40);
    h.up(event); assert.equal(h.captured.size, 0); assert.equal(h.stage.dataset.panning, 'false');
  }
  const h = harness(); h.zoom(2);
  h.down(h.pointer({ closest: () => ({ tagName: 'BUTTON' }) }));
  assert.equal(h.captured.size, 0);
});

test('loading/hidden previews, missing drag data and non-network sources cannot be dragged', () => {
  const h = harness(); h.image.hidden = true; assert.equal(h.drag().event.prevented, true);
  h.image.hidden = false; assert.equal(h.drag({ dataTransfer: null }).event.prevented, true);
  h.info(null); assert.equal(h.drag().event.prevented, true);
  h.info({ pageUrls: [{ original: 'javascript:alert(1)' }], urls: {} });
  assert.equal(h.drag().event.prevented, true);
  h.info({ pageUrls: [{ original: 'https://[' }], urls: {} });
  assert.equal(h.drag().event.prevented, true);
});

test('a generic cached MIME type falls back to the original image extension', () => {
  const h = harness(); h.cache(new Blob(['original'], { type: 'application/octet-stream' }));
  h.drag();
  assert.equal(h.files[0].type, 'image/jpeg');
});

test('production image enables native dragging and installs both lifecycle handlers', () => {
  const source = fs.readFileSync(require.resolve('../content/workbench.js'), 'utf8');
  assert.match(source, /id="ppw-image" alt="" draggable="true"/);
  assert.match(source, /-webkit-user-drag:element/);
  assert.match(source, /previewImage.addEventListener\('dragstart', onImageDragStart\)/);
  assert.match(source, /previewImage.addEventListener\('dragend', onImageDragEnd\)/);
});
