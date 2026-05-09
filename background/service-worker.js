// PixivPlus - Background Service Worker
// Fetches images and downloads them via chrome.downloads API
// Referer is injected by declarativeNetRequest rules

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getSettings') {
    chrome.storage.local.get({
      hoverPreview: true,
      hoverDelay: 400,
      filenameTemplate: '{artist}-{title}-{id}',
      embedTags: true
    }, (settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (msg.type === 'saveSettings') {
    const toSave = {};
    if (msg.hoverPreview !== undefined) toSave.hoverPreview = msg.hoverPreview;
    if (msg.hoverDelay !== undefined) toSave.hoverDelay = msg.hoverDelay;
    if (msg.embedTags !== undefined) toSave.embedTags = msg.embedTags;
    if (msg.filenameTemplate !== undefined) toSave.filenameTemplate = msg.filenameTemplate;
    chrome.storage.local.set(toSave);
    sendResponse({ ok: true });
  }

  if (msg.type === 'fetchImage') {
    fetchAndSend(msg.url, sender.tab?.id).then(arrayBuffer => {
      // Convert to base64 for safe transfer via messaging
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const contentType = guessContentType(msg.url);
      const dataUrl = `data:${contentType};base64,${base64}`;
      sendResponse({ dataUrl });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function fetchAndSend(url, tabId) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const contentLength = parseInt(resp.headers.get('content-length') || '0');
  const reader = resp.body.getReader();
  let received = 0;
  let lastTime = Date.now();
  let lastBytes = 0;

  // Read the full body while reporting progress
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const now = Date.now();
    if (now - lastTime > 300) {
      const elapsed = (now - lastTime) / 1000;
      const speed = elapsed > 0 ? (received - lastBytes) / elapsed : 0;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'fetch-progress',
          url,
          received,
          total: contentLength,
          speed: formatSpeed(speed)
        }).catch(() => {});
      }
      lastTime = now;
      lastBytes = received;
    }
  }

  // Combine chunks
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

function guessContentType(url) {
  if (url.includes('.png')) return 'image/png';
  if (url.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}
