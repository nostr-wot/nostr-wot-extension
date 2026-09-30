import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPackage } from './verify-package.mjs';
import { ADDON_ID, digest } from './publish-firefox.mjs';

export function checksumFor(text, name) {
  const rows = text.split(/\r?\n/).map(line => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/)).filter(row => row?.[2] === name);
  assert.equal(rows.length, 1, `Expected one checksum for ${name}`);
  return rows[0][1];
}
export function changelogFor(text, version) {
  const blocks = text.split(/^## /m).slice(1);
  const matches = blocks.filter(block => block.split('\n')[0].trim().split(/\s/)[0] === version);
  assert.equal(matches.length, 1, 'Expected one matching changelog section');
  const body = matches[0].slice(matches[0].indexOf('\n') + 1).trim();
  assert.ok(body, 'Empty changelog section');
  return body;
}
/** Compare contents without extracting an untrusted path into the checkout. */
export function compareArchives(left, right) {
  execFileSync('python3', ['-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as a, zipfile.ZipFile(sys.argv[2]) as b:
 def files(z):
  names=z.namelist()
  assert len(names)==len(set(names)), 'Duplicate ZIP path'
  assert all(not n.startswith('/') and '\\\\' not in n and '..' not in n.split('/') for n in names), 'Unsafe ZIP path'
  return {n:z.read(n) for n in names if not n.endswith('/')}
 assert files(a)==files(b), 'Archive contents differ'
`, left, right], { stdio: 'pipe' });
}
export function prepareFirefox(directory, version, commit, run = execFileSync) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/);
  assert.match(commit ?? '', /^[a-f0-9]{40}$/);
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const filename = `nostr-wot-firefox-${version}.zip`, sourceName = `nostr-wot-source-${version}.zip`;
  run('gh', ['release', 'download', `v${version}`, '--pattern', filename, '--pattern', sourceName, '--pattern', 'SHA256SUMS', '--dir', root]);
  const checksums = readFileSync(join(root, 'SHA256SUMS'), 'utf8');
  const archive = join(root, filename), source = join(root, sourceName);
  const archiveHash = checksumFor(checksums, filename), sourceHash = checksumFor(checksums, sourceName);
  const checked = verifyPackage(archive, 'firefox', version);
  assert.equal(checked.manifest.browser_specific_settings.gecko.id, ADDON_ID);
  assert.equal(checked.sha256, archiveHash, 'Firefox release checksum mismatch');
  assert.equal(digest(readFileSync(source)), sourceHash, 'Source release checksum mismatch');
  const expected = join(root, 'expected-source.zip');
  run('git', ['archive', '--format=zip', `--output=${expected}`, commit]);
  compareArchives(source, expected);
  // The source matches this exact checkout. Reproduce the uploaded Firefox build.
  run('npm', ['run', 'package:firefox'], { stdio: 'inherit' });
  compareArchives(archive, resolve('nostr-wot-firefox.zip'));
  const changelog = changelogFor(readFileSync('CHANGELOG.md', 'utf8'), version);
  const releaseNotes = changelog.replace(/\]\((docs\/[^)]+)\)/g, `](https://github.com/nostr-wot/nostr-wot-extension/blob/${commit}/$1)`);
  const approvalNotes = [`Nostr WoT ${version}\nSource commit: ${commit}`, readFileSync('docs/firefox-reviewer-notes.md', 'utf8').trim(), readFileSync('SOURCE_BUILD.md', 'utf8').trim(), `Changes in this version\n\n${releaseNotes}`].join('\n\n');
  const metadata = { archive, source, version, archiveHash, sourceHash, approvalNotes, releaseNotes };
  writeFileSync(join(root, 'publish-metadata.json'), JSON.stringify(metadata));
  writeFileSync(join(root, 'reviewer-notes.txt'), approvalNotes);
  writeFileSync(join(root, 'release-notes.txt'), releaseNotes);
  return metadata;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareFirefox(process.argv[2], process.env.RELEASE_VERSION, process.env.RELEASE_COMMIT);
  console.log('Firefox package, exact source tree, reproducible build and review notes verified.');
}
