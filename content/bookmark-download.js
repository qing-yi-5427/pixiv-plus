// PixivPlus - Download Module
// Handles image downloading: background fetches, content script writes to file system

(() => {
  'use strict';

  let dirHandle = null;
  let dirHandleLoad = null;
  const pendingDownloads = [];
  const activeDownloads = new Map(); // job id -> job
  const reservations = new Map(); // job id -> directory and reserved names
  let allocationQueue = Promise.resolve();
  let downloadEpoch = 0;
  const producers = new Set();
  const failedDownloads = new Map(); // job id -> job
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
    if (changes.downloadDirectoryResetAt || changes.downloadDirectoryChangedAt) {
      dirHandleLoad = Promise.resolve(dirHandleLoad).then(async () => {
        dirHandle = await loadDirHandle();
        window.PixivPlusDownloadPanel?.setFolderName(dirHandle?.name || 'not selected');
        return dirHandle;
      });
    }
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
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function loadDirHandle() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('downloadDir');
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); resolve(null); };
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
      await new Promise((resolve, reject) => chrome.storage.local.set({ downloadDirectoryChangedAt: crypto.randomUUID() }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
      }));
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
      await new Promise((resolve, reject) => chrome.storage.local.set({ downloadDirectoryChangedAt: crypto.randomUUID() }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
      }));
      window.PixivPlusDownloadPanel?.setFolderName(handle.name);
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

  function checkCancelled(signal, epoch = downloadEpoch) {
    if (signal?.aborted || epoch !== downloadEpoch) throw new DOMException('Cancelled', 'AbortError');
  }

  async function produce(task) {
    const controller = new AbortController();
    const epoch = downloadEpoch;
    producers.add(controller);
    try { return await task(controller.signal, epoch); }
    catch (error) {
      if (error.name !== 'AbortError') window.PixivPlusDownloadPanel?.showToast(error.message, 'error');
      return false;
    } finally { producers.delete(controller); }
  }

  async function fileExists(handle, name) {
    try { await handle.getFileHandle(name); return true; }
    catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
  }

  async function namesReserved(handle, names, owner) {
    for (const [id, reservation] of reservations) {
      if (id === owner || !names.some(name => reservation.names.includes(name))) continue;
      if (reservation.handle === handle || await handle.isSameEntry(reservation.handle)) return true;
    }
    return false;
  }

  function reserveNames(handle, filename, companion, policy, id, signal, epoch, resume = false) {
    const result = allocationQueue.catch(() => {}).then(async () => {
      const dot = filename.lastIndexOf('.');
      const base = dot > 0 ? filename.slice(0, dot) : filename;
      const extension = dot > 0 ? filename.slice(dot) : '';
      for (let number = 1; number <= 10000; number++) {
        checkCancelled(signal, epoch);
        const stem = number === 1 ? base : base + ' (' + number + ')';
        const main = stem + extension;
        const sidecar = companion ? { ...companion, filename: stem + '.frames.json' } : null;
        const names = [main, ...(sidecar ? [sidecar.filename] : [])];
        const busy = await namesReserved(handle, names, id);
        const exists = (await Promise.all(names.map(name => fileExists(handle, name)))).some(Boolean);
        checkCancelled(signal, epoch);
        if (busy || (exists && policy !== 'overwrite' && !resume)) {
          if (policy === 'rename' && !resume) continue;
          return null;
        }
        reservations.set(id, { handle, names });
        return { filename: main, companion: sidecar };
      }
      throw new Error('Could not allocate a unique filename');
    });
    allocationQueue = result.catch(() => {});
    return result;
  }

  async function downloadFile(url, filename, tags, meta, options = {}) {
    const epoch = options.epoch ?? downloadEpoch;
    const panel = window.PixivPlusDownloadPanel;
    const id = options.id || crypto.randomUUID();
    const controller = new AbortController();
    const policy = options.duplicatePolicy || duplicatePolicy;
    try {
      checkCancelled(options.signal, epoch);
      const handle = Object.hasOwn(options, 'dirHandle') ? options.dirHandle : await getDirHandle(options.promptForDir !== false);
      checkCancelled(options.signal, epoch);
      if (!handle) { panel?.showToast('Choose a download folder before downloading', 'warning'); return false; }
      const allocated = await reserveNames(handle, filename, options.companion, policy, id, options.signal, epoch, Boolean(options.resumeFiles?.length));
      if (!allocated) { panel?.showToast('File exists or is already queued: ' + filename, 'warning'); return false; }
      const job = {
        id, url, requestedFilename: filename, ...allocated, tags, meta: meta || {},
        dirHandle: handle, duplicatePolicy: policy, controller, epoch,
        completedFiles: options.resumeFiles || [], cancelled: false
      };
      pendingDownloads.push(job);
      panel.updateDownload({
        id, filename: job.filename, state: 'queued', bytesReceived: 0, totalBytes: 0,
        speed: 'Queued', url, ...job.meta
      });
      pumpDownloadQueue();
      return true;
    } catch (error) {
      reservations.delete(id);
      if (error.name !== 'AbortError') panel?.showToast(error.message, 'error');
      return false;
    }
  }

  function pumpDownloadQueue() {
    if (queuePaused) return;
    while (runningDownloads < maxConcurrentDownloads && pendingDownloads.length > 0) {
      const job = pendingDownloads.shift();
      if (job.cancelled) continue;
      runningDownloads++;
      activeDownloads.set(job.id, job);
      runDownload(job).finally(() => {
        activeDownloads.delete(job.id);
        reservations.delete(job.id);
        runningDownloads--;
        pumpDownloadQueue();
      });
    }
  }

  async function runDownload(job) {
    const { url, tags, meta, dirHandle: handle, controller } = job;
    const panel = window.PixivPlusDownloadPanel;
    const update = fields => panel.updateDownload({ id: job.id, filename: job.filename, ...fields });
    update({ state: 'in_progress', bytesReceived: 0, totalBytes: 0, speed: 'Connecting...', url, ...meta });
    try {
      const blob = await fetchImageStream(url, controller.signal, progress => {
        update({ state: 'in_progress', bytesReceived: progress.received, totalBytes: progress.total, speed: progress.speed, url });
      });
      checkCancelled(controller.signal, job.epoch);
      const embedTags = await new Promise((resolve, reject) => chrome.storage.local.get({ embedTags: true }, settings => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(settings.embedTags);
      }));
      checkCancelled(controller.signal, job.epoch);
      const output = embedTags && tags?.length ? await injectTags(blob, tags) : blob;
      checkCancelled(controller.signal, job.epoch);
      const commit = async () => {
        const allocated = await reserveNames(handle, job.completedFiles.length ? job.filename : job.requestedFilename,
          job.companion, job.duplicatePolicy, job.id, controller.signal, job.epoch, job.completedFiles.length > 0);
        if (!allocated) throw new Error('File exists; nothing was overwritten');
        Object.assign(job, allocated);
        const files = [{ name: job.filename, blob: output }];
        if (job.companion) files.push({ name: job.companion.filename, blob: new Blob([job.companion.text], { type: 'application/json' }) });
        update({ state: 'in_progress', speed: 'Saving...' });
        await writeFiles(handle, files, job);
      };
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('pixivplus-file-commit', { signal: controller.signal }, commit);
      } else await commit();
      update({ state: 'complete' });
      failedDownloads.delete(job.id);
    } catch (error) {
      // Once close() starts, commit is not cancellable. Partial failures retain
      // fingerprints, allowing retry without overwriting changed files.
      if (!job.committing && (controller.signal.aborted || error.name === 'AbortError')) {
        update({ state: 'cancelled' });
      } else {
        failedDownloads.set(job.id, { ...job, controller: null, committing: false });
        const partial = job.completedFiles.length ? 'Partial save: ' + job.completedFiles.map(file => file.name).join(', ') + ' — ' : '';
        update({ state: 'interrupted', error: partial + error.message });
      }
    }
  }

  function fetchImageStream(url, signal, onProgress) {
    checkCancelled(signal);
    return window.PixivPlusOriginalCache.get(url, { signal, onProgress });
  }

  async function downloadWork(workId) {
    return produce(async (signal, epoch) => {
      const handle = await getDirHandle(true);
      if (!handle) return false;
      checkCancelled(signal, epoch);
      const info = await window.PixivPlusAPI.getWorkInfo(workId, { signal, priority: 'foreground' });
      checkCancelled(signal, epoch);
      if (info.isUgoira) return downloadUgoiraWork(info, handle, signal, epoch);
      if (info.pageCount > 1 && multiDownloadDefault === 'ask') {
        showMultiImageSelector(info);
        return true;
      }
      return queuePages(info, info.pageUrls.map((_, index) => index), handle, signal, epoch);
    });
  }

  async function queuePages(info, indices, handle, signal, epoch = downloadEpoch) {
    for (const index of indices) {
      checkCancelled(signal, epoch);
      const url = info.pageUrls[index]?.original;
      if (!url) continue;
      await downloadFile(url, window.PixivPlusAPI.generateFilename(info, index), info.tags, {
        thumbUrl: info.pageUrls[index]?.regular || info.urls.small || info.urls.regular || '',
        title: info.title, artist: info.artist, workId: info.id, pageIndex: index
      }, { dirHandle: handle, signal, epoch });
    }
  }

  async function downloadAllWork(info) {
    if (!info) return;
    return produce(async (signal, epoch) => {
      const handle = await getDirHandle(true);
      if (!handle) return false;
      checkCancelled(signal, epoch);
      if (info.isUgoira) return downloadUgoiraWork(info, handle, signal, epoch);
      return queuePages(info, info.pageUrls.map((_, index) => index), handle, signal, epoch);
    });
  }

  async function downloadWorks(workIds) {
    const ids = [...new Set((workIds || []).map(String).filter(id => /^\d+$/.test(id)))];
    if (!ids.length) return;
    return produce(async (signal, epoch) => {
      const handle = await getDirHandle(true);
      if (!handle) return false;
      for (const id of ids) {
        checkCancelled(signal, epoch);
        try {
          const info = await window.PixivPlusAPI.getWorkInfo(id, { signal });
          checkCancelled(signal, epoch);
          if (info.isUgoira) await downloadUgoiraWork(info, handle, signal, epoch);
          else await queuePages(info, info.pageUrls.map((_, index) => index), handle, signal, epoch);
        } catch (error) {
          checkCancelled(signal, epoch);
          window.PixivPlusDownloadPanel.showToast(error.message, 'error');
        }
      }
    });
  }

  async function downloadUgoiraWork(info, handle, signal, epoch) {
    const ugoira = await window.PixivPlusAPI.getUgoiraMeta(info.id, { signal });
    checkCancelled(signal, epoch);
    if (!ugoira.zipUrl) throw new Error('Ugoira ZIP unavailable');
    const base = window.PixivPlusAPI.generateFilename(info, 0).replace(/\.[^.]+$/, '');
    return downloadFile(ugoira.zipUrl, base + '.zip', [], {
      thumbUrl: info.urls.small || info.urls.regular || '', title: info.title,
      artist: info.artist, workId: info.id, pageIndex: 0
    }, { dirHandle: handle, signal, epoch,
      companion: { filename: base + '.frames.json', text: JSON.stringify({ illustId: info.id, frames: ugoira.frames }, null, 2) }
    });
  }

  async function writeFiles(handle, files, job) {
    const staged = [];
    try {
      for (const file of files) {
        checkCancelled(job.controller.signal, job.epoch);
        const completed = job.completedFiles.find(item => item.name === file.name);
        if (completed) {
          const actual = await (await handle.getFileHandle(file.name)).getFile();
          if (actual.size !== completed.size || actual.lastModified !== completed.lastModified) {
            throw new Error('Previously saved file changed; retry stopped: ' + file.name);
          }
          continue;
        }
        const exists = await fileExists(handle, file.name);
        if (exists && job.duplicatePolicy !== 'overwrite') throw new Error('File already exists: ' + file.name);
        checkCancelled(job.controller.signal, job.epoch);
        const fileHandle = await handle.getFileHandle(file.name, { create: true });
        const entry = { name: file.name, fileHandle, stream: null, created: !exists, closed: false };
        staged.push(entry);
        checkCancelled(job.controller.signal, job.epoch);
        entry.stream = await fileHandle.createWritable();
        entry.abort = () => { if (!job.committing) entry.stream.abort().catch(() => {}); };
        job.controller.signal.addEventListener('abort', entry.abort, { once: true });
        checkCancelled(job.controller.signal, job.epoch);
        await entry.stream.write(file.blob);
        checkCancelled(job.controller.signal, job.epoch);
      }
      checkCancelled(job.controller.signal, job.epoch);
      // All staging is cancellable. close() is the filesystem commit point;
      // do not promise cancellation after this point or abort half of a pair.
      job.committing = true;
      window.PixivPlusDownloadPanel.updateDownload({ id: job.id, filename: job.filename, state: 'in_progress', speed: 'Saving...', committing: true });
      for (const entry of staged) {
        await entry.stream.close();
        entry.closed = true;
        const saved = await entry.fileHandle.getFile();
        job.completedFiles.push({ name: entry.name, size: saved.size, lastModified: saved.lastModified });
      }
    } finally {
      for (const entry of staged) {
        if (entry.abort) job.controller.signal.removeEventListener('abort', entry.abort);
        if (entry.closed) continue;
        await entry.stream?.abort().catch(() => {});
        // Only remove an empty placeholder this job created, never an existing file.
        if (entry.created) {
          const file = await entry.fileHandle.getFile().catch(() => null);
          if (file?.size === 0) await handle.removeEntry(entry.name).catch(() => {});
        }
      }
    }
  }

  // --- Popup messages (getDirInfo, resetDir) ---

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getDirInfo') {
      (async () => {
        try {
          await dirHandleLoad;
          const permission = dirHandle ? await dirHandle.queryPermission({ mode: 'readwrite' }) : null;
          sendResponse({ name: dirHandle?.name || null, permission });
        } catch {
          sendResponse({ error: 'Directory information unavailable' });
        }
      })();
      return true;
    }
    if (msg.type === 'resetDir') {
      openDB().then(db => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('downloadDir');
        tx.oncomplete = () => {
          db.close();
          dirHandle = null;
          dirHandleLoad = Promise.resolve(null);
          window.PixivPlusDownloadPanel?.setFolderName('not selected');
          chrome.storage.local.set({ downloadDirectoryResetAt: Date.now() }, () => {
            const error = chrome.runtime.lastError;
            sendResponse(error ? { error: error.message } : { ok: true });
          });
        };
        tx.onabort = () => { db.close(); sendResponse({ error: 'Directory reset failed' }); };
      }).catch(() => sendResponse({ error: 'Directory storage unavailable' }));
      return true;
    }
  });

  // --- Multi-image selector ---

  let selectorHost = null;
  let selectorClose = null;

  function showMultiImageSelector(info, preparedHandle = undefined) {
    selectorClose?.();
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
      shadow.getElementById('pp-selector-summary').textContent = (window.PixivPlusUI?.t('Selected') || 'Selected') + ` ${selected.length}/${checkboxes.length}${sizeLabel}`;
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
      check.setAttribute('aria-label', `P${i + 1}`);
      checkboxes.push(check);
      const label = document.createElement('span');
      label.className = 'pp-selector-page-num';
      const ext = pageUrl.original.match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() || '';
      label.textContent = `P${i + 1} · ${ext}`;
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
    shadow.getElementById('pp-btn-download-selected').onclick = () => produce(async (signal, epoch) => {
      const selected = checkboxes.filter(c => c.checked).map(c => parseInt(c.dataset.index));
      if (selected.length === 0) return;
      const handle = preparedHandle === undefined ? await getDirHandle(true) : preparedHandle;
      if (!handle) return;
      checkCancelled(signal, epoch);
      await queuePages(info, selected, handle, signal, epoch);
      selectorClose?.();
    });
    shadow.getElementById('pp-btn-cancel').onclick = () => selectorClose?.();
    updateSummary();
    chrome.runtime.sendMessage({ type: 'estimateSizes', urls: info.pageUrls.map(page => page.original) }, response => {
      if (response?.sizes) response.sizes.forEach((size, index) => { sizes[index] = size; });
      updateSummary();
    });
    container.classList.add('visible');
    container.setAttribute('aria-labelledby', 'pp-selector-title');
    window.PixivPlusUI?.localize(shadow);
    selectorClose = window.PixivPlusUI?.openDialog(container, () => { container.classList.remove('visible'); selectorClose = null; });
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
      if (e.target === container) selectorClose?.();
    });

    document.body.appendChild(selectorHost);
  }

  function cancelDownload(id) {
    const index = pendingDownloads.findIndex(job => job.id === id);
    if (index >= 0) {
      const [job] = pendingDownloads.splice(index, 1);
      job.controller.abort();
      reservations.delete(job.id);
      window.PixivPlusDownloadPanel.updateDownload({ id: job.id, filename: job.filename, state: 'cancelled' });
      return;
    }
    const job = activeDownloads.get(id);
    if (job && !job.committing) job.controller.abort();
  }

  function cancelAllDownloads() {
    downloadEpoch++;
    for (const controller of producers) controller.abort();
    for (const job of [...pendingDownloads]) cancelDownload(job.id);
    for (const job of activeDownloads.values()) if (!job.committing) job.controller.abort();
    selectorClose?.();
  }

  function toggleQueuePaused(force) {
    queuePaused = typeof force === 'boolean' ? force : !queuePaused;
    if (!queuePaused) pumpDownloadQueue();
    return queuePaused;
  }

  async function retryDownload(id) {
    const job = failedDownloads.get(id);
    if (!job) return false;
    const accepted = await downloadFile(job.url, job.filename, job.tags, job.meta, {
      id, dirHandle: job.dirHandle, duplicatePolicy: job.duplicatePolicy,
      companion: job.companion, resumeFiles: job.completedFiles
    });
    if (accepted) failedDownloads.delete(id);
    return accepted;
  }

  window.PixivPlusDownload = {
    isDialogOpen: () => Boolean(selectorHost?.shadowRoot?.getElementById('pp-selector-container')?.classList.contains('visible')),
    downloadFile,
    downloadWork,
    cancelDownload,
    cancelAllDownloads,
    toggleQueuePaused,
    retryDownload,
    downloadAllWork,
    downloadWorks,
    chooseDirectory
  };
})();
