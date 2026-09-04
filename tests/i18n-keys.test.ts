/**
 * Every string the UI asks for exists, in every locale, with the same placeholders.
 *
 * The obvious version of this test — compare each locale's key set against en's —
 * is provably too weak, and this repo has the scar to show it. `DoneStep` renders
 * ``t(`wizard.type.${account.type}`)`` over the `AccountType` union, which was
 * renamed to nsec/npub/external while the locales kept the old `imported` and
 * `watch-only`. **en lacks those keys too**, so locales-vs-en passes while first-run
 * nsec and npub importers read the literal string "wizard.type.nsec" as their
 * account type — in all six languages.
 *
 * So the authority here is the SOURCE: scan what the code actually asks `t()` for,
 * including the handful of dynamic families, enumerated from the unions that drive
 * them (read out of the source too, so the enumeration cannot drift from the type).
 *
 * Run with:
 *   node --import tsx --test tests/i18n-keys.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const LOCALES = ['en', 'es', 'pt', 'fr', 'de', 'it'] as const;
// lib/ moved under src/, so one root covers everything now.
const SOURCE_DIRS = ['src'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Directories whose strings are not part of the shipped popup surface. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'safari-build', 'safari-xcode']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SOURCE_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

const FILES = SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

const SOURCES = new Map(FILES.map((f) => [f, read(f)]));

function readLocale(loc: string): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, 'src', 'public', 'locales', `${loc}.json`), 'utf8'));
}

const CATALOGUES = Object.fromEntries(LOCALES.map((l) => [l, readLocale(l)])) as
  Record<(typeof LOCALES)[number], Record<string, string>>;

/** Pull a `|`-separated string-literal union out of a type declaration. */
function unionMembers(file: string, typeName: string): string[] {
  const src = SOURCES.get(join(ROOT, file));
  assert.ok(src, `${file} not found — the enumeration below would silently cover nothing`);
  const decl = new RegExp(`(?:export )?type ${typeName}\\s*=([^;]+);`).exec(src!);
  assert.ok(decl, `could not find "type ${typeName}" in ${file}`);
  return [...decl![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Pull members out of a `const X = ['a', 'b'] as const` declaration. */
function constArrayMembers(file: string, name: string): string[] {
  const src = SOURCES.get(join(ROOT, file));
  assert.ok(src, `${file} not found`);
  const decl = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]+)\\]`).exec(src!);
  assert.ok(decl, `could not find "const ${name}" in ${file}`);
  return [...decl![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * `t()` calls built from a template literal. Each is listed with the union that
 * supplies its suffix, read from source so renaming the union breaks this test
 * rather than the UI.
 */
function dynamicKeys(): string[] {
  const keys: string[] = [];
  for (const type of unionMembers('src/lib/types.ts', 'AccountType')) {
    keys.push(`wizard.type.${type}`);
  }
  for (const reason of unionMembers('src/lib/bg/pqc-handlers.ts', 'PqcBlockReason')) {
    keys.push(`pqc.reason.${reason}`);
  }
  for (const decision of constArrayMembers('src/domain/permissions/permissionRules.ts', 'DECISIONS')) {
    keys.push(`perms.${decision}`);
  }
  return keys;
}

/** Every `t('literal')` / `t("literal")` in the source tree, with where it came from. */
function literalKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, src] of SOURCES) {
    for (const m of src.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
      const key = m[1];
      const where = file.slice(ROOT.length + 1);
      const list = found.get(key) || [];
      if (!list.includes(where)) list.push(where);
      found.set(key, list);
    }
  }
  return found;
}

const LITERAL = literalKeys();
const DYNAMIC = dynamicKeys();
const REQUIRED = [...new Set([...LITERAL.keys(), ...DYNAMIC])];

/** `{name}` interpolations in a string. */
function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

describe('i18n -- every key the source asks for', () => {
  it('finds a meaningful number of keys to check', () => {
    // Guards the scanner itself: a regex that silently matches nothing would
    // make every assertion below vacuously true.
    assert.ok(LITERAL.size > 200, `only found ${LITERAL.size} literal t() keys — the scan is broken`);
    assert.ok(DYNAMIC.length >= 10, `only enumerated ${DYNAMIC.length} dynamic keys`);
  });

  for (const loc of LOCALES) {
    it(`${loc} defines every key the code uses`, () => {
      const cat = CATALOGUES[loc];
      const missing = REQUIRED.filter((k) => typeof cat[k] !== 'string')
        .map((k) => {
          const where = LITERAL.get(k);
          return where ? `${k}  (${where.join(', ')})` : `${k}  (built dynamically)`;
        });

      assert.deepEqual(missing, [], `${loc}.json is missing keys the UI renders:\n  ${missing.join('\n  ')}`);
    });
  }
});

describe('i18n -- placeholder parity', () => {
  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    it(`${loc} keeps every {placeholder} en has`, () => {
      const en = CATALOGUES.en;
      const cat = CATALOGUES[loc];
      const dropped: string[] = [];

      for (const key of REQUIRED) {
        const enValue = en[key];
        const value = cat[key];
        if (typeof enValue !== 'string' || typeof value !== 'string') continue;
        const want = placeholders(enValue);
        const got = placeholders(value);
        for (const p of want) {
          // A dropped placeholder is not cosmetic: it silently removes the
          // information the sentence exists to convey — which address is being
          // published, how many of a thing there are.
          if (!got.has(p)) dropped.push(`${key}: {${p}}`);
        }
      }

      assert.deepEqual(dropped, [], `${loc}.json drops placeholders:\n  ${dropped.join('\n  ')}`);
    });
  }
});
