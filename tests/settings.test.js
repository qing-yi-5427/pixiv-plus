const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/settings.js');

test('settings retain zero delay and false switches without overwriting unrelated data', () => {
  assert.deepEqual(S.validatePatch({hoverDelay: 0, hoverPreview: false, readWorks: ['42'], type: 'saveSettings'}), {hoverDelay: 0, hoverPreview: false});
  assert.equal(S.normalize({hoverDelay: 0}).hoverDelay, 0);
  assert.equal(S.normalize({downloadConcurrency: 100}).downloadConcurrency, 3);
});

test('invalid settings reject rather than coercing strings, unknown values or unsafe filenames', () => {
  for (const patch of [{hoverPreview: 'false'}, {hoverDelay: -1}, {downloadConcurrency: 1.5}, {duplicatePolicy: 'delete'}, {filenameTemplate: '../{title}'}, {filenameTemplate: '{unknown}'}, {filenameTemplate: ''}]) {
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
  listener({type: 'saveSettings', hoverDelay: 0}, {}, response => responses.push(response));
  listener({type: 'saveSettings', hoverDelay: 50}, {}, response => responses.push(response));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(responses.length, 0);
  writes[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses[0].ok, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].patch.hoverDelay, 0);
  assert.equal(writes[1].patch.hoverDelay, 50);
  context.chrome.runtime.lastError = {message: 'Storage unavailable'};
  writes[1].callback();
  assert.equal(responses[1].error, 'Storage unavailable');
});
