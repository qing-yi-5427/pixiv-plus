const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('build refuses to overwrite either an existing release archive or its checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivplus-build-test-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'dist'));
    fs.copyFileSync(path.join(__dirname, '../scripts/build.mjs'), path.join(root, 'scripts/build.mjs'));
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '2.1.0' }));
    for (const suffix of ['', '.sha256']) {
      const release = path.join(root, 'dist/pixiv-plus-2.1.0.zip' + suffix);
      fs.writeFileSync(release, 'submitted-release');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Refusing to overwrite/);
      assert.equal(fs.readFileSync(release, 'utf8'), 'submitted-release');
      fs.unlinkSync(release);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
