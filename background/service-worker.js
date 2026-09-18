// PixivPlus - Background Service Worker
// Streams images to the content script for saving via the File System Access API.
// Referer is injected by declarativeNetRequest rules

const activeTransfers = new Map();
importScripts('../lib/settings.js');
let settingsWrites = Promise.resolve();
let stateWrites = Promise.resolve();

function updateLocalState(key, update) {
  const result = stateWrites.then(() => new Promise((resolve, reject) => {
    chrome.storage.local.get({ [key]: [] }, saved => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      const value = update(Array.isArray(saved[key]) ? saved[key] : []);
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(value);
      });
    });
  }));
  stateWrites = result.catch(() => {});
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'markWorkSeen') {
    if (!/^\d+$/.test(String(msg.workId))) { sendResponse({ error: 'Invalid artwork ID' }); return; }
    updateLocalState('workbenchSeenWorkIds', ids => [...new Set([...ids.map(String), String(msg.workId)])])
      .then(() => sendResponse({ ok: true }), error => sendResponse({ error: error.message }));
    return true;
  }
  if (msg.type === 'addDownloadHistory') {
    const item = msg.item;
    if (!item || typeof item.id !== 'string' || typeof item.filename !== 'string'
      || !['complete', 'interrupted', 'cancelled'].includes(item.state)) {
      sendResponse({ error: 'Invalid history entry' }); return;
    }
    const entry = { id: item.id, filename: item.filename, state: item.state, timestamp: Date.now() };
    for (const key of ['thumbUrl', 'title', 'artist', 'workId', 'error']) entry[key] = String(item[key] || '').slice(0, 2048);
    entry.pageIndex = Number.isInteger(item.pageIndex) ? item.pageIndex : 0;
    updateLocalState('pp_download_history', items => [entry, ...items.filter(old => old.id !== entry.id)].slice(0, 100))
      .then(() => sendResponse({ ok: true }), error => sendResponse({ error: error.message }));
    return true;
  }
  if (msg.type === 'getSettings') {
    chrome.storage.local.get(PixivPlusSettings.defaults, (settings) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { error: error.message } : PixivPlusSettings.normalize(settings));
    });
    return true;
  }

  if (msg.type === 'saveSettings') {
    try {
      const toSave = PixivPlusSettings.validatePatch(msg);
      settingsWrites = settingsWrites.then(() => new Promise(resolve => {
        chrome.storage.local.set(toSave, () => {
          const error = chrome.runtime.lastError;
          try { sendResponse(error ? { error: error.message } : { ok: true }); }
          finally { resolve(); }
        });
      }));
    } catch (error) { sendResponse({ error: `Invalid setting: ${error.message}` }); }
    return true;
  }

  if (msg.type === 'openSettings') {
    chrome.runtime.openOptionsPage();
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
