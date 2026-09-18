import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const errors = [];

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.version !== pkg.version) errors.push('manifest.json and package.json versions differ');
if (!manifest.name.startsWith('__MSG_')) errors.push('manifest name must be localized');
if (!manifest.description.startsWith('__MSG_')) errors.push('manifest description must be localized');

const allowedPermissions = new Set(['storage', 'declarativeNetRequest']);
for (const permission of manifest.permissions || []) {
  if (!allowedPermissions.has(permission)) errors.push(`unexpected permission: ${permission}`);
}
const allowedHosts = new Set(['*://www.pixiv.net/*', '*://i.pximg.net/*']);
for (const host of manifest.host_permissions || []) {
  if (!allowedHosts.has(host)) errors.push(`unexpected host permission: ${host}`);
}

const requiredFiles = [
  'manifest.json', 'rules.json', 'background/service-worker.js', 'lib/pixiv-api.js',
  'lib/workbench-model.js', 'lib/settings.js', 'content/workbench.js',
  'content/main.js', 'content/bookmark-download.js',
  'content/download-panel.js', 'popup/popup.html',
  'popup/popup.js', 'popup/popup.css', 'popup/settings.html', '_locales/en/messages.json',
  '_locales/zh_CN/messages.json', 'icons/icon16.png', 'icons/icon48.png',
  'icons/icon128.png'
];
for (const file of requiredFiles) {
  try { statSync(join(root, file)); } catch { errors.push(`missing required file: ${file}`); }
}

const localeKeys = new Set(Object.keys(readJson('_locales/en/messages.json')));
for (const [locale, messages] of [
  ['en', readJson('_locales/en/messages.json')],
  ['zh_CN', readJson('_locales/zh_CN/messages.json')]
]) {
  for (const key of localeKeys) if (!messages[key]?.message) errors.push(`${locale} missing message: ${key}`);
  for (const key of Object.keys(messages)) if (!localeKeys.has(key)) errors.push(`${locale} has unexpected message: ${key}`);
}

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel.startsWith('.git/') || rel.startsWith('dist/')) continue;
  if (extname(file) === '.js' || extname(file) === '.mjs') {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch { errors.push(`JavaScript syntax check failed: ${rel}`); }
    const source = readFileSync(file, 'utf8');
    if (/\beval\s*\(|\bnew\s+Function\s*\(|\bimportScripts\s*\(\s*['"]https?:/i.test(source)) {
      errors.push(`possible remote/dynamic code execution: ${rel}`);
    }
    if (/\.innerHTML\s*=\s*`[^`]*\$\{/s.test(source) || /\bon(?:error|load|click)\s*=\s*["']/i.test(source)) {
      errors.push(`dynamic HTML or inline event handler found: ${rel}`);
    }
    if (/^(background|content|lib|popup)\//.test(rel) && /console\.log\s*\(/.test(source)) {
      errors.push(`debug console.log found: ${rel}`);
    }
  }
  if (extname(file) === '.html') {
    const source = readFileSync(file, 'utf8');
    if (/<script[^>]+src=['"]https?:/i.test(source)) errors.push(`remote script found: ${rel}`);
    if (/<script(?![^>]+src=)[^>]*>/i.test(source)) errors.push(`inline script found: ${rel}`);
  }
}

if (errors.length) {
  console.error(`Validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Validated PixivPlus ${manifest.version}: manifest, permissions, locales, CSP and source checks passed.`);

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
