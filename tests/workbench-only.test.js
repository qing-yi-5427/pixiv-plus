const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('the extension loads no legacy hover UI or thumbnail injection', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  assert.ok(scripts.includes('content/workbench.js'));
  assert.ok(!scripts.includes('content/hover-preview.js'));
  assert.ok(!manifest.content_scripts.flatMap(entry => entry.css || []).includes('content/style.css'));
  for (const file of [...scripts, 'popup/popup.js']) {
    assert.doesNotMatch(read(file), /PixivPlusHover|addDownloadIcon|markDownloadedWorks|updateThumbnailState|hoverPreview|hoverDelay|previewBehavior|workbenchEnabled|ppw-original\b/);
  }
});

test('content entry initializes the queue once without scanning native thumbnails', () => {
  let ready;
  let starts = 0;
  vm.runInNewContext(read('content/main.js'), {
    document: {
      readyState: 'loading',
      addEventListener(name, fn) { assert.equal(name, 'DOMContentLoaded'); ready = fn; },
      querySelectorAll() { assert.fail('Native thumbnail scanning must not return'); }
    },
    window: { PixivPlusDownloadPanel: { init() { starts++; } } }
  });
  assert.equal(starts, 0);
  ready();
  ready();
  assert.equal(starts, 1);
});
