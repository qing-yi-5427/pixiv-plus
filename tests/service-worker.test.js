const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workerSource = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'service-worker.js'),
  'utf8'
);

function loadWorker(fetchImpl) {
  let connectListener;
  const context = {
    fetch: fetchImpl,
    AbortController,
    Uint8Array,
    URL,
    Date,
    btoa,
    console,
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        onConnect: { addListener: listener => { connectListener = listener; } }
      },
      storage: { local: { get: () => {}, set: () => {} } }
    }
  };
  vm.createContext(context);
  vm.runInContext(workerSource, context);
  return connectListener;
}

function createPort() {
  const messages = [];
  let messageListener;
  let disconnectListener;
  return {
    port: {
      name: 'pixivplus-image-stream',
      postMessage: message => messages.push(message),
      onMessage: { addListener: listener => { messageListener = listener; } },
      onDisconnect: { addListener: listener => { disconnectListener = listener; } }
    },
    messages,
    start: message => messageListener(message),
    disconnect: () => disconnectListener()
  };
}

async function waitFor(predicate) {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for worker message');
}

test('image stream sends chunks without assembling a full data URL', async () => {
  const connect = loadWorker(async () => ({
    ok: true,
    headers: new Headers({ 'content-length': '3', 'content-type': 'image/png' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    })
  }));
  const mock = createPort();
  connect(mock.port);
  mock.start({ type: 'start', requestId: 'request-1', url: 'https://i.pximg.net/image.png' });

  await waitFor(() => mock.messages.some(message => message.type === 'done'));
  const chunk = mock.messages.find(message => message.type === 'chunk');
  const done = mock.messages.find(message => message.type === 'done');
  assert.deepEqual(Array.from(Buffer.from(chunk.data, 'base64')), [1, 2, 3]);
  assert.equal(done.contentType, 'image/png');
  assert.equal(done.received, 3);
});

test('disconnecting the port aborts the background fetch', async () => {
  let fetchSignal;
  const connect = loadWorker(async (_url, options) => {
    fetchSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('Cancelled', 'AbortError'));
      });
    });
  });
  const mock = createPort();
  connect(mock.port);
  mock.start({ type: 'start', requestId: 'request-2', url: 'https://i.pximg.net/image.png' });
  mock.disconnect();

  assert.equal(fetchSignal.aborted, true);
});

test('image stream rejects non-Pixiv media URLs before fetch', async () => {
  let fetched = false;
  const connect = loadWorker(async () => {
    fetched = true;
    throw new Error('should not fetch');
  });
  const mock = createPort();
  connect(mock.port);
  mock.start({ type: 'start', requestId: 'request-3', url: 'https://example.com/private' });

  await waitFor(() => mock.messages.some(message => message.type === 'error'));
  assert.equal(fetched, false);
  assert.match(mock.messages.find(message => message.type === 'error').error, /Blocked non-Pixiv/);
});
