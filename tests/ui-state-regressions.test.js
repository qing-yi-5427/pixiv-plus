const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require.resolve('../' + name), 'utf8');

function settingsView() {
  const callbacks = [];
  const context = { window: {}, URLSearchParams, location: { pathname: '/settings.html', search: '' },
    document: { documentElement: {}, body: { classList: { toggle() {} } }, getElementById: () => null },
    chrome: { i18n: { getUILanguage: () => 'en' }, runtime: { sendMessage: (message, callback) => callbacks.push(callback) } } };
  vm.createContext(context); vm.runInContext(read('lib/settings.js'), context);
  const hooks = `
    settings = {...S.defaults}; status = {dataset:{}};
    filenameInput = {getAttribute:()=> 'false'}; updateSamples = () => {};
    const input = {type:'select',value:'3'};
    controls.set('downloadConcurrency',{inputs:[input],read:()=>Number(input.value)});
    window.review = {save,onSettingsChanged,input,status,get settings(){return settings;}};
    false && init().catch(() => {
  `;
  vm.runInContext(read('popup/popup.js').replace('  init().catch(() => {', hooks), context);
  return { callbacks, ...context.window.review, get current() { return context.window.review.settings; } };
}

test('a delayed save acknowledgement cannot overwrite a newer cross-view setting', async () => {
  const view = settingsView();
  const save = view.save({ downloadConcurrency: 4 });
  view.onSettingsChanged({ downloadConcurrency: { newValue: 4 } }, 'local');
  view.onSettingsChanged({ downloadConcurrency: { newValue: 6 } }, 'local');
  view.callbacks[0]({ ok: true }); await save;
  assert.equal(view.current.downloadConcurrency, 6);
  assert.equal(Number(view.input.value), 6);
});

test('an older failed write cannot replace the success status of a newer write', async () => {
  const view = settingsView();
  const first = view.save({ downloadConcurrency: 4 });
  const second = view.save({ downloadConcurrency: 5 });
  view.callbacks[1]({ ok: true }); await second;
  view.callbacks[0]({ error: 'Old request failed' }); await first;
  assert.equal(view.status.dataset.state, 'saved');
  assert.equal(view.current.downloadConcurrency, 5);
});

test('out-of-order successful acknowledgements cannot roll back the settings baseline', async () => {
  const view = settingsView();
  const first = view.save({ downloadConcurrency: 4 });
  const second = view.save({ downloadConcurrency: 5 });
  view.callbacks[1]({ ok: true }); await second;
  view.callbacks[0]({ ok: true }); await first;
  assert.equal(view.current.downloadConcurrency, 5);
  assert.equal(Number(view.input.value), 5);
});

function modalFixture() {
  const node = () => ({ inert: false, tagName: 'DIV', contains: () => false, focus() {},
    querySelectorAll: () => [], setAttribute() {}, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({ children: [] }) });
  const native = node(); let closed = 0;
  const context = { window: {}, document: { body: { children: [native] }, documentElement: { children: [] } },
    chrome: { i18n: { getUILanguage: () => 'en' } }, MutationObserver: class { observe() {} disconnect() {} } };
  vm.runInNewContext(read('lib/ui.js'), context);
  return { api: context.window.PixivPlusUI, native, node, onClose: () => { closed++; }, get closed() { return closed; } };
}

test('closing a stale dialog twice cannot close a new dialog or restore its background', () => {
  const h = modalFixture();
  const closeFirst = h.api.openDialog(h.node(), h.onClose);
  closeFirst();
  h.api.openDialog(h.node(), h.onClose);
  closeFirst();
  assert.equal(h.closed, 1); assert.equal(h.api.isDialogOpen(), true); assert.equal(h.native.inert, true);
  h.api.closeDialog(); assert.equal(h.closed, 2); assert.equal(h.native.inert, false);
});

test('closing a dialog before leaving the workbench restores native page interactivity', () => {
  const h = modalFixture();
  h.api.setWorkbenchActive(true);
  h.api.openDialog(h.node(), h.onClose);
  h.api.closeDialog(); h.api.setWorkbenchActive(false);
  assert.equal(h.native.inert, false);
});

test('a failed final file commit re-enables queue removal controls', () => {
  const nodes = new Map();
  const node = name => { if (!nodes.has(name)) nodes.set(name,{style:{},classList:{add(){}},dataset:{},disabled:false}); return nodes.get(name); };
  const item = {dataset:{state:'in_progress'},querySelector:node};
  const shadow = {getElementById:id=>id==='pp-download-panel' ? node(id) : id==='pp-panel-body' ? {querySelectorAll:()=>[]} : null};
  const context = {window:{},document:{},crypto:require('node:crypto'),setTimeout:()=>0,clearTimeout(){},
    chrome:{runtime:{sendMessage:(message,callback)=>callback({ok:true})}}};
  const hooks = `panelHost={dataset:{},nextElementSibling:null};downloads.set('job',testItem);`;
  context.testItem = item;
  vm.runInNewContext(read('content/download-panel.js').replace('  window.PixivPlusDownloadPanel = {', hooks+'\n  window.PixivPlusDownloadPanel = {'), context);
  const update = fields => context.window.PixivPlusDownloadPanel.updateDownload({id:'job',filename:'file.jpg',...fields},shadow);
  update({state:'in_progress',committing:true});
  assert.equal(node('.pp-dl-remove').disabled, true);
  update({state:'interrupted',error:'Disk failed'});
  assert.equal(node('.pp-dl-remove').disabled, false);
});
