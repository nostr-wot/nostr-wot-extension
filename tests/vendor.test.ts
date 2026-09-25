import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

/*
 * The vendored tarballs must be the ones vendor/manifest.json records, and the manifest
 * must name the SDK commit they were packed from. When the checkout is reachable its HEAD
 * must be that commit: the sibling app's tarballs once drifted sixteen commits behind the
 * branch with nothing to say so, and this is the thing that says so.
 *
 * `@nostr-wot/pq` is one of the six and is the only one with a published counterpart on the
 * registry, which is what makes it the dangerous one. `signer-core` declares a `^0.2.2`
 * range on it, the registry has a 0.2.2, and that published 0.2.2 does NOT export
 * everything this `signer-core` imports. Without the root `file:` dependency npm satisfies
 * the range from the registry and the extension fails at import; with a version bump it
 * could just as easily resolve a NESTED registry copy under `signer-core` and leave the
 * vendored one at the root unused, which fails nothing and is invisible. So three things
 * are checked below and none of them is the version number: the root copy is the tarball,
 * no nested copy shadows it, and the tarball exports every name `signer-core` takes from it.
 *
 * `@nostr-wot/signers` is deliberately NOT in the manifest: it is published at the version
 * signer-core's range wants, so it is an ordinary registry dependency. The nested-copy
 * check only walks the manifest's names, so it is skipped by construction rather than by a
 * special case.
 */

const root = path.resolve(import.meta.dirname, '..');
interface Manifest {
  source: { checkout: string; sdkBranch: string; sdkCommit: string };
  packages: Record<string, { file: string; sha256: string }>;
}
const manifest = JSON.parse(readFileSync(path.join(root, 'vendor/manifest.json'), 'utf8')) as Manifest;

/**
 * Where the SDK checkout is.
 *
 * The manifest's path is relative to this repository root, and how many `..` that takes
 * depends on whether this is the main clone (`nostr-wot/nostr-wot-extension`) or a worktree
 * of it (`nostr-wot/nostr-wot-extension-worktrees/<task>`), which is one level deeper. Both
 * are ordinary places to run from, so both are tried rather than one being declared correct;
 * `VENDOR_SDK_PATH` overrides either.
 */
function checkout(): string | null {
  const override = process.env['VENDOR_SDK_PATH'];
  if (override) return override;
  const recorded = path.join(root, manifest.source.checkout);
  if (existsSync(path.join(recorded, 'packages'))) return recorded;
  const sibling = path.join(root, '..', manifest.source.checkout);
  if (existsSync(path.join(sibling, 'packages'))) return sibling;
  return null;
}

/** The six names the extension imports, so a package silently dropped from the set is caught. */
const EXPECTED = ['accounts', 'permissions', 'pq', 'signer-core', 'storage', 'vault'];

test('every vendored tarball matches the manifest and package.json points at it', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.match(manifest.source.sdkCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(manifest.packages).sort(), EXPECTED);
  for (const [name, entry] of Object.entries(manifest.packages)) {
    const bytes = readFileSync(path.join(root, 'vendor', entry.file));
    const sum = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sum, entry.sha256, `${entry.file} differs from the manifest; repack with scripts/vendor-signer-packages.sh`);
    assert.equal(pkg.dependencies[`@nostr-wot/${name}`], `file:vendor/${entry.file}`);
  }
});

test('the installed copy and the lockfile are the tarball, not an older extraction', () => {
  // npm does not re-extract a `file:` tarball whose spec and version are unchanged, so a
  // repack can leave node_modules and package-lock on the previous bytes with no error.
  // That happened once in the sibling app. The script now uninstalls and reinstalls; this
  // checks it took.
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { integrity?: string }>;
  };
  for (const [name, entry] of Object.entries(manifest.packages)) {
    const tarball = path.join(root, 'vendor', entry.file);
    const inTarball = execFileSync('tar', ['-xOf', tarball, 'package/dist/index.js']);
    const installedPath = path.join(root, 'node_modules/@nostr-wot', name, 'dist/index.js');
    if (!existsSync(installedPath)) continue; // no node_modules: nothing installed to compare
    const installed = readFileSync(installedPath);
    assert.equal(
      createHash('sha256').update(installed).digest('hex'),
      createHash('sha256').update(inTarball).digest('hex'),
      `node_modules/@nostr-wot/${name} is not the vendored tarball; rerun scripts/vendor-signer-packages.sh`,
    );
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    assert.equal(
      lock.packages[`node_modules/@nostr-wot/${name}`]?.integrity,
      integrity,
      `package-lock integrity for ${name} is not this tarball's`,
    );
  }
});

test('no nested copy of a vendored package shadows the root one', () => {
  // A `file:` dependency at the root is only load-bearing while npm dedupes every dependent
  // onto it. `@nostr-wot/pq` is published, so npm can satisfy `signer-core`'s `^0.2.2` from
  // the registry INSIDE `node_modules/@nostr-wot/signer-core/node_modules` and leave the
  // vendored root copy installed and unused. Nothing else notices: the root copy still
  // matches its tarball, the lockfile is still valid, and the extension runs the registry's
  // code. The lockfile is the only place that shows it, so it is read here.
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { resolved?: string }>;
  };
  for (const name of Object.keys(manifest.packages)) {
    const shadows = Object.keys(lock.packages).filter(
      (key) => key.endsWith(`/node_modules/@nostr-wot/${name}`) && key !== `node_modules/@nostr-wot/${name}`,
    );
    assert.deepEqual(shadows, [], `@nostr-wot/${name} is installed nested as well as at the root: ${shadows.join(', ')}`);
    assert.equal(
      lock.packages[`node_modules/@nostr-wot/${name}`]?.resolved,
      `file:vendor/${manifest.packages[name]!.file}`,
      `@nostr-wot/${name} does not resolve to the vendored tarball`,
    );
  }
});

test('the vendored pq exports every name the vendored signer-core takes from it', () => {
  // The check that matters more than the version range. The published 0.2.2 is missing
  // exports this signer-core imports and re-exports, and a range that matches on paper
  // resolves a package missing them. The names are read out of the signer-core bundle
  // instead of being listed here, so the next import it grows is covered without anybody
  // remembering to add it.
  const signerCore = execFileSync(
    'tar',
    ['-xOf', path.join(root, 'vendor', manifest.packages['signer-core']!.file), 'package/dist/index.js'],
    { encoding: 'utf8' },
  );
  const wanted = new Set<string>();
  for (const line of signerCore.split('\n')) {
    // `import { a, b as c } from '@nostr-wot/pq';` and `export { d as e } from '@nostr-wot/pq';`
    const match = /^(?:import|export)\s*\{([^}]*)\}\s*from\s*'@nostr-wot\/pq';/.exec(line.trim());
    if (!match) continue;
    for (const clause of match[1]!.split(',')) {
      const local = clause.trim().split(/\s+as\s+/)[0]!.trim();
      if (local.length > 0) wanted.add(local);
    }
  }
  assert.ok(wanted.size > 0, 'signer-core no longer imports from @nostr-wot/pq; if that is deliberate, drop pq from the manifest too');
  const pq = execFileSync(
    'tar',
    ['-xOf', path.join(root, 'vendor', manifest.packages['pq']!.file), 'package/dist/index.js'],
    { encoding: 'utf8' },
  );
  const exported = new Set(
    (/export\s*\{([^}]*)\};/.exec(pq.slice(pq.lastIndexOf('export {')))?.[1] ?? '')
      .split(',')
      .map((name) => name.trim().split(/\s+as\s+/).pop()!.trim()),
  );
  assert.ok(exported.size > 0, 'could not read the export list out of the pq tarball');
  const missing = [...wanted].filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], `the vendored @nostr-wot/pq does not export what signer-core imports: ${missing.join(', ')}`);
});

test('the SDK checkout, when present, is at the recorded commit', (t) => {
  const sdk = checkout();
  if (!sdk) {
    t.skip(`no SDK checkout at ${manifest.source.checkout}`);
    return;
  }
  const head = execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(
    head,
    manifest.source.sdkCommit,
    `the checkout is at ${head.slice(0, 7)} but its tarballs were packed from ${manifest.source.sdkCommit.slice(0, 7)}; repack or note why`,
  );
  const branch = execFileSync('git', ['-C', sdk, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  assert.equal(branch, manifest.source.sdkBranch, `the checkout is on ${branch}, not the recorded ${manifest.source.sdkBranch}`);
});

test('the vendored nip49 maxmem admits the scrypt allocation every noble version makes', async () => {
  // The reason this migration touches NIP-49 at all. The extension's own formula was
  // `128*r*(N+p)`, which @noble/hashes 2.0.1 accepted and 2.4.0 refuses by exactly one
  // block, because 2.4.0 counts the scratch block it had always allocated. The extension
  // declares `^2.0.1`, so a fresh install today gets 2.4.0 and a NIP-49 path that can
  // neither write nor read an ncryptsec — while a lockfile-pinned suite stays green.
  //
  // Checked against the tarball's own exported formula and against whichever @noble/hashes
  // is actually installed, so this fails on the day the range resolves differently rather
  // than on the day a user reports it.
  const { scryptMaxMem, SCRYPT_R, SCRYPT_P, DEFAULT_LOG_N } = await import('@nostr-wot/accounts');
  const { scryptAsync } = await import('@noble/hashes/scrypt.js');
  const logN = DEFAULT_LOG_N;
  assert.equal(scryptMaxMem(logN), 128 * SCRYPT_R * (2 ** logN + SCRYPT_P + 1));
  await scryptAsync(new TextEncoder().encode('password'), new Uint8Array(16), {
    N: 1 << logN,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: 32,
    maxmem: scryptMaxMem(logN),
  });
});
