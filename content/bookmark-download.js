// PixivPlus - Download Module
// Handles image downloading: background fetches, content script writes to file system

(() => {
  'use strict';

  let dirHandle = null;
  let dirHandleLoad = null;
  const pendingDownloads = [];
  const activeDownloads = new Map(); // url -> job
  const reservedFilenames = new Set();
  const failedDownloads = new Map(); // filename -> job
  const completedWorkIds = new Set();
  let maxConcurrentDownloads = 3;
  let duplicatePolicy = 'skip';
  let multiDownloadDefault = 'ask';
  let queuePaused = false;
  let runningDownloads = 0;

  chrome.storage.local.get({
    downloadConcurrency: 3,
    duplicatePolicy: 'skip',
    multiDownloadDefault: 'ask'
  }, settings => {
    maxConcurrentDownloads = Math.max(1, Math.min(6, settings.downloadConcurrency || 3));
    duplicatePolicy = settings.duplicatePolicy || 'skip';
    multiDownloadDefault = settings.multiDownloadDefault || 'ask';
  });
  chrome.storage.onChanged.addListener(changes => {
    if (changes.downloadConcurrency) {
      maxConcurrentDownloads = Math.max(1, Math.min(6, changes.downloadConcurrency.newValue || 3));
      pumpDownloadQueue();
    }
    if (changes.duplicatePolicy) duplicatePolicy = changes.duplicatePolicy.newValue || 'skip';
    if (changes.multiDownloadDefault) multiDownloadDefault = changes.multiDownloadDefault.newValue || 'ask';
  });

  // --- IndexedDB for directory handle ---

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('pixivplus', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('handles')) {
          req.result.createObjectStore('handles');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDirHandle(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'downloadDir');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadDirHandle() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('downloadDir');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  // Warm the persisted handle before the first click so opening the directory
  // picker does not spend the short user-activation window on IndexedDB.
  dirHandleLoad = loadDirHandle().then(handle => {
    dirHandle = handle;
    window.PixivPlusDownloadPanel?.setFolderName(handle?.name || 'not selected');
    return handle;
  }).catch(() => null);

  // --- Directory handle management ---

  async function getDirHandle(userGesture) {
    if (!dirHandleLoad) {
      dirHandleLoad = loadDirHandle().then(handle => {
        if (!dirHandle) dirHandle = handle;
        return dirHandle;
      }).catch(() => null);
    }
    await dirHandleLoad;

    if (dirHandle) {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return dirHandle;
      if (userGesture) {
        const req = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') return dirHandle;
      }
    }

    if (!userGesture) return null;

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = handle;
      await saveDirHandle(handle);
      window.PixivPlusDownloadPanel?.setFolderName(handle.name);
      return handle;
    } catch (e) {
      if (e.name !== 'AbortError') {
        window.PixivPlusDownloadPanel?.showToast(`Folder access failed: ${e.message}`, 'error');
      }
      return null;
    }
  }

  async function chooseDirectory() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = handle;
      dirHandleLoad = Promise.resolve(handle);
      await saveDirHandle(handle);
      window.PixivPlusDownloadPanel?.showToast(`Download folder: ${handle.name}`, 'success');
      return handle;
    } catch (err) {
      if (err.name !== 'AbortError') {
        window.PixivPlusDownloadPanel?.showToast(`Could not select folder: ${err.message}`, 'error');
      }
      return null;
    }
  }

  // --- Tag injection into image metadata ---

  async function injectTags(blob, tags) {
    const tagStr = tags.join(', ');
    const buf = await blob.arrayBuffer();
    const view = new Uint8Array(buf);

    if (blob.type === 'image/png' || isPNG(view)) {
      return injectPNGTags(buf, tagStr);
    }
    if (blob.type === 'image/jpeg' || isJPEG(view)) {
      return injectJPEGXMP(buf, tagStr);
    }
    return blob;
  }

  function isPNG(v) { return v[0] === 0x89 && v[1] === 0x50; }
  function isJPEG(v) { return v[0] === 0xFF && v[1] === 0xD8; }

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function injectPNGTags(buf, tagStr) {
    // PNG: insert iTXt chunk with XMP after IHDR
    // This is how Windows reads PNG "Tags" property
    const xmp = buildXMP(tagStr);

    // iTXt chunk: keyword\0 compression_flag compression_method language_tag\0 translated_keyword\0 text
    const keyword = new TextEncoder().encode('XML:com.adobe.xmp');
    const text = new TextEncoder().encode(xmp);
    // keyword\0 + compression_flag(1) + compression_method(1) + language_tag\0 + translated_keyword\0 + text
    const chunkData = new Uint8Array(keyword.length + 1 + 1 + 1 + 1 + 1 + text.length);
    let off = 0;
    chunkData.set(keyword, off); off += keyword.length;
    chunkData[off++] = 0; // null terminator for keyword
    chunkData[off++] = 0; // compression flag (0 = uncompressed)
    chunkData[off++] = 0; // compression method
    chunkData[off++] = 0; // null terminator for language tag (empty)
    chunkData[off++] = 0; // null terminator for translated keyword (empty)
    chunkData.set(text, off);

    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, chunkData.length);

    const type = new TextEncoder().encode('iTXt');
    const crcData = new Uint8Array(4 + chunkData.length);
    crcData.set(type, 0);
    crcData.set(chunkData, 4);
    const crcVal = new Uint8Array(4);
    new DataView(crcVal.buffer).setUint32(0, crc32(crcData));

    // Find position after IHDR chunk
    const ihdrLen = new DataView(buf).getUint32(8);
    const insertPos = 8 + 4 + 4 + ihdrLen + 4;

    const before = new Uint8Array(buf, 0, insertPos);
    const after = new Uint8Array(buf, insertPos);

    const result = new Uint8Array(before.length + 4 + 4 + chunkData.length + 4 + after.length);
    result.set(before, 0);
    off = before.length;
    result.set(length, off); off += 4;
    result.set(type, off); off += 4;
    result.set(chunkData, off); off += chunkData.length;
    result.set(crcVal, off); off += 4;
    result.set(after, off);

    return new Blob([result], { type: 'image/png' });
  }

  function buildXMP(tagStr) {
    const tags = tagStr.split(', ');
    const items = tags.map(t => `      <rdf:li>${escapeXML(t)}</rdf:li>`).join('\n');
    return [
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
      '         xmlns:dc="http://purl.org/dc/elements/1.1/">',
      '<rdf:Description rdf:about="">',
      '  <dc:subject><rdf:Bag>',
      items,
      '  </rdf:Bag></dc:subject>',
      '</rdf:Description>',
      '</rdf:RDF>',
      '</x:xmpmeta>',
      '<?xpacket end="w"?>'
    ].join('\n');
  }

  function injectJPEGXMP(buf, tagStr) {
    // JPEG: insert APP1 XMP segment after SOI marker
    const xmp = buildXMP(tagStr);

    const xmpBytes = new TextEncoder().encode(xmp);
    // APP1 marker: FF E1 + 2 bytes length (includes length bytes themselves) + "http://ns.adobe.com/xap/1.0/\0" + xmp
    const xmpNS = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
    const payload = new Uint8Array(xmpNS.length + xmpBytes.length);
    payload.set(xmpNS, 0);
    payload.set(xmpBytes, xmpNS.length);

    const segLen = payload.length + 2; // +2 for length field itself
    const app1 = new Uint8Array(2 + 2 + payload.length);
    app1[0] = 0xFF; app1[1] = 0xE1; // APP1 marker
    new DataView(app1.buffer).setUint16(2, segLen);
    app1.set(payload, 4);

    // Insert after SOI (first 2 bytes: FF D8)
    const before = new Uint8Array(buf, 0, 2);
    const after = new Uint8Array(buf, 2);
    const result = new Uint8Array(2 + app1.length + after.length);
    result.set(before, 0);
    result.set(app1, 2);
    result.set(after, 2 + app1.length);

    return new Blob([result], { type: 'image/jpeg' });
  }

  function escapeXML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Download logic ---

  async function downloadFile(url, filename, tags, meta, options = {}) {
    const panel = window.PixivPlusDownloadPanel;
    const policy = options.duplicatePolicy || duplicatePolicy;
    if (policy === 'skip' && panel?.isDuplicate(filename)) {
      panel.showToast(`Already downloaded: ${meta?.title || filename}`, 'warning');
      updateThumbnailState(meta?.workId, 'complete');
      return false;
    }

    const handle = Object.hasOwn(options, 'dirHandle')
      ? options.dirHandle
      : await getDirHandle(options.promptForDir !== false);

    if (!handle) {
      panel?.showToast('Choose a download folder before downloading', 'warning');
      updateThumbnailState(meta?.workId, 'idle');
      return false;
    }

    if (policy === 'rename') {
      filename = await getAvailableFilename(handle, filename);
    }
    if (reservedFilenames.has(filename)) {
      panel?.showToast(`Already queued: ${meta?.title || filename}`, 'warning');
      return false;
    }

    const job = {
      url,
      filename,
      tags,
      meta: meta || {},
      dirHandle: handle,
      duplicatePolicy: policy,
      companion: options.companion || null,
      controller: new AbortController(),
      cancelled: false
    };
    reservedFilenames.add(filename);
    pendingDownloads.push(job);
    updateThumbnailState(meta?.workId, 'queued');

    panel.updateDownload({
      filename,
      state: 'queued',
      bytesReceived: 0,
      totalBytes: 0,
      speed: 'Queued',
      url,
      thumbUrl: meta?.thumbUrl || '',
      title: meta?.title || '',
      artist: meta?.artist || '',
      workId: meta?.workId || '',
      pageIndex: meta?.pageIndex ?? 0
    });

    pumpDownloadQueue();
    return true;
  }

  function pumpDownloadQueue() {
    if (queuePaused) return;
    while (runningDownloads < maxConcurrentDownloads && pendingDownloads.length > 0) {
      const job = pendingDownloads.shift();
      if (job.cancelled) continue;
      runningDownloads++;
      activeDownloads.set(job.url, job);
      runDownload(job).finally(() => {
        activeDownloads.delete(job.url);
        reservedFilenames.delete(job.filename);
        runningDownloads--;
        pumpDownloadQueue();
      });
    }
  }

  async function runDownload(job) {
    const { url, filename, tags, meta, dirHandle: handle, controller } = job;
    const panel = window.PixivPlusDownloadPanel;

    panel.updateDownload({
      filename,
      state: 'in_progress',
      bytesReceived: 0,
      totalBytes: 0,
      speed: 'Connecting...',
      url,
      thumbUrl: meta.thumbUrl || '',
      title: meta.title || '',
      artist: meta.artist || '',
      workId: meta.workId || '',
      pageIndex: meta.pageIndex ?? 0
    });
    updateThumbnailState(meta.workId, 'downloading', 0);

    try {
      const blob = await fetchImageStream(url, controller.signal, progress => {
        panel.updateDownload({
          filename,
          state: 'in_progress',
          bytesReceived: progress.received,
          totalBytes: progress.total,
          speed: progress.speed,
          url
        });
        const pct = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;
        updateThumbnailState(meta.workId, 'downloading', pct);
      });

      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      // Inject tags into image metadata
      const embedTags = await new Promise(r => chrome.storage.local.get({ embedTags: true }, s => r(s.embedTags)));
      let outputBlob = blob;
      if (embedTags && tags && tags.length > 0) {
        outputBlob = await injectTags(blob, tags);
      }

      await writeFile(handle, filename, outputBlob, job.duplicatePolicy);
      if (job.companion) {
        await writeFile(
          handle,
          job.companion.filename,
          new Blob([job.companion.text], { type: job.companion.type || 'application/json' }),
          job.duplicatePolicy
        );
      }
      panel.updateDownload({ filename, state: 'complete' });
      failedDownloads.delete(filename);
      updateThumbnailState(meta.workId, 'complete');

    } catch (err) {
      if (controller.signal.aborted || err.name === 'AbortError') {
        panel.updateDownload({ filename, state: 'cancelled' });
        updateThumbnailState(meta.workId, 'idle');
        return;
      }
      failedDownloads.set(filename, { ...job, controller: null });
      updateThumbnailState(meta.workId, 'error');
      panel.updateDownload({
        filename,
        state: 'interrupted',
        error: err.message
      });
    }
  }

  function fetchImageStream(url, signal, onProgress) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'pixivplus-image-stream' });
      const requestId = crypto.randomUUID();
      const chunks = [];
      let settled = false;
      let contentType = 'application/octet-stream';

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        try { port.disconnect(); } catch {}
        fn(value);
      };

      const onAbort = () => finish(reject, new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });

      port.onMessage.addListener(msg => {
        if (msg.requestId && msg.requestId !== requestId) return;
        if (msg.type === 'chunk') {
          chunks.push(base64ToBytes(msg.data));
        } else if (msg.type === 'progress') {
          onProgress(msg);
        } else if (msg.type === 'done') {
          contentType = msg.contentType || contentType;
          finish(resolve, new Blob(chunks, { type: contentType }));
        } else if (msg.type === 'error') {
          finish(reject, new Error(msg.error || 'Download failed'));
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) finish(reject, new Error('Download connection closed'));
      });

      port.postMessage({ type: 'start', requestId, url });
    });
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function downloadWork(workId) {
    // Ask for the directory while this function is still handling the user's
    // click; file pickers require transient user activation.
    const handle = await getDirHandle(true);
    if (!handle) return false;
    try {
      const info = await window.PixivPlusAPI.getWorkInfo(workId);
      if (info.isUgoira) {
        await downloadUgoiraWork(info, handle);
        return;
      }
      if (info.pageCount === 1) {
        const url = info.pageUrls[0]?.original;
        if (!url) throw new Error('No URL');
        const filename = window.PixivPlusAPI.generateFilename(info, 0);
        downloadFile(url, filename, info.tags, {
          thumbUrl: info.urls.small || info.urls.regular || '',
          title: info.title,
          artist: info.artist,
          workId: info.id,
          pageIndex: 0
        }, { dirHandle: handle });
      } else {
        if (multiDownloadDefault === 'all') {
          queuePages(info, info.pageUrls.map((_, index) => index), handle);
        } else {
          showMultiImageSelector(info, handle);
        }
      }
    } catch (err) {
      window.PixivPlusDownloadPanel.showToast(`Could not download work: ${err.message}`, 'error');
    }
  }

  function queuePages(info, indices, handle) {
    for (const idx of indices) {
      const url = info.pageUrls[idx]?.original;
      if (!url) continue;
      const filename = window.PixivPlusAPI.generateFilename(info, idx);
      downloadFile(url, filename, info.tags, {
        thumbUrl: info.pageUrls[idx]?.regular || info.urls.small || info.urls.regular || '',
        title: info.title,
        artist: info.artist,
        workId: info.id,
        pageIndex: idx
      }, { dirHandle: handle });
    }
  }

  async function downloadAllWork(info) {
    if (!info) return;
    try {
      const handle = await getDirHandle(true);
      if (!handle) return false;
      if (info.isUgoira) {
        await downloadUgoiraWork(info, handle);
        return;
      }
      queuePages(info, info.pageUrls.map((_, index) => index), handle);
    } catch (err) {
      window.PixivPlusDownloadPanel.showToast(`Could not download work: ${err.message}`, 'error');
    }
  }

  async function downloadWorks(workIds) {
    const ids = [...new Set((workIds || []).map(String).filter(id => /^\d+$/.test(id)))];
    if (ids.length === 0) return;
    const handle = await getDirHandle(true);
    if (!handle) return false;
    for (const workId of ids) {
      try {
        const info = await window.PixivPlusAPI.getWorkInfo(workId);
        if (info.isUgoira) await downloadUgoiraWork(info, handle);
        else queuePages(info, info.pageUrls.map((_, index) => index), handle);
      } catch (err) {
        window.PixivPlusDownloadPanel.showToast(`Could not queue ${workId}: ${err.message}`, 'error');
      }
    }
  }

  async function downloadUgoiraWork(info, preparedHandle = undefined) {
    const handle = preparedHandle === undefined ? await getDirHandle(true) : preparedHandle;
    if (!handle) return false;
    const ugoira = await window.PixivPlusAPI.getUgoiraMeta(info.id);
    if (!ugoira.zipUrl) throw new Error('Ugoira ZIP unavailable');
    const imageFilename = window.PixivPlusAPI.generateFilename(info, 0);
    const base = imageFilename.replace(/\.[^.]+$/, '');
    return downloadFile(ugoira.zipUrl, `${base}.zip`, [], {
      thumbUrl: info.urls.small || info.urls.regular || '',
      title: `${info.title} (Ugoira source)`,
      artist: info.artist,
      workId: info.id,
      pageIndex: 0
    }, {
      dirHandle: handle,
      companion: {
        filename: `${base}.frames.json`,
        type: 'application/json',
        text: JSON.stringify({ illustId: info.id, frames: ugoira.frames }, null, 2)
      }
    });
  }

  async function getAvailableFilename(dirHandle, filename) {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : '';
    for (let index = 1; index < 1000; index++) {
      const candidate = index === 1 ? filename : `${base} (${index})${ext}`;
      try {
        await dirHandle.getFileHandle(candidate);
      } catch (err) {
        if (err.name === 'NotFoundError') return candidate;
        throw err;
      }
    }
    return `${base} (${Date.now()})${ext}`;
  }

  async function writeFile(dirHandle, filename, blob, policy = 'skip') {
    const safeName = filename.replace(/[<>:"|?*]/g, '_');

    if (policy !== 'overwrite') {
      try {
        await dirHandle.getFileHandle(safeName);
        throw new Error(`File already exists: ${safeName}`);
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
      }
    }

    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => {});
      throw err;
    }
  }

  // --- Popup messages (getDirInfo, resetDir) ---

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getDirInfo') {
      (async () => {
        try {
          const handle = await getDirHandle(false);
          sendResponse({ name: handle ? handle.name : null });
        } catch {
          sendResponse({ name: null });
        }
      })();
      return true;
    }
    if (msg.type === 'resetDir') {
      dirHandle = null;
      dirHandleLoad = Promise.resolve(null);
      window.PixivPlusDownloadPanel?.setFolderName('not selected');
      openDB().then(db => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('downloadDir');
      }).catch(() => {});
      sendResponse({ ok: true });
    }
  });

  // --- Download icon on thumbnails ---

  function addDownloadIcon(card) {
    if (card.querySelector('.pp-download-btn')) return;
    const link = card.querySelector('a[href*="/artworks/"]')
              || (card.tagName === 'A' && card.href?.includes('/artworks/') ? card : null);
    if (!link) return;
    const workIdMatch = link.href.match(/\/artworks\/(\d+)/);
    if (!workIdMatch) return;

    const btn = document.createElement('button');
    btn.className = 'pp-download-btn';
    btn.title = 'Download original';
    btn.dataset.workId = workIdMatch[1];
    btn.dataset.state = 'idle';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      await downloadWork(workIdMatch[1]);
    });

    card.style.position = card.style.position || 'relative';
    card.appendChild(btn);
    if (completedWorkIds.has(workIdMatch[1])) updateThumbnailState(workIdMatch[1], 'complete');
  }

  function updateThumbnailState(workId, state, progress = 0) {
    if (!workId) return;
    if (state === 'complete') completedWorkIds.add(String(workId));
    document.querySelectorAll(`.pp-download-btn[data-work-id="${CSS.escape(String(workId))}"]`).forEach(btn => {
      btn.dataset.state = state;
      btn.style.setProperty('--pp-progress', `${Math.max(0, Math.min(100, progress)) * 3.6}deg`);
      btn.title = state === 'queued' ? 'Queued'
        : state === 'downloading' ? `Downloading ${progress}%`
        : state === 'complete' ? 'Downloaded'
        : state === 'error' ? 'Download failed — click to retry'
        : 'Download original';
    });
  }

  function markDownloadedWorks(workIds) {
    for (const workId of workIds) {
      completedWorkIds.add(String(workId));
      updateThumbnailState(workId, 'complete');
    }
  }

  // --- Multi-image selector ---

  let selectorHost = null;

  function showMultiImageSelector(info, preparedHandle = undefined) {
    if (!selectorHost) createSelectorPanel();
    const shadow = selectorHost.shadowRoot;
    const grid = shadow.getElementById('pp-selector-grid');
    const title = shadow.getElementById('pp-selector-title');
    const container = shadow.getElementById('pp-selector-container');

    title.textContent = `${info.artist} - ${info.title} (${info.pageCount} pages)`;
    grid.innerHTML = '';
    const checkboxes = [];
    const sizes = new Array(info.pageUrls.length).fill(0);
    let lastSelected = -1;

    const updateSummary = () => {
      const selected = checkboxes.filter(c => c.checked).map(c => Number.parseInt(c.dataset.index, 10));
      const bytes = selected.reduce((sum, index) => sum + (sizes[index] || 0), 0);
      const sizeLabel = bytes > 0 ? ` · ~${formatBytes(bytes)}` : '';
      shadow.getElementById('pp-selector-summary').textContent = `Selected ${selected.length}/${checkboxes.length}${sizeLabel}`;
    };

    for (let i = 0; i < info.pageUrls.length; i++) {
      const pageUrl = info.pageUrls[i];
      const item = document.createElement('div');
      item.className = 'pp-selector-item';
      const img = document.createElement('img');
      img.className = 'pp-selector-thumb';
      img.src = pageUrl.regular || pageUrl.original;
      img.loading = 'lazy';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'pp-selector-check';
      check.checked = true;
      check.dataset.index = i;
      checkboxes.push(check);
      const label = document.createElement('span');
      label.className = 'pp-selector-page-num';
      const ext = pageUrl.original.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() || '';
      label.textContent = `P${i} · ${ext}`;
      const detail = document.createElement('span');
      detail.className = 'pp-selector-detail';
      img.addEventListener('load', () => {
        detail.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
      });
      item.appendChild(img);
      item.appendChild(check);
      item.appendChild(label);
      item.appendChild(detail);
      item.addEventListener('click', (e) => {
        if (e.shiftKey && lastSelected >= 0) {
          const from = Math.min(lastSelected, i);
          const to = Math.max(lastSelected, i);
          const value = !check.checked;
          for (let index = from; index <= to; index++) checkboxes[index].checked = value;
        } else if (e.target !== check) {
          check.checked = !check.checked;
        }
        lastSelected = i;
        updateSummary();
      });
      check.addEventListener('change', () => { lastSelected = i; updateSummary(); });
      grid.appendChild(item);
    }

    shadow.getElementById('pp-btn-select-all').onclick = () => { checkboxes.forEach(c => c.checked = true); updateSummary(); };
    shadow.getElementById('pp-btn-select-first').onclick = () => { checkboxes.forEach((c, index) => c.checked = index === 0); updateSummary(); };
    shadow.getElementById('pp-btn-invert').onclick = () => { checkboxes.forEach(c => c.checked = !c.checked); updateSummary(); };
    shadow.getElementById('pp-btn-deselect-all').onclick = () => { checkboxes.forEach(c => c.checked = false); updateSummary(); };
    shadow.getElementById('pp-btn-download-selected').onclick = async () => {
      const selected = checkboxes.filter(c => c.checked).map(c => parseInt(c.dataset.index));
      if (selected.length === 0) return;
      const handle = preparedHandle === undefined ? await getDirHandle(true) : preparedHandle;
      if (!handle) return;
      queuePages(info, selected, handle);
      container.classList.remove('visible');
    };
    shadow.getElementById('pp-btn-cancel').onclick = () => container.classList.remove('visible');
    updateSummary();
    chrome.runtime.sendMessage({ type: 'estimateSizes', urls: info.pageUrls.map(page => page.original) }, response => {
      if (response?.sizes) response.sizes.forEach((size, index) => { sizes[index] = size; });
      updateSummary();
    });
    container.classList.add('visible');
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function createSelectorPanel() {
    selectorHost = document.createElement('div');
    selectorHost.id = 'pp-selector-host';
    selectorHost.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;';
    const shadow = selectorHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      #pp-selector-container {
        position:fixed;top:0;left:0;right:0;bottom:0;
        display:none;align-items:center;justify-content:center;
        pointer-events:auto;
        background:rgba(0,0,0,0.7);
        backdrop-filter:blur(4px);
        animation:pp-sel-in 0.2s cubic-bezier(0.16,1,0.3,1);
      }
      #pp-selector-container.visible { display:flex; }
      @keyframes pp-sel-in { from { opacity:0; } to { opacity:1; } }

      .pp-selector-panel {
        background:#0a0a0c;
        border-radius:16px;
        border:1px solid rgba(255,255,255,0.08);
        box-shadow:0 24px 80px rgba(0,0,0,0.6),0 0 1px rgba(255,255,255,0.1);
        padding:20px;
        max-width:80vw;max-height:80vh;
        display:flex;flex-direction:column;
        color:#cdd6f4;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        animation:pp-sel-panel-in 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      @keyframes pp-sel-panel-in {
        from { opacity:0;transform:scale(0.95) translateY(8px); }
        to { opacity:1;transform:scale(1) translateY(0); }
      }

      #pp-selector-title {
        font-size:14px;margin-bottom:14px;
        color:#8A8F98;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw;
      }
      #pp-selector-summary { color:#EDEDEF;font-size:13px;margin:-6px 0 12px; }
      .pp-selector-actions { display:flex;gap:8px;margin-bottom:14px; }
      .pp-selector-actions button {
        padding:6px 14px;
        background:transparent;
        border:1px solid rgba(255,255,255,0.08);
        color:#8A8F98;border-radius:8px;cursor:pointer;font-size:13px;
        transition:background 0.15s,color 0.15s;
      }
      .pp-selector-actions button:hover {
        background:rgba(255,255,255,0.08);color:#EDEDEF;
      }
      #pp-selector-grid {
        display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
        gap:10px;overflow-y:auto;max-height:55vh;padding:4px;
      }
      .pp-selector-item {
        position:relative;cursor:pointer;border-radius:8px;overflow:hidden;
        border:2px solid transparent;
        transition:border-color 0.15s;
      }
      .pp-selector-item:has(.pp-selector-check:checked) { border-color:#5E6AD2; }
      .pp-selector-thumb { width:100%;display:block;border-radius:6px;background:#111114; }
      .pp-selector-check {
        position:absolute;top:6px;left:6px;width:18px;height:18px;
        cursor:pointer;accent-color:#5E6AD2;
      }
      .pp-selector-page-num {
        position:absolute;bottom:6px;right:6px;
        background:rgba(0,0,0,0.7);color:#8A8F98;
        font-size:11px;padding:2px 6px;border-radius:4px;
      }
      .pp-selector-detail {
        position:absolute;bottom:6px;left:6px;
        background:rgba(0,0,0,0.7);color:#8A8F98;
        font-size:10px;padding:2px 6px;border-radius:4px;
      }
      .pp-selector-footer { display:flex;justify-content:flex-end;gap:8px;margin-top:16px; }
      .pp-selector-footer button {
        padding:8px 20px;border:none;border-radius:8px;cursor:pointer;
        font-size:14px;font-weight:500;
        transition:background 0.15s;
      }
      #pp-btn-cancel { background:rgba(255,255,255,0.06);color:#8A8F98; }
      #pp-btn-cancel:hover { background:rgba(255,255,255,0.1);color:#EDEDEF; }
      #pp-btn-download-selected { background:#5E6AD2;color:#fff; }
      #pp-btn-download-selected:hover { background:#4a58b8; }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.id = 'pp-selector-container';
    container.innerHTML = `
      <div class="pp-selector-panel">
        <div id="pp-selector-title"></div>
        <div id="pp-selector-summary"></div>
        <div class="pp-selector-actions">
          <button id="pp-btn-select-all">Select All</button>
          <button id="pp-btn-select-first">First Page</button>
          <button id="pp-btn-invert">Invert</button>
          <button id="pp-btn-deselect-all">Deselect All</button>
        </div>
        <div id="pp-selector-grid"></div>
        <div class="pp-selector-footer">
          <button id="pp-btn-cancel">Cancel</button>
          <button id="pp-btn-download-selected">Download Selected</button>
        </div>
      </div>
    `;
    shadow.appendChild(container);

    // Click backdrop to close
    container.addEventListener('click', (e) => {
      if (e.target === container) container.classList.remove('visible');
    });

    document.body.appendChild(selectorHost);
  }

  function cancelDownload(url) {
    const pendingIndex = pendingDownloads.findIndex(job => job.url === url);
    if (pendingIndex >= 0) {
      const [job] = pendingDownloads.splice(pendingIndex, 1);
      job.cancelled = true;
      reservedFilenames.delete(job.filename);
      window.PixivPlusDownloadPanel.updateDownload({ filename: job.filename, state: 'cancelled' });
      updateThumbnailState(job.meta.workId, 'idle');
      return;
    }

    activeDownloads.get(url)?.controller.abort();
  }

  function cancelAllDownloads() {
    for (const job of [...pendingDownloads]) cancelDownload(job.url);
    for (const job of [...activeDownloads.values()]) job.controller.abort();
  }

  function toggleQueuePaused(force) {
    queuePaused = typeof force === 'boolean' ? force : !queuePaused;
    if (!queuePaused) pumpDownloadQueue();
    return queuePaused;
  }

  function retryDownload(filename) {
    const job = failedDownloads.get(filename);
    if (!job) return false;
    failedDownloads.delete(filename);
    return downloadFile(job.url, job.filename, job.tags, job.meta, {
      dirHandle: job.dirHandle,
      duplicatePolicy: job.duplicatePolicy,
      companion: job.companion
    });
  }

  window.PixivPlusDownload = {
    downloadFile,
    downloadWork,
    addDownloadIcon,
    cancelDownload,
    cancelAllDownloads,
    toggleQueuePaused,
    retryDownload,
    downloadAllWork,
    downloadWorks,
    chooseDirectory,
    markDownloadedWorks
  };
})();
