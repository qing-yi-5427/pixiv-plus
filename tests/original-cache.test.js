const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(setImmediate);
function fixture(maxBytes) {
  const ports = [], events = [], timers = new Map();
  let now = 0, id = 0;
  const context = { window: {}, Blob, atob, DOMException, AbortController, crypto: require('node:crypto'),
    Date: { now: () => now }, setInterval() {}, setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { connect() {
      let message, disconnect;
      const port = { disconnected: false, onMessage: { addListener(fn) { message = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } },
        postMessage(value) { port.url = value.url; }, disconnect() { port.disconnected = true; disconnect(); },
        progress(received, total) { message({ type: 'progress', received, total }); },
        send(value) { message(value); },
        complete(text = 'original-data') { message({ type: 'chunk', data: btoa(text) }); message({ type: 'done', received: text.length, contentType: 'image/png' }); },
        incomplete() { message({ type: 'chunk', data: btoa('partial') }); message({ type: 'done', received: 100 }); }
      }; ports.push(port); return port;
    } } }
  };
  let source = fs.readFileSync(require.resolve('../lib/original-cache.js'), 'utf8');
  if (maxBytes) source = source.replace('128 * 1024 * 1024', String(maxBytes));
  vm.runInNewContext(source, context);
  const api = context.window.PixivPlusOriginalCache;
  api.subscribe((...args) => events.push(args));
  return { api, ports, events, timers, advance(ms) { now += ms; } };
}

test('preload bytes are returned to a subsequent download without another transfer', async () => {
  const h = fixture(), progress = [];
  const preload = h.api.get('original'); await flush(); h.ports[0].complete();
  const original = await preload;
  const download = await h.api.get('original', { onProgress: value => progress.push(value) });
  assert.equal(download, original); assert.equal(await download.text(), 'original-data');
  assert.equal(h.ports.length, 1); assert.equal(progress[0].speed, 'Cached');
  assert.equal(h.timers.size, 0);
});

test('preload and download share an in-flight transfer; cancelling one leaves the other alive', async () => {
  const h = fixture(), controller = new AbortController(), progress = [];
  const preload = h.api.get('same', { signal: controller.signal });
  const rejection = assert.rejects(preload, { name: 'AbortError' });
  const download = h.api.get('same', { onProgress: value => progress.push(value) });
  await flush(); h.ports[0].progress(5, 10); controller.abort(); await rejection;
  assert.equal(h.ports.length, 1); assert.equal(h.ports[0].disconnected, false);
  h.ports[0].complete(); assert.equal(await (await download).text(), 'original-data');
  assert.equal(progress[0].received, 5); assert.equal(h.api.has('same'), true);
});

test('cancelling the last consumer disconnects and caches no partial bytes', async () => {
  const h = fixture(), controller = new AbortController();
  const pending = h.api.get('cancel', { signal: controller.signal });
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  await flush(); controller.abort(); await rejection; await flush();
  assert.equal(h.ports[0].disconnected, true); assert.equal(h.api.has('cancel'), false);
  assert.equal(h.timers.size, 0);
});

test('idle expiry emits released and next use fetches fresh bytes', async () => {
  const h = fixture();
  const first = h.api.get('expire'); await flush(); h.ports[0].complete(); await first;
  h.advance(600000); h.api.prune(); assert.equal(h.api.has('expire'), false);
  assert.ok(h.events.some(([url, state]) => url === 'expire' && state === 'released'));
  const next = h.api.get('expire'); await flush(); assert.equal(h.ports.length, 2);
  h.ports[1].complete(); await next;
});

test('cache byte budget evicts LRU entries, and oversized originals are not marked cached', async () => {
  const h = fixture(20);
  for (const url of ['a', 'b']) { const load = h.api.get(url); await flush(); h.ports.at(-1).complete('1234567890'); await load; }
  h.api.peek('a');
  const load = h.api.get('c'); await flush(); h.ports.at(-1).complete('1234567890'); await load;
  assert.equal(h.api.has('a'), true); assert.equal(h.api.has('b'), false); assert.equal(h.api.has('c'), true);
  const large = h.api.get('large'); await flush(); h.ports.at(-1).complete('x'.repeat(21));
  assert.equal((await large).size, 21); assert.equal(h.api.has('large'), false);
});

test('incomplete transfers are rejected and never reported as cached', async () => {
  const h = fixture(); const load = h.api.get('broken'); const rejection = assert.rejects(load, /Incomplete/);
  await flush(); h.ports[0].incomplete(); await rejection;
  assert.equal(h.api.has('broken'), false);
});

test('invalid chunks reject immediately and late messages cannot restart the timer', async () => {
  const h = fixture(); const load = h.api.get('broken');
  const rejection = assert.rejects(load, /Invalid original image chunk/);
  await flush();
  assert.doesNotThrow(() => h.ports[0].send({ type: 'chunk', data: '%%%invalid%%%' }));
  await rejection;
  h.ports[0].send({ type: 'progress', received: 1, total: 2 });
  assert.equal(h.timers.size, 0); assert.equal(h.api.has('broken'), false);
});

test('throwing progress observers cannot break cached or shared consumers', async () => {
  const h = fixture(), faulty = () => { throw new Error('Observer failed'); };
  const first = h.api.get('shared'); await flush(); h.ports[0].progress(1, 2);
  const second = h.api.get('shared', { onProgress: faulty });
  h.ports[0].complete();
  assert.equal(await first, await second);
  assert.equal(await h.api.get('shared', { onProgress: faulty }), await first);
  assert.equal(h.ports.length, 1);
});
