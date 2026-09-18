// Isolated browser QA fixture. Synthetic artworks, in-memory files, no Pixiv account.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const locale = JSON.parse(readFileSync(resolve(root, '_locales/zh_CN/messages.json'), 'utf8'));
const runtime = new Set(manifest.content_scripts.flatMap(script => script.js));
const bookmarks = new Map();
const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="900"><rect width="640" height="900" fill="#c3e1ec"/><circle cx="320" cy="370" r="190" fill="#edf4df"/><path d="M0 800L260 520L480 800Z" fill="#73a5ad"/><text x="320" y="120" text-anchor="middle" font-size="36" fill="#315b65">PixivPlus / QA</text></svg>';
const artwork = id => ({ id, title: '测试作品 ' + id, userName: '演示作者', userId: '7',
  pageCount: id === '1' ? 3 : 1, illustType: 0, tags: { tags: Array.from({ length: 9 }, (_, index) => ({ tag: '标签' + (index + 1) })) },
  bookmarkData: bookmarks.has(id) ? { id: bookmarks.get(id) } : null,
  urls: { original: '/sample.svg?id=' + id, regular: '/sample.svg?id=' + id, small: '/sample.svg?id=' + id } });
const mock = `
const locale = ${JSON.stringify(locale)};
const listeners = [], files = new Map();
let transfers = 0;
const automatic = new URL(location.href).searchParams.has('preload');
const getStored = () => JSON.parse(localStorage.getItem('pp-review-fixture') || '{}');
const store = (patch, cb) => {
  const before = getStored(); localStorage.setItem('pp-review-fixture', JSON.stringify({...before,...patch}));
  const changes = Object.fromEntries(Object.entries(patch).map(([key,newValue]) => [key,{oldValue:before[key],newValue}]));
  listeners.forEach(fn => fn(changes,'local')); cb?.();
};
window.chrome = {
  i18n: {getUILanguage: () => 'zh-CN', getMessage: key => locale[key]?.message || ''},
  storage: {local: {get: (defaults, cb) => cb(typeof defaults === 'string' ? {[defaults]:getStored()[defaults]} : {...defaults,...getStored(),...(automatic?{workbenchPreloadOriginals:true}:{})}), set:store}, onChanged:{addListener: fn => listeners.push(fn)}},
  runtime: {
    onMessage:{addListener(){}},
    sendMessage: (msg, cb) => {
      const data = getStored();
      if(msg.type === 'markWorkSeen') store({workbenchSeenWorkIds:[...new Set([...(data.workbenchSeenWorkIds||[]),msg.workId])]},()=>cb?.({ok:true}));
      else if(msg.type === 'addDownloadHistory') store({pp_download_history:[msg.item,...(data.pp_download_history||[]).filter(item=>item.id!==msg.item.id)].slice(0,100)},()=>cb?.({ok:true}));
      else if(msg.type === 'estimateSizes') cb?.({sizes:msg.urls.map(()=>1024)});
      else cb?.({ok:true});
    },
    connect: () => {
      let receive, disconnected=false;
      return {onMessage:{addListener:fn=>{receive=fn}},onDisconnect:{addListener(){}},disconnect(){disconnected=true},
        postMessage(msg){
          document.title = 'PixivPlus · 隔离测试 · 原图请求 ' + (++transfers);
          const bytes = ${JSON.stringify(sample)};
          for(let step=1;step<=4;step++)setTimeout(()=>{
            if(disconnected)return;
            receive({type:'progress',received:Math.round(bytes.length*step/4),total:bytes.length,speed:'128 KB/s'});
            if(step===4){receive({type:'chunk',data:btoa(bytes)});receive({type:'done',received:bytes.length,contentType:'image/svg+xml'});}
          },step*650);
        }
      };
    }
  }
};
const folder = {
  name:'演示目录（不写入磁盘）',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',isSameEntry:async other=>other===folder,
  getFileHandle:async (name,options) => {
    if(!files.has(name)){if(!options?.create)throw new DOMException('Missing','NotFoundError');files.set(name,{size:0,lastModified:0});}
    return {getFile:async()=>files.get(name),createWritable:async()=>{let blob;return {write:async value=>{blob=value},close:async()=>files.set(name,{size:blob.size,lastModified:Date.now()}),abort:async()=>{}}}};
  },removeEntry:async name=>files.delete(name)
};
window.showDirectoryPicker = async()=>folder;
// Avoid persisting a synthetic handle; this is isolated fixture storage only.
Object.defineProperty(window, 'indexedDB', {value: {open(){const request={};setTimeout(()=>{request.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={objectStore:()=>({get(){const req={};setTimeout(()=>{req.result=folder;req.onsuccess?.()},0);return req;},put(){setTimeout(()=>tx.oncomplete?.(),0);},delete(){setTimeout(()=>tx.oncomplete?.(),0);}})};return tx;}};request.onsuccess?.()},0);return request;}}, configurable:true});
`;
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(mock); }
  if (url.pathname === '/sample.svg') {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.end(sample);
  }
  const detail = url.pathname.match(/^\/ajax\/illust\/(\d+)(\/pages)?$/);
  if (detail) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error:false, body: detail[2] ? Array.from({length:3},(_,index)=>({urls:{original:'/sample.svg?page='+index,regular:'/sample.svg?page='+index}})) : artwork(detail[1]) }));
  }
  if (url.pathname.startsWith('/ajax/illusts/bookmarks/')) {
    let raw=''; for await (const part of req) raw+=part;
    const body=JSON.parse(raw); if(body.illust_id) bookmarks.set(body.illust_id,'bookmark-'+body.illust_id);
    if(body.bookmark_id) for(const [id,value] of bookmarks) if(value===body.bookmark_id) bookmarks.delete(id);
    res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({error:false,body:{last_bookmark_id:'bookmark-'+body.illust_id}}));
  }
  const file=url.pathname.slice(1);
  if(runtime.has(file)){res.setHeader('Content-Type','text/javascript');return res.end(readFileSync(resolve(root,file)));}
  if(url.pathname === '/bookmark_new_illust.php') {
    const scripts=['fixture.js',...runtime].map(file=>'<script src="/'+file+'"></script>').join('');
    const cards=Array.from({length:12},(_,i)=>'<li><a href="/artworks/'+(i+1)+'"><img src="/sample.svg?id='+i+'" alt="测试作品 '+(i+1)+'" width="150"></a></li>').join('');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>PixivPlus · 隔离测试</title><meta name="csrf-token" content="fixture-token"></head><body><main><a href="#native">原站焦点测试</a><ul>'+cards+'</ul></main>'+scripts+'</body></html>');
  }
  res.writeHead(404);res.end();
}).listen(4178,'127.0.0.1',()=>console.info('Isolated workbench fixture: http://127.0.0.1:4178/bookmark_new_illust.php'));
