// Tab-local original bytes shared by preloading, previews and file downloads.
(() => {
  'use strict';
  const MAX_BYTES = 128 * 1024 * 1024;
  const TTL_MS = 10 * 60 * 1000;
  const entries = new Map(), pending = new Map(), listeners = new Set();
  let totalBytes = 0;
  const emit = (url, state) => listeners.forEach(listener => { try { listener(url, state); } catch {} });
  function remove(url) {
    const entry = entries.get(url);
    if (!entry) return;
    totalBytes -= entry.blob.size; entries.delete(url); emit(url, 'released');
  }
  function prune() {
    const now = Date.now();
    for (const [url, entry] of entries) if (now - entry.used >= TTL_MS) remove(url);
  }
  function peek(url) {
    prune();
    const entry = entries.get(url);
    if (!entry) return null;
    entry.used = Date.now(); entries.delete(url); entries.set(url, entry);
    return entry.blob;
  }
  function has(url) { prune(); return entries.has(url); }
  function retain(url, blob) {
    prune();
    if (blob.size > MAX_BYTES) return; // Return the bytes, but never claim they are retained.
    if (entries.has(url)) remove(url);
    while (totalBytes + blob.size > MAX_BYTES && entries.size) remove(entries.keys().next().value);
    entries.set(url, { blob, used: Date.now() }); totalBytes += blob.size;
    emit(url, 'cached');
  }
  function transfer(url, signal, progress) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      const port = chrome.runtime.connect({ name: 'pixivplus-image-stream' });
      const requestId = crypto.randomUUID(), chunks = [];
      let settled = false;
      const finish = (error, blob) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        try { port.disconnect(); } catch {}
        if (error) reject(error); else resolve(blob);
      };
      const abort = () => finish(signal.reason || new DOMException('Cancelled', 'AbortError'));
      let timer;
      const armTimeout = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error('ORIGINAL_PRELOAD_TIMEOUT')), 45000); };
      armTimeout();
      signal.addEventListener('abort', abort, { once: true });
      port.onMessage.addListener(message => {
        if (message.requestId && message.requestId !== requestId) return;
        armTimeout();
        if (message.type === 'chunk') {
          const binary = atob(message.data), bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          chunks.push(bytes);
        } else if (message.type === 'progress') progress(message);
        else if (message.type === 'done') {
          const blob = new Blob(chunks, { type: message.contentType || 'application/octet-stream' });
          if (!blob.size || (message.received != null && message.received !== blob.size)) {
            finish(new Error('Incomplete original image')); return;
          }
          finish(null, blob);
        } else if (message.type === 'error') finish(new Error(message.error || 'Download failed'));
      });
      port.onDisconnect.addListener(() => finish(new Error('Download connection closed')));
      try { port.postMessage({ type: 'start', requestId, url }); }
      catch (error) { finish(error); }
    });
  }
  function get(url, { signal, onProgress } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = peek(url);
    if (cached) { onProgress?.({ received: cached.size, total: cached.size, speed: 'Cached' }); return Promise.resolve(cached); }
    let task = pending.get(url);
    if (!task) {
      task = { controller: new AbortController(), clients: new Set(), progress: null };
      pending.set(url, task);
      // Start after registering consumers; same-URL calls share one transfer.
      Promise.resolve().then(() => transfer(url, task.controller.signal, value => {
        task.progress = value;
        for (const client of task.clients) { try { client.onProgress?.(value); } catch {} }
      })).then(blob => {
        if (task.controller.signal.aborted) throw task.controller.signal.reason;
        if (pending.get(url) === task) pending.delete(url);
        retain(url, blob);
        for (const client of [...task.clients]) client.finish(null, blob);
      }).catch(error => {
        if (pending.get(url) === task) pending.delete(url);
        for (const client of [...task.clients]) client.finish(error);
      }).finally(() => { if (pending.get(url) === task) pending.delete(url); });
    }
    return new Promise((resolve, reject) => {
      const client = { onProgress, finish(error, blob) {
        signal?.removeEventListener('abort', abort); task.clients.delete(client);
        if (error) reject(error); else resolve(blob);
      } };
      const abort = () => {
        client.finish(signal.reason || new DOMException('Cancelled', 'AbortError'));
        if (!task.clients.size) {
          task.controller.abort();
          if (pending.get(url) === task) pending.delete(url);
        }
      };
      task.clients.add(client); signal?.addEventListener('abort', abort, { once: true });
      if (task.progress) onProgress?.(task.progress);
    });
  }
  setInterval(prune, 60000);
  window.PixivPlusOriginalCache = { get, peek, has, prune, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
})();
