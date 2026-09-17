const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'workbench.js'),
  'utf8'
);

test('workbench constrains the grid row so the feed scrolls and preview stays visible', () => {
  assert.match(source, /\.ppw-body \{[^}]*overflow:hidden[^}]*grid-template-rows:minmax\(0,1fr\)/);
  assert.match(source, /\.ppw-browser \{[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(source, /\.ppw-feed \{[^}]*overflow:auto/);
  assert.match(source, /\.ppw-stage \{[^}]*min-height:0/);
});
