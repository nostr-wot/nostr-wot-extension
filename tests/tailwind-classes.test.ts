/**
 * Every Tailwind utility the source names actually generates a rule.
 *
 * A misspelled utility is silent. `text-secondry`, `rounded-pannel`, a colour
 * that was never mapped — none of them is a TypeScript error, none breaks the
 * build, and none appears in the output. The element simply renders without
 * that style, and the only way to notice is to look at the screen.
 *
 * That risk arrived with the migration off CSS Modules, where a typo in
 * `styles.foo` was at least `undefined` and visibly wrong. It is worth a test
 * precisely because utilities are strings the compiler never sees.
 *
 * Scope, deliberately narrow: static class lists only. A class name assembled
 * at runtime cannot be checked here, which is one more reason to prefer whole
 * strings picked by a condition over fragments concatenated together.
 *
 * Requires `npm run build` first — it reads the generated stylesheets.
 *
 * Run with:
 *   npm run build && node --import tsx --test tests/tailwind-classes.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'assets');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

/**
 * Tailwind escapes CSS-special characters in its selectors, and the exact set
 * is not worth reproducing: an incomplete list makes the test report a class
 * that is present, which is the failure mode that gets a test switched off.
 * `z-[calc(var(--z-sheet)+1)]` did exactly that — the `+` was not in the list.
 *
 * So compare against the stylesheet with every backslash stripped, and look
 * for the class verbatim.
 */
function selectorFor(cls: string): string {
  return `.${cls}`;
}

interface Candidate { cls: string; file: string; }

/**
 * A second net under the extraction above. A utility is lowercase and carries a
 * modifier, a value, or a bracket; the bare words that survive are the handful
 * of standalone ones. Without this, any sentence that reached the extractor
 * would be reported as a pile of missing classes, and a test that cries wolf
 * gets deleted rather than fixed.
 */
const BARE = new Set([
  'flex', 'grid', 'block', 'inline', 'hidden', 'relative', 'absolute', 'fixed',
  'sticky', 'static', 'truncate', 'italic', 'uppercase', 'lowercase', 'capitalize',
  'underline', 'border', 'rounded', 'shadow', 'container', 'isolate', 'contents',
  'transition', 'invisible', 'visible', 'resize',
]);

/**
 * A `:` only means a variant when what precedes it IS one. Without this list,
 * `npm run pqc:keygen` in a help string reads as a utility with a `pqc:`
 * variant, and the test reports a missing class that was never a class.
 */
const VARIANTS = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target',
  'disabled', 'enabled', 'checked', 'required', 'invalid', 'placeholder', 'selection',
  'first', 'last', 'only', 'odd', 'even', 'empty', 'before', 'after', 'file', 'marker',
  'dark', 'motion-safe', 'motion-reduce', 'print', 'rtl', 'ltr', 'open',
  'sm', 'md', 'lg', 'xl', '2xl', 'max-sm', 'max-md', 'max-lg',
]);

function isVariant(part: string): boolean {
  return (
    VARIANTS.has(part) ||
    /^(group|peer)-/.test(part) ||
    /^(aria|data|supports|has|not|nth)-/.test(part) ||
    /^\[.*\]$/.test(part)
  );
}

function looksLikeUtility(cls: string): boolean {
  if (/[A-Z\s]/.test(cls)) return false;
  const parts = cls.split(':');
  const base = parts.pop()!;
  if (!parts.every(isVariant)) return false;
  if (BARE.has(base)) return true;
  // A utility carries a value: a dash before something, or a bracket.
  return /^-?[a-z][a-z0-9]*(?:-[a-z0-9[]|\[)/.test(base);
}

/**
 * Static class lists: `className="…"`, `className={`…`}`, and the UPPER_CASE
 * constants components use to keep a long list out of the JSX. Interpolations
 * are blanked rather than parsed — what is inside them is not static.
 *
 * A literal with only one token is skipped: those are overwhelmingly ids,
 * attribute names and enum values (`'site-permissions'`), not class lists.
 */
function candidates(): Candidate[] {
  const found: Candidate[] = [];
  for (const file of walk(join(ROOT, 'src')).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const literals: string[] = [];

    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
      literals.push(m[1] ?? m[2] ?? m[3] ?? '');
    }
    // Every UPPER_CASE constant, taken as a whole declaration rather than a
    // single line. Two earlier versions of this scan each missed a planted
    // typo: one matched on the constant's NAME and so skipped `UNSELECTED`,
    // and one stopped at the first newline and so skipped every multi-line
    // class list — which is most of them, since a long list is exactly what
    // gets pulled out of the JSX. Both passed while naming a class that
    // produced no CSS, which is the failure this file exists to prevent.
    for (const m of src.matchAll(/^\s*(?:const\s+)?[A-Z][A-Z0-9_]*\s*[:=][\s\S]*?;\s*$/gm)) {
      for (const lit of m[0].matchAll(/'([^']*)'|`([^`]*)`/g)) {
        literals.push(lit[1] ?? lit[2] ?? '');
      }
    }

    for (const raw of literals) {
      const lit = raw.replace(/\$\{[^}]*\}/g, ' ');
      const tokens = lit.split(/\s+/).filter(Boolean);
      if (tokens.length < 2) continue;
      for (const cls of tokens) if (looksLikeUtility(cls)) found.push({ cls, file: rel });
    }
  }
  return found;
}

describe('tailwind utilities', () => {
  const built = existsSync(DIST)
    ? readdirSync(DIST)
        .filter((f) => f.endsWith('.css'))
        .map((f) => readFileSync(join(DIST, f), 'utf8'))
        .join('\n')
        .replace(/\\/g, '')
    : '';

  it('has a build to check against', () => {
    // Without this the whole suite passes vacuously on a clean checkout, which
    // is worse than failing: it reports "no missing utilities" having looked at
    // nothing.
    assert.ok(built.length > 1000, 'run `npm run build` first — no generated CSS found in dist/assets');
    assert.ok(built.includes('tailwindcss v4'), 'the built CSS does not look like Tailwind output');
  });

  it('every static utility named in the source generates a rule', () => {
    const missing = candidates()
      .filter(({ cls }) => !built.includes(selectorFor(cls)))
      .map(({ cls, file }) => `${cls}  (${file})`);

    assert.deepEqual(
      [...new Set(missing)].sort(),
      [],
      `these class names produce no CSS — a typo, or a token that was never mapped:\n  ${[...new Set(missing)].sort().join('\n  ')}`,
    );
  });
});
