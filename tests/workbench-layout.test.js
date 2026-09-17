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

test('artwork metadata follows the rendered image without reserving a fixed rail', () => {
  assert.match(source, /\.ppw-details \{[\s\S]*?position:absolute[\s\S]*?backdrop-filter:blur\(18px\)/);
  assert.doesNotMatch(source, /\.ppw-shell\[data-image-orientation="portrait"\] \.ppw-stage \{ padding-right:/);
  assert.match(source, /function positionInfoIsland\(\)/);
  assert.match(source, /const rightSpace = stageRect\.right - imageRect\.right/);
  assert.match(source, /details\.dataset\.placement = 'side'/);
  assert.match(source, /details\.dataset\.placement = 'bottom'/);
  assert.match(source, /const fitsBelow = belowTop \+ height <= stageRect\.height - 44/);
  assert.match(source, /className = `ppw-tag\$\{index >= 2 \? ' extra' : ''\}`/);
  assert.match(source, /\.ppw-shortcuts \{[^}]*padding:0 420px 0 15px/);
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

test('workbench exposes feed pagination and a visible return launcher', () => {
  assert.match(source, /id="ppw-feed-prev"/);
  assert.match(source, /id="ppw-feed-page" type="text" inputmode="numeric"/);
  assert.match(source, /id="ppw-feed-next"/);
  assert.match(source, /function navigateFeedPage\(page\)[\s\S]*?location\.assign\(url\.href\)/);
  assert.match(source, /\.ppw-launcher \{[^}]*top:74px[^}]*pointer-events:auto/);
  assert.match(source, /launcher\.hidden = false/);
  assert.match(source, /\.ppw-feed-page-input \{[^}]*padding:0[^}]*text-align:center[^}]*line-height:30px/);
});

test('workbench bookmarks through Pixiv AJAX helpers and never opens the legacy form', () => {
  assert.match(source, /const nativeButton = nativeBookmarkButton\(currentWorkId\)/);
  assert.match(source, /if \(nativeButton\) \{[\s\S]*?nativeButton\.click\(\)/);
  assert.match(source, /PixivPlusAPI\.bookmarkWork\(currentWorkId\)/);
  assert.match(source, /PixivPlusAPI\.unbookmarkWork\(currentWorkId, currentInfo\.bookmarkId\)/);
  assert.doesNotMatch(source, /bookmark_add\.php/);
});

test('read state persists by artwork id and page counts only loaded unread works', () => {
  assert.match(source, /const SEEN_WORKS_STORAGE_KEY = 'workbenchSeenWorkIds'/);
  assert.match(source, /chrome\.storage\.local\.set\(\{ \[SEEN_WORKS_STORAGE_KEY\]: \[\.\.\.seenWorkIds\] \}\)/);
  assert.match(source, /replaceSeenWorkIds\(settings\[SEEN_WORKS_STORAGE_KEY\]\)/);
  assert.match(source, /if \(!seenWorkIds\.has\(record\.id\)\) button\.append\(createUnreadMarker\(\)\)/);
  assert.match(source, /store\.all\(\)\.filter\(record => !seenWorkIds\.has\(record\.id\)\)\.length/);
});
