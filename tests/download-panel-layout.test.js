const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'download-panel.js'),
  'utf8'
);

test('download center uses the workbench visual tokens and docks into the shortcut bar', () => {
  assert.match(source, /--pp-panel-bottom:18px/);
  assert.match(source, /:host\(\[data-workbench="true"\]\) \{ --pp-panel-bottom:0px; \}/);
  assert.match(source, /bottom:var\(--pp-panel-bottom\);right:16px;width:min\(316px,calc\(100vw - 24px\)\)/);
  assert.match(source, /:host\(\[data-workbench="true"\]\) \.pp-panel,[\s\S]*?height:31px;max-height:31px/);
  assert.match(source, /class="pp-panel-inline" aria-live="polite"/);
  assert.match(source, /function updateInlineProgress\(shadow, body\)/);
  assert.match(source, /--pp-blue:#0096fa/);
  assert.match(source, /@media \(prefers-color-scheme:dark\)/);
});

test('download center renders artwork thumbnails and accepts workbench state changes', () => {
  assert.match(source, /class="pp-download-thumb" hidden/);
  assert.match(source, /function syncItemThumbnail\(item, data\)/);
  assert.match(source, /function setWorkbenchActive\(active\)/);
  assert.match(source, /setWorkbenchActive\n\s*\};/);
});
