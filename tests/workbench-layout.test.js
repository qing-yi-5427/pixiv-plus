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

test('thumbnail rows keep a square intrinsic size instead of collapsing into the viewport', () => {
  const feedRule = source.match(/\.ppw-feed \{([^}]*)\}/)?.[1] || '';
  const thumbnailRule = source.match(/\.ppw-thumb \{([^}]*)\}/)?.[1] || '';
  const thumbnailImageRule = source.match(/\.ppw-thumb img \{([^}]*)\}/)?.[1] || '';
  assert.match(feedRule, /display:flex/);
  assert.match(feedRule, /flex-wrap:wrap/);
  assert.match(feedRule, /align-content:flex-start/);
  assert.match(thumbnailRule, /flex:0 0 calc\(50% - 4px\)/);
  assert.match(thumbnailRule, /aspect-ratio:1\/1/);
  assert.match(thumbnailRule, /height:auto/);
  assert.doesNotMatch(thumbnailRule, /content-visibility/);
  assert.match(source, /\.ppw-shell\[data-density="compact"\] \.ppw-thumb \{[^}]*flex-basis:calc\(33\.333333% - 5\.333334px\)/);
  assert.match(source, /\.ppw-shell\[data-density="filmstrip"\] \.ppw-thumb \{[^}]*flex-basis:100%/);
  assert.match(thumbnailImageRule, /width:100%/);
  assert.match(thumbnailImageRule, /height:auto/);
  assert.match(thumbnailImageRule, /aspect-ratio:1\/1/);
  assert.doesNotMatch(thumbnailImageRule, /position:absolute/);
});
