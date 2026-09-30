const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('release validation rejects a CSP that allows remote scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivplus-validation-test-'));
  try {
    const source = path.resolve(__dirname, '..');
    for (const name of ['manifest.json','package.json','rules.json','_locales','background','content','icons','lib','popup']) {
      fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
    }
    fs.mkdirSync(path.join(root,'scripts'));
    fs.copyFileSync(path.join(source,'scripts/validate.mjs'),path.join(root,'scripts/validate.mjs'));
    const run = () => spawnSync(process.execPath,[path.join(root,'scripts/validate.mjs')],{encoding:'utf8'});
    assert.equal(run().status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    manifest.content_security_policy.extension_pages = "script-src 'self' https://example.com; object-src 'self'";
    fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));
    const rejected = run();
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /CSP must allow bundled code only/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
