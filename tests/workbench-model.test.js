const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'workbench-model.js'),
  'utf8'
);

function loadModel() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PixivPlusWorkbenchModel;
}

test('workbench extracts artwork ids only from valid artwork links', () => {
  const model = loadModel();
  assert.equal(model.extractWorkId('https://www.pixiv.net/artworks/123456'), '123456');
  assert.equal(model.extractWorkId('/users/123456'), null);
  assert.equal(model.extractWorkId(null), null);
});

test('workbench store preserves discovery order and enriches records', () => {
  const model = loadModel();
  const store = model.createStore();
  const first = store.merge([
    { id: '20', title: 'Twenty', thumbUrl: '20.jpg' },
    { id: '10', title: 'Ten', thumbUrl: '10.jpg' },
    { id: '20', artist: 'Artist' }
  ]);
  store.update('20', { pageCount: 4, isUgoira: false, loaded: true });

  assert.deepEqual(JSON.parse(JSON.stringify(first.added.map(item => item.id))), ['20', '10']);
  assert.deepEqual(JSON.parse(JSON.stringify(store.all().map(item => item.id))), ['20', '10']);
  assert.equal(store.get('20').artist, 'Artist');
  assert.equal(store.get('20').pageCount, 4);
  assert.equal(store.indexOf('10'), 1);
});
