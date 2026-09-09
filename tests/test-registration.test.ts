/**
 * Every test file is actually run — locally AND in CI.
 *
 * Both runners name their suites explicitly, in one long line each, and the two
 * lines drift apart. This has been found and hand-corrected at least three
 * times; the workflow's own comment records one of them ("It had drifted:
 * several suites that run locally were never gated here, including the
 * post-quantum handlers"). A test that nothing runs is worse than no test,
 * because the file's presence is read as coverage.
 *
 * The direction that matters most is CI: a suite missing there is a suite whose
 * regressions merge green.
 *
 * Run with:
 *   node --import tsx --test tests/test-registration.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_SH = join(ROOT, 'tests/run.sh');
const WORKFLOW = join(ROOT, '.github/workflows/tests.yml');

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'helpers' || e === 'node_modules') continue;
    const f = join(dir, e);
    if (statSync(f).isDirectory()) testFiles(f, out);
    else if (e.endsWith('.test.ts')) out.push(relative(ROOT, f));
  }
  return out;
}

/**
 * True when the runner names this file, either literally or through a directory
 * glob it already uses (`tests/crypto/*.test.ts`).
 */
function isRegistered(runner: string, file: string): boolean {
  if (runner.includes(file)) return true;
  const glob = `${dirname(file)}/*.test.ts`;
  return runner.includes(glob);
}

const FILES = testFiles(join(ROOT, 'tests'));

describe('test registration', () => {
  it('found the test files at all', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    assert.ok(FILES.length > 30, `only found ${FILES.length} test files`);
  });

  it('every test file runs in CI', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const missing = FILES.filter((f) => !isRegistered(workflow, f)).sort();
    assert.deepEqual(
      missing,
      [],
      `test files never run by .github/workflows/tests.yml — their regressions merge green:\n  ${missing.join('\n  ')}`,
    );
  });

  it('every test file runs in ./tests/run.sh', () => {
    const runSh = readFileSync(RUN_SH, 'utf8');
    const missing = FILES.filter((f) => !isRegistered(runSh, f)).sort();
    assert.deepEqual(
      missing,
      [],
      `test files never run by tests/run.sh:\n  ${missing.join('\n  ')}`,
    );
  });

  it('every shared component appears in the standards inventory', () => {
    // §1 calls itself "generated from the folder, not maintained by hand,
    // because the previous hand-maintained one had drifted badly enough to be
    // misleading — it named a ModeCard that does not exist and omitted more
    // components than it listed". Nothing was actually generating it. This is.
    const doc = readFileSync(join(ROOT, 'docs/component-standards.md'), 'utf8');
    const components = readdirSync(join(ROOT, 'src/components'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.ok(components.length > 20, `only found ${components.length} components`);
    const missing = components.filter((c) => !doc.includes(`\`${c}\``)).sort();
    assert.deepEqual(
      missing,
      [],
      `shared components missing from docs/component-standards.md §1:\n  ${missing.join('\n  ')}`,
    );
    const claimed = doc.match(/There are \*\*(\d+)\*\*/);
    assert.equal(
      Number(claimed?.[1]),
      components.length,
      'the count in §1 disagrees with src/components/',
    );
  });

  it('every import alias is documented, and resolves', () => {
    // Two hand-maintained lists (a prose one in §2, a table in §7) plus two
    // config files that must agree. An alias missing from the docs is an alias
    // nobody uses, which is how a second import path for the same folder gets
    // invented.
    const doc = readFileSync(join(ROOT, 'docs/component-standards.md'), 'utf8');
    const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    const aliases = [...tsconfig.matchAll(/"(@[a-z]+)\/\*":\s*\["\.\/(src\/[a-z]+)\/\*"\]/g)]
      .map((m) => ({ alias: m[1], dir: m[2] }));
    assert.ok(aliases.length > 5, `only parsed ${aliases.length} aliases from tsconfig`);

    const undocumented = aliases.filter((a) => !doc.includes(`\`${a.alias}\``)).map((a) => a.alias);
    assert.deepEqual(undocumented, [], `aliases missing from docs/component-standards.md: ${undocumented.join(', ')}`);

    const missingFromVite = aliases.filter((a) => !vite.includes(`'${a.alias}'`)).map((a) => a.alias);
    assert.deepEqual(missingFromVite, [], `in tsconfig but not vite.config.ts — typecheck passes, build fails: ${missingFromVite.join(', ')}`);

    const missingDir = aliases.filter((a) => !existsSync(join(ROOT, a.dir))).map((a) => a.dir);
    assert.deepEqual(missingDir, [], `alias points at a directory that does not exist: ${missingDir.join(', ')}`);
  });

  it('every test file appears in the testing doc', () => {
    // The same drift, one step further out. docs/testing.md carries a table of
    // every suite and what it pins; it had gone twenty-five files stale, which
    // covered essentially everything added over the last stretch of work. An
    // inventory that omits entries is worse than no inventory, because it is
    // read as the list. Here the doc names files individually, so no glob.
    const doc = readFileSync(join(ROOT, 'docs/testing.md'), 'utf8');
    const missing = FILES.filter((f) => !doc.includes(f)).sort();
    assert.deepEqual(
      missing,
      [],
      `test files missing from docs/testing.md — add a line saying what each one pins:\n  ${missing.join('\n  ')}`,
    );
  });

  it('every file path a doc names actually exists', () => {
    // A doc that names a real-looking path for a file that was renamed or
    // deleted reads as authoritative right up until someone tries to open it.
    // `lib/storage.ts`, `lib/relayUtils.ts` and `lib/nip46.ts` sat wrong in six
    // files for years — three docs describing them as backing CURRENT behaviour
    // that had actually moved to nostr-tools or been deleted outright with the
    // Web-of-Trust subsystem. This is the mechanical check that would have
    // caught it: every backtick-quoted `src/…`/`tests/…`/`scripts/…` path with
    // a recognizable extension must resolve to a real file.
    const DOC_FILES = [
      ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
      'README.md',
      'CLAUDE.md',
    ];
    // Paths a doc mentions deliberately, as something that used to exist and
    // no longer does — the prose says so at the point of use. Adding to this
    // list should be rare and should mean "I read the sentence and it really
    // is describing a deletion," not "the check was inconvenient."
    const ALLOWED_HISTORICAL = new Set([
      'src/shared/browser.ts',
      'src/shared/animations.css',
    ]);
    const PATH_RE = /`((?:src|tests|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|css|md|json))`/g;
    const missing: string[] = [];
    for (const doc of DOC_FILES) {
      const full = join(ROOT, doc);
      if (!existsSync(full)) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(PATH_RE)) {
        const p = m[1];
        if (ALLOWED_HISTORICAL.has(p)) continue;
        if (!existsSync(join(ROOT, p))) missing.push(`${doc}: ${p}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `docs name a file that does not exist — renamed, moved, or deleted without the doc catching up:\n  ${missing.join('\n  ')}`,
    );
  });
});

// Release metadata is a consent boundary: older Firefox builds must not bypass
// the native consent prompt, and transmitted data must not be declared as none.
describe('release manifest', () => {
  it('requires native Firefox consent support on desktop and Android', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    assert.ok(parseInt(manifest.browser_specific_settings.gecko.strict_min_version) >= 140);
    assert.ok(parseInt(manifest.browser_specific_settings.gecko_android.strict_min_version) >= 142);
    assert.deepEqual([...manifest.browser_specific_settings.gecko.data_collection_permissions.required].sort(),
      ['authenticationInfo', 'browsingActivity', 'financialAndPaymentInfo', 'personalCommunications', 'personallyIdentifyingInfo'].sort());
  });
  it('keeps package, lockfile and extension release versions aligned', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
    assert.equal(pkg.version, manifest.version);
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
  });
});

it('builds before tests in local and CI runners so clean checkouts have CSS assets', () => {
  const local = readFileSync(RUN_SH, 'utf8');
  const ci = readFileSync(WORKFLOW, 'utf8');
  assert.ok(local.indexOf('npm run build') >= 0 && local.indexOf('npm run build') < local.indexOf('node --import'), 'local runner must build before tests');
  assert.ok(ci.indexOf('run: npm run build') >= 0 && ci.indexOf('run: npm run build') < ci.indexOf('run: node --import'), 'CI must build before tests');
});

// Keep feature rules usable without initializing browser or network services.
describe('source boundaries', () => {
  it('keeps lib limited to cryptography and browser compatibility', () => {
    assert.deepEqual(readdirSync(join(ROOT, 'src/lib')).sort(), ['browser.ts', 'crypto']);
  });

  it('keeps domain imports independent of services, browser APIs and React', () => {
    const domainRoot = join(ROOT, 'src/domain');
    const files = readdirSync(domainRoot, { recursive: true })
      .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'));
    assert.ok(files.length > 30, 'must inspect the domain tree');
    const violations: string[] = [];
    for (const file of files) {
      const full = join(domainRoot, file);
      const source = readFileSync(full, 'utf8');
      // Includes import/export-from, side-effect imports and dynamic imports.
      const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g);
      for (const [, specifier] of imports) {
        const target = specifier.startsWith('.')
          ? relative(join(ROOT, 'src'), join(dirname(full), specifier))
          : specifier.replace(/^@/, '');
        if (/^(?:services\/|lib\/browser(?:\.|$)|react(?:-dom)?(?:\/|$)|components\/|screens\/|context\/|hooks\/)/.test(target)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }
    assert.deepEqual(violations, [], 'domain rules must not depend on I/O or UI modules');
  });
});

// Duplicated defaults previously drifted between the popup and background.
describe('canonical constants', () => {
  it('defines shared policies once, under constants', () => {
    const owners: Record<string, string> = {
      DEFAULT_RELAYS: 'constants/relays.ts',
      PQC_PUBLISHED_CACHE: 'constants/relays.ts',
      MUTE_LIST_CACHE: 'constants/relays.ts',
      MIN_PASSWORD_LENGTH: 'constants/vault.ts',
      DEFAULT_AUTO_LOCK_MS: 'constants/vault.ts',
      UNLOCK_LOCKOUT_STEPS_MS: 'constants/vault.ts',
      NWC_REQUEST_TIMEOUT_MS: 'constants/wallet.ts',
      ONBOARDING_PENDING_TTL_MS: 'constants/wizard.ts',
    };
    const files = readdirSync(join(ROOT, 'src'), { recursive: true })
      .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f));
    for (const [name, owner] of Object.entries(owners)) {
      const declarations = files.filter(f => new RegExp(`\\bconst\\s+${name}\\s*[:=]`).test(readFileSync(join(ROOT, 'src', f), 'utf8')));
      assert.deepEqual(declarations, [owner], `${name} must have one definition`);
    }
  });

  it('derives relay text defaults from the shared list without sharing mutable configuration', async () => {
    const { DEFAULT_RELAYS, DEFAULT_RELAYS_CSV } = await import('../src/constants/relays.ts');
    const { configuredRelayUrls } = await import('../src/domain/relays/relayList.ts');
    assert.equal(DEFAULT_RELAYS_CSV, DEFAULT_RELAYS.join(','));
    const urls = configuredRelayUrls(undefined);
    assert.deepEqual(urls, DEFAULT_RELAYS);
    urls.pop();
    assert.equal(DEFAULT_RELAYS.length, 3);
    assert.deepEqual(configuredRelayUrls(''), []);
  });

  it('loads every constant module without a browser or UI runtime', async () => {
    const files = readdirSync(join(ROOT, 'src/constants'), { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'));
    assert.ok(files.length >= 20);
    for (const file of files) {
      const source = readFileSync(join(ROOT, 'src/constants', file), 'utf8');
      assert.doesNotMatch(source, /from ['"]@(?:services|components|screens|context|hooks)\//, file);
      await import(new URL(`../src/constants/${file}`, import.meta.url).href);
    }
  });
});

it('keeps shared domain records canonical instead of redeclaring handler/UI copies', () => {
  const owners: Record<string, string> = {
    ActivityEntry: 'domain/activity/activity.ts',
    MyMuteList: 'domain/mutes/muteList.ts',
    PqcStatus: 'domain/pqc/pqcState.ts',
    Account: 'domain/accounts/types.ts',
    SupportedLanguage: 'domain/i18n/types.ts',
  };
  const files = readdirSync(join(ROOT, 'src'), { recursive: true })
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f));
  for (const [name, owner] of Object.entries(owners)) {
    const declarations = files.filter(f => new RegExp(`\\binterface\\s+${name}\\b`).test(readFileSync(join(ROOT, 'src', f), 'utf8')));
    assert.deepEqual(declarations, [owner], `${name}: use a domain import or an explicit projection`);
  }
});

it('imports shared symbols from their owners without forwarding export barrels', () => {
  const files = readdirSync(join(ROOT, 'src'), { recursive: true })
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f));
  for (const file of files) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'src', file), 'utf8'),
      /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]/, file);
  }
});

it('generic utilities do not depend on feature domains, services or browser/crypto adapters', () => {
  const files = readdirSync(join(ROOT, 'src/utils'), { recursive: true })
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f));
  for (const file of files) {
    const source=readFileSync(join(ROOT, 'src/utils', file), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"](?:@(?:services|domain|lib)\/|(?:\.\.\/)+(?:services|domain|lib)\/)/, file);
  }
});

it('shared wizard screens belong to screens rather than an entry-point directory', () => {
  assert.equal(existsSync(join(ROOT, 'src/wizard')), false);
  for (const host of ['src/entrypoints/popup/PopupApp.tsx','src/entrypoints/onboarding/OnboardingApp.tsx']) {
    assert.match(readFileSync(join(ROOT, host), 'utf8'), /from ['"]@screens\/Wizard\//);
  }
  assert.ok(existsSync(join(ROOT, 'src/screens/Wizard/WizardSteps.tsx')));
  assert.doesNotMatch(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8'), /@wizard/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'), /@wizard/);
});

it('browser documents are grouped under entrypoints and feature modules cannot import their shells', () => {
  for (const name of ['popup','onboarding','prompt']) {
    assert.equal(existsSync(join(ROOT, 'src', name)),false);
    for (const file of ['index.html','main.tsx']) assert.ok(existsSync(join(ROOT,'src/entrypoints',name,file)));
  }
  const manifest=JSON.parse(readFileSync(join(ROOT,'manifest.json'),'utf8'));
  assert.equal(manifest.action.default_popup,'src/entrypoints/popup/index.html');
  const vite=readFileSync(join(ROOT,'vite.config.ts'),'utf8');
  for (const name of ['onboarding','prompt']) assert.ok(vite.includes(`src/entrypoints/${name}/index.html`));
  const files=readdirSync(join(ROOT,'src'),{recursive:true}).filter((f):f is string=>typeof f==='string'&&/\.tsx?$/.test(f)&&!f.startsWith('entrypoints/'));
  for (const file of files) assert.doesNotMatch(readFileSync(join(ROOT,'src',file),'utf8'),/(?:from\s*|import\s*\()['"][^'"]*entrypoints\//,file);
});

it('selection controls import one option contract instead of declaring copies', () => {
  assert.equal(existsSync(join(ROOT,'src/components/Dropdown/dropdownOption.ts')),false);
  for (const name of ['Tabs','ChipGroup','Dropdown','Select']) {
    const source=readFileSync(join(ROOT,`src/components/${name}/${name}.tsx`),'utf8');
    assert.match(source,/import type \{ Option \} from ['"]@components\/option.ts/);
    assert.doesNotMatch(source,/interface (?:TabOption|ChipOption|DropdownOption)\b/);
  }
});
