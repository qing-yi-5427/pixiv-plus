const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workbench = fs.readFileSync(path.join(__dirname, '..', 'content', 'workbench.js'), 'utf8');
const preview = fs.readFileSync(path.join(__dirname, '..', 'content', 'hover-preview.js'), 'utf8');

test('all PixivPlus bookmark controls stay in-page', () => {
  for (const source of [workbench, preview]) {
    assert.match(source, /PixivPlusAPI\.bookmarkWork\(currentWorkId\)/);
    assert.match(source, /PixivPlusAPI\.unbookmarkWork\(currentWorkId, currentInfo\.bookmarkId\)/);
    assert.doesNotMatch(source, /bookmark_add\.php/);
  }
});
