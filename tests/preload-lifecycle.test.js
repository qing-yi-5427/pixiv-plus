const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../content/workbench.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(count = 5) {
  const images = [], timers = new Map(), requests = [], states = [], notices = [];
  let now = 1000000, timerId = 0;
  const records = Array.from({ length: count }, (_, i) => ({ id: String(i + 1) }));
  const store = {
    size: count, all: () => records, indexOf: id => records.findIndex(item => item.id === id),
    update: (id, fields) => Object.assign(records.find(item => item.id === id), fields)
  };
  const context = {
    document: { readyState: 'loading', hidden: false, addEventListener() {} },
    location: { pathname: '/bookmark_new_illust.php' },
    chrome: { i18n: { getMessage: () => '' } },
    window: {
      PixivPlusWorkbenchModel: { createStore: () => store },
      PixivPlusAPI: {
        pruneCaches() {},
        async getWorkInfo(id, { signal }) {
          requests.push({ id, signal });
          return { title: id, artist: 'Artist', urls: {}, pageUrls: [{ original: `https://i.pximg.net/${id}.jpg` }] };
        }
      },
      PixivPlusDownloadPanel: { setWorkbenchActive() {} }
    },
    Date: { now: () => now },
    DOMException, AbortController, console,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    Image: class {
      constructor() { images.push(this); }
      removeAttribute(key) { if (key === 'src') this.src = ''; }
    },
    states, notices
  };
  // Exercise the real controller/functions without rendering the workbench UI.
  const hooks = `
    workspaceVisible = true;
    updateThumbnail = () => {};
    updatePreloadButton = (done, total, state) => states.push(state);
    showToast = message => notices.push(message);
    window.test = {
      image: preloadOriginalImage, run: preloadCurrentPageOriginals,
      visibility: onVisibilityChange, leave: deactivate, canLoad: canLoadInBackground,
      resume() { workspaceVisible = true; },
      stop: stopBackgroundLoading,
      prefetch: prefetchNext,
      setCurrent(id) { currentWorkId = id; },
      disable() { preloadOriginalsByDefault = false; manualPreloadRequested = false; stopBackgroundLoading(); },
      state() { return { completed: [...preloadedOriginalWorkIds], failed: [...failedOriginalWorkIds], running: !!preloadRun }; }
    };
  `;
  vm.runInNewContext(source.replace('  window.PixivPlusWorkbench = {', hooks + '\n  window.PixivPlusWorkbench = {'), context);
  return {
    ...context.window.test, images, timers, requests, states, notices, context,
    advance(ms) { now += ms; },
    fire(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms) { timers.delete(id); timer.fn(); }
      }
    }
  };
}

test('offscreen images release src, handlers and timers on success, error, timeout and abort', async () => {
  for (const outcome of ['success', 'error', 'timeout', 'abort']) {
    const h = harness();
    const controller = new AbortController();
    const pending = h.image('https://i.pximg.net/1.jpg', controller.signal);
    const checked = outcome === 'success' ? pending : assert.rejects(pending);
    const image = h.images[0];
    if (outcome === 'success') image.onload();
    if (outcome === 'error') image.onerror();
    if (outcome === 'timeout') h.fire(45000);
    if (outcome === 'abort') controller.abort();
    await checked;
    assert.equal(image.src, '');
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
    assert.equal(h.timers.size, 0);
  }
});

test('leaving aborts active images; resuming skips completed works and keeps concurrency at three', async () => {
  const h = harness();
  const first = h.run(true);
  await flush();
  assert.equal(h.images.filter(image => image.src).length, 3);
  h.images[0].onload();
  await flush();
  assert.equal(h.images.filter(image => image.src).length, 3);
  h.context.location.pathname = '/artworks/1';
  h.leave();
  await first;
  assert.equal(h.images.filter(image => image.src).length, 0);
  assert.equal(h.state().completed.join(), '1');
  assert.equal(h.state().failed.length, 0);
  assert.equal(h.states.at(-1), 'paused');
  assert.equal(h.notices.length, 0);
  h.context.location.pathname = '/bookmark_new_illust.php';
  h.resume();
  const second = h.run(false);
  await flush();
  while (h.state().running) {
    const active = h.images.filter(image => image.src);
    assert.ok(active.length > 0 && active.length <= 3);
    active.forEach(image => image.onload());
    await flush();
  }
  await second;
  assert.equal(h.state().completed.length, 5);
  assert.equal(h.requests.filter(request => request.id === '1').length, 1);
  const total = h.images.length;
  h.context.window.PixivPlusAPI.pruneCaches();
  await h.run(false);
  assert.equal(h.images.length, total, 'cleanup must not replay completed preloads');
});

test('ten minutes hidden cancels metadata loading without marking a failure; returning resumes', async () => {
  const h = harness(1);
  const normalRequest = h.context.window.PixivPlusAPI.getWorkInfo;
  h.context.window.PixivPlusAPI.getWorkInfo = (_id, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const pending = h.run(true);
  h.context.document.hidden = true;
  h.visibility();
  h.advance(599999);
  assert.equal(h.canLoad(), true);
  h.advance(1);
  assert.equal(h.canLoad(), false);
  h.fire(600000);
  await pending;
  assert.equal(h.state().failed.length, 0);
  assert.equal(h.state().completed.length, 0);
  assert.equal(h.images.length, 0);
  h.context.window.PixivPlusAPI.getWorkInfo = normalRequest;
  h.context.document.hidden = false;
  h.visibility();
  assert.equal(h.canLoad(), true);
  h.fire(500);
  await flush();
  assert.equal(h.images.length, 1);
  h.images[0].onload();
  await flush();
  assert.equal(h.state().completed.join(), '1');
});

test('disabling automatic loading does not allow the cancelled run to restart', async () => {
  const h = harness(1);
  const pending = h.run(true);
  await flush();
  h.disable();
  await pending;
  h.context.document.hidden = false;
  h.visibility();
  h.fire(500);
  await h.run(false);
  assert.equal(h.images.length, 1);
  assert.equal(h.state().failed.length, 0);
});

test('leaving cancels a scheduled adjacent-artwork prefetch before it makes requests', () => {
  const h = harness();
  h.setCurrent('1');
  h.prefetch();
  assert.equal(h.timers.size, 1);
  h.leave();
  h.fire(700);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});
