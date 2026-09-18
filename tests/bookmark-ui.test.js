const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workbench = fs.readFileSync(path.join(__dirname, '..', 'content', 'workbench.js'), 'utf8');

test('all PixivPlus bookmark controls stay in-page', () => {
  assert.match(workbench, /PixivPlusAPI\.bookmarkWork\(currentWorkId\)/);
  assert.match(workbench, /PixivPlusAPI\.unbookmarkWork\(currentWorkId, currentInfo\.bookmarkId\)/);
  assert.doesNotMatch(workbench, /bookmark_add\.php/);
});
