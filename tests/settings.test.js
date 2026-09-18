const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/settings.js');

test('settings retain false switches without overwriting unrelated data', () => {
  assert.deepEqual(S.validatePatch({workbenchPreloadOriginals: false, workbenchLeftWidth: 240, readWorks: ['42'], type: 'saveSettings'}), {workbenchPreloadOriginals: false, workbenchLeftWidth: 240});
  assert.equal(S.normalize({workbenchPreloadOriginals: false}).workbenchPreloadOriginals, false);
  assert.equal(S.normalize({downloadConcurrency: 100}).downloadConcurrency, 3);
});

test('legacy native-page and hover settings cannot disable or configure the workbench', () => {
  const legacy = {workbenchEnabled: false, hoverPreview: true, hoverDelay: 0, previewBehavior: 'immersive'};
  assert.deepEqual(S.validatePatch(legacy), {});
  assert.deepEqual(S.normalize(legacy), S.defaults);
});

test('invalid settings reject rather than coercing strings, unknown values or unsafe filenames', () => {
  for (const patch of [{embedTags: 'false'}, {workbenchLeftWidth: 0}, {downloadConcurrency: 1.5}, {duplicatePolicy: 'delete'}, {filenameTemplate: '../{title}'}, {filenameTemplate: '{unknown}'}, {filenameTemplate: ''}]) {
    assert.throws(() => S.validatePatch(patch));
  }
  assert.equal(S.templateError('{artist}-{id}{page}'), null);
});

test('background acknowledges writes only after storage completes and propagates failures', async () => {
  let listener;
  const writes = [];
  const context = {
    chrome: {
      runtime: {onMessage: {addListener: fn => { listener = fn; }}, onConnect: {addListener() {}}},
      storage: {local: {set: (patch, callback) => writes.push({patch, callback})}}
    }
  };
  vm.createContext(context);
  context.importScripts = () => vm.runInContext(fs.readFileSync(require.resolve('../lib/settings.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../background/service-worker.js'), 'utf8'), context);
  const responses = [];
  listener({type: 'saveSettings', downloadConcurrency: 1}, {}, response => responses.push(response));
  listener({type: 'saveSettings', downloadConcurrency: 4}, {}, response => responses.push(response));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(responses.length, 0);
  writes[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses[0].ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].patch.downloadConcurrency, 1);
  assert.equal(writes[1].patch.downloadConcurrency, 4);
  context.chrome.runtime.lastError = {message: 'Storage unavailable'};
  writes[1].callback();
  assert.equal(responses[1].error, 'Storage unavailable');
});
