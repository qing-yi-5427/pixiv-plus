// PixivPlus - Background Service Worker
// Streams images to the content script for saving via the File System Access API.
// Referer is injected by declarativeNetRequest rules

const activeTransfers = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getSettings') {
    chrome.storage.local.get({
      hoverPreview: true,
      workbenchEnabled: true,
      workbenchPreloadOriginals: false,
      hoverDelay: 400,
      filenameTemplate: '{artist}-{title}-{id}',
      embedTags: true,
      previewBehavior: 'peek',
      downloadConcurrency: 3,
      duplicatePolicy: 'skip',
      multiDownloadDefault: 'ask'
    }, (settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (msg.type === 'saveSettings') {
    const toSave = {};
    if (msg.hoverPreview !== undefined) toSave.hoverPreview = msg.hoverPreview;
    if (msg.workbenchEnabled !== undefined) toSave.workbenchEnabled = msg.workbenchEnabled;
    if (msg.workbenchPreloadOriginals !== undefined) toSave.workbenchPreloadOriginals = msg.workbenchPreloadOriginals;
    if (msg.hoverDelay !== undefined) toSave.hoverDelay = msg.hoverDelay;
    if (msg.embedTags !== undefined) toSave.embedTags = msg.embedTags;
    if (msg.filenameTemplate !== undefined) toSave.filenameTemplate = msg.filenameTemplate;
    if (msg.previewBehavior !== undefined) toSave.previewBehavior = msg.previewBehavior;
    if (msg.downloadConcurrency !== undefined) toSave.downloadConcurrency = msg.downloadConcurrency;
    if (msg.duplicatePolicy !== undefined) toSave.duplicatePolicy = msg.duplicatePolicy;
    if (msg.multiDownloadDefault !== undefined) toSave.multiDownloadDefault = msg.multiDownloadDefault;
    chrome.storage.local.set(toSave);
    sendResponse({ ok: true });
  }

  if (msg.type === 'estimateSizes') {
    estimateSizes(msg.urls || []).then(sizes => sendResponse({ sizes })).catch(err => {
      sendResponse({ error: err.message, sizes: [] });
    });
    return true;
  }

});

async function estimateSizes(urls) {
  const result = new Array(urls.length).fill(0);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      try {
        assertAllowedMediaUrl(urls[index]);
        const resp = await fetch(urls[index], { method: 'HEAD' });
        if (resp.ok) result[index] = parseInt(resp.headers.get('content-length') || '0');
      } catch {}
    }
  });
  await Promise.all(workers);
  return result;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pixivplus-image-stream') return;

  let requestId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type !== 'start' || requestId) return;
    requestId = msg.requestId;
    const controller = new AbortController();
    activeTransfers.set(requestId, controller);

    streamImage(msg.url, port, controller.signal)
      .catch(err => {
        if (err.name !== 'AbortError') {
          safePost(port, { type: 'error', requestId, error: err.message });
        }
      })
      .finally(() => activeTransfers.delete(requestId));
  });

  port.onDisconnect.addListener(() => {
    if (!requestId) return;
    activeTransfers.get(requestId)?.abort();
    activeTransfers.delete(requestId);
  });
});

async function streamImage(url, port, signal) {
  assertAllowedMediaUrl(url);
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const contentLength = parseInt(resp.headers.get('content-length') || '0');
  const reader = resp.body.getReader();
  let received = 0;
  let lastTime = Date.now();
  let lastBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;

    safePost(port, {
      type: 'chunk',
      data: bytesToBase64(value)
    });

    const now = Date.now();
    if (now - lastTime > 300) {
      const elapsed = (now - lastTime) / 1000;
      const speed = elapsed > 0 ? (received - lastBytes) / elapsed : 0;
      safePost(port, {
        type: 'progress',
        received,
        total: contentLength,
        speed: formatSpeed(speed)
      });
      lastTime = now;
      lastBytes = received;
    }
  }

  safePost(port, {
    type: 'done',
    received,
    total: contentLength,
    contentType: resp.headers.get('content-type') || guessContentType(url)
  });
}

function assertAllowedMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid media URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'i.pximg.net') {
    throw new Error('Blocked non-Pixiv media URL');
  }
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The content script disconnected; onDisconnect aborts the fetch.
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const blockSize = 0x8000;
  for (let i = 0; i < bytes.length; i += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + blockSize));
  }
  return btoa(binary);
}

function guessContentType(url) {
  if (url.includes('.zip')) return 'application/zip';
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}
