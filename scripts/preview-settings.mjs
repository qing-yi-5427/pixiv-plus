// Local UI fixture only. Does not access the browser extension or Pixiv accounts.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const mock = `
const listeners = [];
const read = () => JSON.parse(localStorage.getItem('settings-preview') || '{}');
window.chrome = {
  i18n: {getUILanguage: () => new URLSearchParams(location.search).get('lang') || 'zh-CN'},
  runtime: {
    getManifest: () => ({version:'2.2.0 · Preview'}),
    openOptionsPage: () => window.open('/popup/popup.html?view=page'),
    sendMessage: (msg, cb) => {
      if (msg.type === 'getSettings') return cb(PixivPlusSettings.normalize(read()));
      if (new URLSearchParams(location.search).get('fail') === 'save') return cb({error:'Simulated storage failure'});
      const patch = PixivPlusSettings.validatePatch(msg);
      localStorage.setItem('settings-preview', JSON.stringify({...read(), ...patch}));
      const changes = Object.fromEntries(Object.entries(patch).map(([key,value]) => [key,{newValue:value}]));
      listeners.forEach(fn => fn(changes, 'local')); cb({ok:true});
    }
  },
  storage: {local: {get: (defaults, cb) => cb({...defaults,...read()})}, onChanged: {addListener: fn => listeners.push(fn)}},
  tabs: {query: async () => []}
};
addEventListener('storage', event => {
  if(event.key !== 'settings-preview') return;
  const previous = JSON.parse(event.oldValue || '{}'), next = JSON.parse(event.newValue || '{}');
  const changes = Object.fromEntries(Object.entries(next).filter(([key,value]) => previous[key] !== value).map(([key,value]) => [key,{newValue:value}]));
  listeners.forEach(fn => fn(changes, 'local'));
});
`;
const allowed = new Set(['/popup/popup.html', '/popup/settings.html', '/popup/popup.js', '/popup/popup.css', '/lib/settings.js', '/lib/pixiv-api.js']);
createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/preview-api.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(mock); }
  if (!allowed.has(pathname)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(resolve(root, '.' + pathname), 'utf8');
  if (pathname.endsWith('.html')) body = body.replace('<script src="../lib/settings.js">', '<script src="/preview-api.js"></script><script src="../lib/settings.js">');
  res.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(body);
}).listen(4177, '127.0.0.1', () => console.info('Settings UI fixture: http://127.0.0.1:4177/popup/popup.html?view=page'));
