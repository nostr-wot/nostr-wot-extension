import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Inspect the actual ZIP, never a neighbouring dist directory or its filename. */
export function verifyPackage(archive, target, version) {
  assert.ok(['chrome', 'firefox'].includes(target), 'Target must be chrome or firefox');
  const zip = resolve(archive);
  execFileSync('unzip', ['-tqq', zip]);
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(new Set(entries).size, entries.length, 'Duplicate ZIP paths');
  for (const entry of entries) {
    assert.ok(!entry.startsWith('/') && !entry.includes('\\') && !entry.split('/').includes('..'), 'Unsafe ZIP path');
  }
  assert.ok(entries.includes('manifest.json'), 'Missing root manifest.json');
  const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.manifest_version, 3, 'Expected Manifest V3');
  assert.equal(manifest.version, version, 'Package version mismatch');
  const bg = manifest.background ?? {};
  if (target === 'chrome') {
    assert.ok(typeof bg.service_worker === 'string' && bg.service_worker, 'Chrome requires background.service_worker');
    assert.ok(!('scripts' in bg) && !('persistent' in bg), 'Chrome forbids background.scripts/persistent');
    assert.ok(!('browser_specific_settings' in manifest), 'Chrome package contains Firefox settings');
  } else {
    assert.ok(Array.isArray(bg.scripts) && bg.scripts.length > 0, 'Firefox requires background.scripts');
    assert.ok(!('service_worker' in bg), 'Firefox package contains service_worker');
    assert.ok(manifest.browser_specific_settings?.gecko?.id, 'Firefox requires gecko.id');
  }
  const paths = [target === 'chrome' ? bg.service_worker : bg.scripts, manifest.action?.default_popup,
    Object.values(manifest.icons ?? {}), (manifest.content_scripts ?? []).flatMap(s => [...(s.js ?? []), ...(s.css ?? [])])].flat(Infinity);
  for (const path of paths) {
    assert.ok(typeof path === 'string' && path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'Invalid resource path');
    assert.ok(entries.includes(path), `Package resource missing: ${path}`);
  }
  return { manifest, sha256: createHash('sha256').update(readFileSync(zip)).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , target, archive] = process.argv;
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const result = verifyPackage(archive, target, version);
  console.log(`${target} ${version} verified: ${result.sha256}  ${archive}`);
}
