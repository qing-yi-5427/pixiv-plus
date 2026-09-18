import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const dist = join(root, 'dist');
const preview = process.argv.includes('--preview');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(dist, preview ? `pixiv-plus-preview-${stamp}.zip` : `pixiv-plus-${manifest.version}.zip`);
const checksumOutput = `${output}.sha256`;
const packageEntries = [
  'manifest.json', 'rules.json', '_locales', 'background', 'content', 'icons', 'lib', 'popup'
];

mkdirSync(dist, { recursive: true });
if (existsSync(output) || existsSync(checksumOutput)) {
  throw new Error('Refusing to overwrite an existing release. Bump the version or use npm run build -- --preview.');
}
execFileSync('zip', ['-q', '-r', output, ...packageEntries], { cwd: root, stdio: 'inherit' });

const size = statSync(output).size;
const checksum = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(checksumOutput, `${checksum}  ${output.split('/').pop()}\n`);
console.log(`Built ${output} (${(size / 1024).toFixed(1)} KB, SHA-256 ${checksum})`);
