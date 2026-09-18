const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const workbench = read('content/workbench.js');
const popupJs = read('popup/popup.js');
const settings = require('../lib/settings.js');

test('workbench can preload every discovered artwork original with bounded concurrency', () => {
  assert.match(workbench, /id="ppw-load-originals"/);
  assert.match(workbench, /function preloadCurrentPageOriginals\(manual\)/);
  assert.match(workbench, /getWorkInfoCached\(record\.id, signal\)/);
  assert.match(workbench, /info\.pageUrls\?\.\[0\]\?\.original/);
  assert.match(workbench, /Math\.min\(3, total\)/);
  assert.match(workbench, /preloadedOriginalWorkIds\.add\(record\.id\)/);
  assert.match(workbench, /originalUrl && originalMode/);
});

test('automatic original preload preference is exposed and persisted', () => {
  assert.match(popupJs, /toggle\('workbenchPreloadOriginals'/);
  assert.equal(settings.defaults.workbenchPreloadOriginals, false);
  assert.deepEqual(settings.validatePatch({workbenchPreloadOriginals: true}), {workbenchPreloadOriginals: true});
  assert.match(workbench, /if \(preloadOriginalsByDefault \|\| manualPreloadRequested\) scheduleAutoOriginalPreload\(\)/);
});
