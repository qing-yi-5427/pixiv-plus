const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'bookmark-download.js'),
  'utf8'
);

test('cancelling folder selection never falls back to a browser download', () => {
  const downloadFile = source.match(/async function downloadFile[\s\S]*?\n  function pumpDownloadQueue/)?.[0] || '';
  assert.match(downloadFile, /if \(!handle\) \{[\s\S]*?return false;/);
  assert.doesNotMatch(source, /function browserDownload/);
  assert.doesNotMatch(source, /\.download\s*=\s*filename/);
  assert.doesNotMatch(source, /browser default/);
  assert.ok((source.match(/if \(!handle\) return false;/g) || []).length >= 4);
});
