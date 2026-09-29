import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
