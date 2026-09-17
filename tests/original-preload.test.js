const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const workbench = read('content/workbench.js');
const popupHtml = read('popup/popup.html');
const popupJs = read('popup/popup.js');
const worker = read('background/service-worker.js');

test('workbench can preload every discovered artwork original with bounded concurrency', () => {
  assert.match(workbench, /id="ppw-load-originals"/);
  assert.match(workbench, /function preloadCurrentPageOriginals\(manual\)/);
  assert.match(workbench, /getWorkInfoCached\(record\.id\)/);
  assert.match(workbench, /info\.pageUrls\?\.\[0\]\?\.original/);
  assert.match(workbench, /Math\.min\(3, total\)/);
  assert.match(workbench, /preloadedOriginalUrls\.add\(url\)/);
  assert.match(workbench, /originalUrl && \(originalMode \|\| preloadedOriginalUrls\.has\(originalUrl\)\)/);
});

test('automatic original preload preference is exposed and persisted', () => {
  assert.match(popupHtml, /id="workbench-preload-originals"/);
  assert.match(popupJs, /workbenchPreloadOriginals: document\.getElementById\('workbench-preload-originals'\)/);
  assert.match(popupJs, /workbenchPreloadOriginals: fields\.workbenchPreloadOriginals\.checked/);
  assert.match(worker, /workbenchPreloadOriginals: false/);
  assert.match(worker, /toSave\.workbenchPreloadOriginals = msg\.workbenchPreloadOriginals/);
  assert.match(workbench, /if \(preloadOriginalsByDefault \|\| originalMode\) scheduleAutoOriginalPreload\(\)/);
});
