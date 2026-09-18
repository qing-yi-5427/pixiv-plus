const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const read = file => fs.readFileSync(require.resolve('../' + file), 'utf8');
const flush = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function directory(initial = {}) {
  const files = new Map(Object.entries(initial));
  const events = [];
  let sequence = 1;
  const handle = {
    name: 'Test folder', files, events,
    isSameEntry: async other => other === handle,
    queryPermission: async () => 'granted',
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, { size: 0, lastModified: sequence++ });
      }
      return {
        getFile: async () => files.get(name),
        async createWritable() {
          let blob;
          return {
            async write(value) { blob = value; events.push('stage:' + name); if (handle.blockWrite) await handle.blockWrite.promise; },
            async close() {
              if (handle.failClose === name) throw new Error('Simulated disk failure');
              events.push('commit:' + name); files.set(name, { size: blob.size, lastModified: sequence++ });
            },
            async abort() { events.push('abort:' + name); }
          };
        }
      };
    },
    async removeEntry(name) { events.push('remove:' + name); files.delete(name); }
  };
  return handle;
}

function downloads({ paused = true, embedWait = null, realFetch = false } = {}) {
  const updates = [], toasts = [], changes = [];
  const ctx = {
    window: { PixivPlusDownloadPanel: { updateDownload: item => updates.push(item), showToast: message => toasts.push(message), setFolderName() {} },
      PixivPlusAPI: { generateFilename: info => info.title + '.jpg', getWorkInfo: async id => ({ id, title: id, tags: [], urls: {}, pageUrls: [{ original: 'https://i.pximg.net/' + id + '.jpg' }] }) } },
    chrome: { storage: { local: {
      get(defaults, callback) { if ('embedTags' in defaults && embedWait) embedWait.promise.then(() => callback({ embedTags: false })); else callback(defaults); },
      set(patch, callback) { for (const listener of changes) listener(Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { newValue: value }]))); callback?.(); }
    }, onChanged: { addListener: listener => changes.push(listener) } }, runtime: { onMessage: { addListener() {} } } },
    indexedDB: { open: () => ({}) }, crypto: { randomUUID },
    Blob, TextEncoder, AbortController, DOMException, console
  };
  const hooks = `
    queuePaused = ${paused};
    ${realFetch ? '' : "fetchImageStream = async () => new Blob(['image']);"}
    window.review = { pendingDownloads, activeDownloads, reservations, producers, runDownload,
      setFetch(fn) { fetchImageStream = fn; },
      setFolder(handle) { dirHandle = handle; dirHandleLoad = Promise.resolve(handle); },
      setLoader(fn) { loadDirHandle = fn; },
      setSaver(fn) { saveDirHandle = fn; },
      setSelector(fn) { showMultiImageSelector = fn; },
      setMulti(value) { multiDownloadDefault = value; }
    };
  `;
  vm.runInNewContext(read('content/bookmark-download.js').replace('  window.PixivPlusDownload = {', hooks + '\n  window.PixivPlusDownload = {'), ctx);
  return { api: ctx.window.PixivPlusDownload, hooks: ctx.window.review, ctx, updates, toasts, changes };
}

test('concurrent rename allocates different files and names Ugoira companions together', async () => {
  const h = downloads(), dir = directory({ 'animation.zip': { size: 5 }, 'animation.frames.json': { size: 8 } });
  const companion = { filename: 'animation.frames.json', text: '{}' };
  const accepted = await Promise.all([1, 2].map(id => h.api.downloadFile('https://i.pximg.net/' + id, 'animation.zip', [], {}, { dirHandle: dir, duplicatePolicy: 'rename', companion })));
  assert.deepEqual(accepted, [true, true]);
  assert.deepEqual(Array.from(h.hooks.pendingDownloads, job => [job.filename, job.companion.filename]), [
    ['animation (2).zip', 'animation (2).frames.json'], ['animation (3).zip', 'animation (3).frames.json']
  ]);
  h.api.toggleQueuePaused(false);
  await flush(); await flush();
  assert.ok(dir.files.has('animation (2).zip'));
  assert.ok(dir.files.has('animation (2).frames.json'));
  assert.equal(h.updates.filter(item => item.state === 'complete').length, 2);
});

test('skip checks the selected directory, not historical filenames', async () => {
  const h = downloads(), empty = directory(), existing = directory({ 'same.jpg': { size: 8 } });
  h.ctx.window.PixivPlusDownloadPanel.isDuplicate = () => true;
  assert.equal(await h.api.downloadFile('url', 'same.jpg', [], {}, { dirHandle: empty }), true);
  assert.equal(await h.api.downloadFile('url', 'same.jpg', [], {}, { dirHandle: existing }), false);
});

test('a preloaded original is saved through the real download path without a second network transfer', async () => {
  const h = downloads({ paused: false, realFetch: true }), dir = directory(); let transfers = 0;
  Object.assign(h.ctx, { atob, setInterval() {}, setTimeout, clearTimeout });
  h.ctx.chrome.runtime.connect = () => {
    let receive;
    return { onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener() {} }, disconnect() {},
      postMessage() { transfers++; queueMicrotask(() => { receive({ type: 'chunk', data: btoa('original') }); receive({ type: 'done', received: 8 }); }); }
    };
  };
  vm.runInNewContext(read('lib/original-cache.js'), h.ctx);
  await h.ctx.window.PixivPlusOriginalCache.get('https://i.pximg.net/original.jpg');
  await h.api.downloadFile('https://i.pximg.net/original.jpg', 'renamed.jpg', [], {}, { dirHandle: dir });
  await flush(); await flush();
  assert.equal(h.updates.at(-1).state, 'complete'); assert.equal(transfers, 1);
  assert.equal(dir.files.get('renamed.jpg').size, 8);
});

test('partial Ugoira failure retries only the missing companion using the original pair name', async () => {
  const h = downloads({ paused: false }), dir = directory();
  dir.failClose = 'animation.frames.json';
  await h.api.downloadFile('url', 'animation.zip', [], {}, {
    dirHandle: dir, duplicatePolicy: 'rename', companion: { filename: 'animation.frames.json', text: '{}' }
  });
  await flush(); await flush();
  const failed = h.updates.at(-1);
  assert.equal(failed.state, 'interrupted');
  assert.match(failed.error, /Partial save: animation.zip/);
  assert.equal(dir.files.has('animation.frames.json'), false);
  dir.failClose = null;
  await h.api.retryDownload(failed.id); await flush(); await flush();
  assert.equal(h.updates.at(-1).state, 'complete');
  assert.equal(dir.events.filter(event => event === 'commit:animation.zip').length, 1);
  assert.ok(dir.files.has('animation.frames.json'));
  assert.equal(dir.files.size, 2);
});

test('partial-download retry refuses to replace a committed file changed by the user', async () => {
  const h = downloads({ paused: false }), dir = directory();
  dir.failClose = 'animation.frames.json';
  await h.api.downloadFile('url', 'animation.zip', [], {}, {
    dirHandle: dir, duplicatePolicy: 'rename', companion: { filename: 'animation.frames.json', text: '{}' }
  });
  await flush(); await flush();
  const failed = h.updates.at(-1);
  const modified = { size: 999, lastModified: 999 };
  dir.files.set('animation.zip', modified); dir.failClose = null;
  await h.api.retryDownload(failed.id); await flush(); await flush();
  assert.equal(h.updates.at(-1).state, 'interrupted');
  assert.match(h.updates.at(-1).error, /Previously saved file changed/);
  assert.equal(dir.files.get('animation.zip'), modified);
  assert.equal(dir.files.has('animation.frames.json'), false);
});

test('cancel after network completion prevents writing or overwriting a file', async () => {
  const wait = deferred(), h = downloads({ paused: false, embedWait: wait });
  const original = { size: 99, lastModified: 1 };
  const dir = directory({ 'same.jpg': original });
  await h.api.downloadFile('url', 'same.jpg', [], {}, { dirHandle: dir, duplicatePolicy: 'overwrite' });
  await flush();
  h.api.cancelAllDownloads(); wait.resolve(); await flush();
  assert.equal(dir.files.get('same.jpg'), original);
  assert.equal(dir.events.length, 0);
  assert.equal(h.updates.at(-1).state, 'cancelled');
});

test('cancel during staging aborts the stream and removes only the new empty placeholder', async () => {
  const h = downloads({ paused: false }), dir = directory();
  dir.blockWrite = deferred();
  await h.api.downloadFile('url', 'new.jpg', [], {}, { dirHandle: dir });
  await flush();
  h.api.cancelAllDownloads(); dir.blockWrite.resolve(); await flush();
  assert.equal(dir.files.has('new.jpg'), false);
  assert.ok(dir.events.includes('abort:new.jpg'));
  assert.ok(!dir.events.includes('commit:new.jpg'));
});

test('cancel all stops batch producers awaiting metadata before any jobs are queued', async () => {
  const h = downloads(), dir = directory(), wait = deferred();
  h.hooks.setFolder(dir);
  h.ctx.window.PixivPlusAPI.getWorkInfo = () => wait.promise;
  const batch = h.api.downloadWorks(['1', '2']);
  await flush(); h.api.cancelAllDownloads();
  wait.resolve({ id: '1', pageUrls: [{}] }); await batch;
  assert.equal(h.hooks.pendingDownloads.length, 0);
  assert.equal(h.hooks.producers.size, 0);
});

test('directory changes reload handles in other existing tabs', async () => {
  const a = downloads(), b = downloads(), old = directory(), next = directory();
  a.hooks.setFolder(old); b.hooks.setFolder(old);
  let saved = old;
  a.ctx.window.showDirectoryPicker = async () => next;
  a.hooks.setSaver(async handle => { saved = handle; });
  a.hooks.setLoader(async () => saved); b.hooks.setLoader(async () => saved);
  a.ctx.chrome.storage.local.set = (patch, callback) => {
    const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { newValue: value }]));
    [...a.changes, ...b.changes].forEach(listener => listener(changes)); callback();
  };
  await a.api.chooseDirectory(); await flush();
  await b.api.downloadFile('url', 'image.jpg', [], {});
  assert.equal(b.hooks.pendingDownloads[0].dirHandle, next);
});

test('artwork-level downloads honor ask/all and folder cancellation starts no jobs', async () => {
  const h = downloads(), dir = directory(); let opened = 0;
  h.hooks.setFolder(dir); h.hooks.setSelector(() => { opened++; });
  h.ctx.window.PixivPlusAPI.getWorkInfo = async () => ({ id: '1', title: 'many', pageCount: 2, tags: [], urls: {}, pageUrls: [{ original: 'one' }, { original: 'two' }] });
  await h.api.downloadWork('1'); assert.equal(opened, 1); assert.equal(h.hooks.pendingDownloads.length, 0);
  h.hooks.setMulti('all'); await h.api.downloadWork('1');
  assert.ok(h.hooks.pendingDownloads.length > 0);
  h.api.cancelAllDownloads(); h.hooks.setFolder(null);
  h.ctx.window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  assert.equal(await h.api.downloadFile('url', 'new.jpg', [], {}), false);
  assert.equal(h.hooks.pendingDownloads.length, 0);
});

function workbench() {
  const actions = [];
  const ctx = {
    window: { PixivPlusWorkbenchModel: { createStore: () => ({ size: 1 }) }, PixivPlusAPI: {} },
    document: { hidden: false, readyState: 'loading', addEventListener() {} },
    chrome: { i18n: { getMessage: () => '' } },
    location: { pathname: '/bookmark_new_illust.php', href: 'https://www.pixiv.net/bookmark_new_illust.php?p=1' },
    actions, URL, AbortController, console, setTimeout: fn => { fn(); return 0; }
  };
  const hooks = `
    workspaceVisible = true;
    bookmarkButton = { disabled: false };
    renderInfo = () => actions.push('render');
    showToast = message => actions.push(message);
    nativeBookmarkButton = () => null;
    openCurrentWork = () => actions.push('open');
    showPage = () => actions.push('page');
    moveWork = () => actions.push('work');
    shell = { classList: { toggle() { actions.push('focus'); } } };
    feedPageInput = { value: '12' }; feedPrevButton = {}; feedNextButton = {};
    shadow = { activeElement: feedPageInput };
    window.review = { bookmark: bookmarkCurrentWork, key: onKeyDown, pagination: syncFeedPagination,
      input: feedPageInput, blur() { shadow.activeElement = null; },
      choose(info) { currentWorkId = info.id; currentInfo = info; bookmarkButton.disabled = false; },
      native(fn) { nativeBookmarkButton = fn; }
    };
  `;
  vm.runInNewContext(read('content/workbench.js').replace('  window.PixivPlusWorkbench = {', hooks + '\n  window.PixivPlusWorkbench = {'), ctx);
  return { ctx, actions, ...ctx.window.review };
}

test('delayed bookmark response updates its own artwork, never the newly selected one', async () => {
  const h = workbench(), wait = deferred();
  const a = { id: '1', isBookmarked: false }, b = { id: '2', isBookmarked: false };
  h.ctx.window.PixivPlusAPI.getWorkInfo = async () => ({ isBookmarked: false });
  h.ctx.window.PixivPlusAPI.bookmarkWork = () => wait.promise;
  h.choose(a); const pending = h.bookmark(); await flush(); h.choose(b);
  wait.resolve({ bookmarkId: 'A-ID' }); await pending;
  assert.equal(a.bookmarkId, 'A-ID'); assert.equal(b.isBookmarked, false); assert.equal(b.bookmarkId, undefined);
  assert.ok(!h.actions.includes('render'));
});

test('native bookmark fallback does not report success without server confirmation', async () => {
  const h = workbench(); let clicks = 0;
  h.choose({ id: '1', isBookmarked: false });
  h.ctx.window.PixivPlusAPI.getWorkInfo = async () => ({ isBookmarked: false });
  h.ctx.window.PixivPlusAPI.bookmarkWork = async () => { throw new Error('CSRF_TOKEN_MISSING'); };
  h.native(() => ({ click() { clicks++; } }));
  await h.bookmark();
  assert.equal(clicks, 1); assert.ok(h.actions.includes('Could not update bookmark'));
  assert.ok(!h.actions.includes('Bookmark updated'));
});

test('shadow input and button events are not intercepted; pagination preserves focused drafts', () => {
  const h = workbench();
  for (const [tagName, key] of [['INPUT', 'Enter'], ['INPUT', 'ArrowLeft'], ['BUTTON', ' ']]) {
    h.key({ target: { tagName: 'DIV' }, composedPath: () => [{ tagName }], key, code: key === ' ' ? 'Space' : key, preventDefault() { throw new Error('intercepted'); } });
  }
  assert.equal(h.actions.length, 0);
  h.pagination(); assert.equal(h.input.value, '12');
  h.blur(); h.pagination(); assert.equal(h.input.value, '1');
});

test('background serializes read/history deltas from multiple tabs', async () => {
  const state = { workbenchSeenWorkIds: ['100'], pp_download_history: [] }; let listener;
  const ctx = { chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } }, onConnect: { addListener() {} } },
    storage: { local: {
      get(defaults, callback) { const snapshot = { ...defaults, ...structuredClone(state) }; setImmediate(() => callback(snapshot)); },
      set(patch, callback) { setImmediate(() => { Object.assign(state, structuredClone(patch)); callback(); }); }
    } }
  } };
  vm.createContext(ctx); ctx.importScripts = () => vm.runInContext(read('lib/settings.js'), ctx);
  vm.runInContext(read('background/service-worker.js'), ctx);
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  const result = await Promise.all([
    send({ type: 'markWorkSeen', workId: '101' }), send({ type: 'markWorkSeen', workId: '102' }),
    send({ type: 'addDownloadHistory', item: { id: 'a', filename: 'a.jpg', state: 'complete' } }),
    send({ type: 'addDownloadHistory', item: { id: 'b', filename: 'b.jpg', state: 'complete' } })
  ]);
  assert.ok(result.every(value => value.ok));
  assert.deepEqual(state.workbenchSeenWorkIds, ['100', '101', '102']);
  assert.deepEqual(state.pp_download_history.map(item => item.filename), ['b.jpg', 'a.jpg']);
});
