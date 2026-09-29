import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { verifyPackage } from '../scripts/verify-package.mjs';

function fixture(change: (m: any, dir: string) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'package-regression-'));
  const files = join(dir, 'files');
  mkdirSync(files);
  const manifest = { manifest_version: 3, version: '0.8.5', background: { service_worker: 'worker.js' }, action: { default_popup: 'popup.html' } };
  writeFileSync(join(files, 'worker.js'), 'console.log("worker")');
  writeFileSync(join(files, 'popup.html'), '<html></html>');
  change(manifest, files);
  writeFileSync(join(files, 'manifest.json'), JSON.stringify(manifest));
  const zip = join(dir, 'chrome.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: files });
  return { zip, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('accepts an actual Chrome archive and returns its checksum', () => {
  const f = fixture();
  try { assert.match(verifyPackage(f.zip, 'chrome', '0.8.5').sha256, /^[a-f0-9]{64}$/); } finally { f.clean(); }
});
for (const [name, mutate, message] of [
  ['Firefox archive renamed as Chrome', (m: any) => { m.background = { scripts: ['worker.js'] }; }, /service_worker/],
  ['mixed browser manifest', (m: any) => { m.background.scripts = ['worker.js']; }, /scripts/],
  ['Firefox metadata', (m: any) => { m.browser_specific_settings = { gecko: {} }; }, /Firefox/],
  ['missing worker', (m: any) => { m.background.service_worker = 'missing.js'; }, /missing/],
  ['missing popup', (m: any) => { m.action.default_popup = 'missing.html'; }, /missing/],
  ['version mismatch', (m: any) => { m.version = '0.8.4'; }, /version/],
  ['unsafe worker path', (m: any) => { m.background.service_worker = '../worker.js'; }, /path/],
] as const) {
  test(`rejects ${name}`, () => {
    const f = fixture(mutate);
    try { assert.throws(() => verifyPackage(f.zip, 'chrome', '0.8.5'), message); } finally { f.clean(); }
  });
}
test('Firefox validation accepts scripts and rejects Chrome artifacts', () => {
  const f = fixture(m => { m.background = { scripts: ['worker.js'] }; m.browser_specific_settings = { gecko: { id: 'test@example.com' } }; });
  const chrome = fixture();
  try {
    assert.equal(verifyPackage(f.zip, 'firefox', '0.8.5').manifest.version, '0.8.5');
    assert.throws(() => verifyPackage(chrome.zip, 'firefox', '0.8.5'), /scripts/);
  } finally { f.clean(); chrome.clean(); }
});

// Exercise the real packaging orchestration with a tiny build and no browser.
// Archive validation stays real; browser startup is covered by the release smoke.
function packagingFixture() {
  const root = mkdtempSync(join(tmpdir(), 'packaging-failure-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'node_modules/vite/bin'), { recursive: true });
  for (const name of ['package.mjs', 'verify-package.mjs']) {
    copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  writeFileSync(join(root, 'scripts/smoke-chrome.mjs'), 'export async function smokeChrome() {}');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.8.6' }));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: '0.8.6' }));
  writeFileSync(join(root, 'node_modules/vite/bin/vite.js'), `
    const fs = require('node:fs'), path = require('node:path');
    if (process.env.PACKAGING_TEST_FAIL) {
      if (process.env.PACKAGING_TEST_FAIL === 'wait') {
        fs.writeFileSync('started', '');
        const deadline = Date.now() + 10000;
        while (!fs.existsSync('release') && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      throw new Error('simulated build failure');
    }
    const out = process.argv[process.argv.indexOf('--outDir') + 1];
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
      manifest_version: 3, version: '0.8.6', background: { service_worker: 'worker.js' },
      action: { default_popup: 'popup.html' }
    }));
    fs.writeFileSync(path.join(out, 'worker.js'), 'console.log("worker")');
    fs.writeFileSync(path.join(out, 'popup.html'), '<html></html>');
  `);
  const args = [join(root, 'scripts/package.mjs'), 'chrome'];
  const output = join(root, 'nostr-wot-chrome.zip');
  writeFileSync(output, 'stale upload artifact');
  return { root, args, output, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('failed repack invalidates the previous upload artifact', () => {
  const f = packagingFixture();
  try {
    const result = spawnSync(process.execPath, f.args, {
      encoding: 'utf8', env: { ...process.env, PACKAGING_TEST_FAIL: 'immediate' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /simulated build failure/);
    assert.equal(existsSync(f.output), false, 'failed packaging must not leave a stale upload ZIP');
  } finally { f.clean(); }
});

test('a failed concurrent repack preserves another invocation’s verified output', async () => {
  const f = packagingFixture();
  const failed = spawn(process.execPath, f.args, {
    stdio: 'ignore', env: { ...process.env, PACKAGING_TEST_FAIL: 'wait' },
  });
  const finished = new Promise(resolve => failed.once('exit', resolve));
  try {
    for (let i = 0; i < 500 && !existsSync(join(f.root, 'started')); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(existsSync(join(f.root, 'started')), 'failing build should reach its controlled pause');
    const success = spawnSync(process.execPath, f.args, { encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    const verified = verifyPackage(f.output, 'chrome', '0.8.6');
    writeFileSync(join(f.root, 'release'), '');
    assert.notEqual(await finished, 0);
    assert.equal(verifyPackage(f.output, 'chrome', '0.8.6').sha256, verified.sha256);
  } finally {
    failed.kill();
    await finished;
    f.clean();
  }
});
