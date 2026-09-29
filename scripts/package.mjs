import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeChrome } from './smoke-chrome.mjs';
import { verifyPackage } from './verify-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (!['chrome', 'firefox'].includes(target)) throw new Error('Choose chrome or firefox');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (source.version !== pkg.version) throw new Error('Source manifest/package version mismatch');
// Each invocation builds and patches its own staging directory: Firefox cannot
// mutate Chrome output, even when commands run concurrently. dist stays untouched.
const staging = mkdtempSync(join(root, '.package-'));
const output = join(root, `nostr-wot-${target}.zip`);
try {
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(staging, 'build')], { cwd: root, stdio: 'inherit' });
  const build = join(staging, 'build');
  const path = join(build, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (target === 'chrome') delete manifest.browser_specific_settings;
  else {
    manifest.background = { scripts: [manifest.background.service_worker] };
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  const archive = join(staging, 'package.zip');
  execFileSync('zip', ['-qrX', archive, '.', '-x', '.vite/*'], { cwd: build });
  const { sha256 } = verifyPackage(archive, target, pkg.version);
  if (target === 'chrome') await smokeChrome(archive, pkg.version);
  renameSync(archive, output);
  console.log(`Verified ${target} ${pkg.version}: ${sha256}  ${output}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
