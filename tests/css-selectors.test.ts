/**
 * Every class named in a stylesheet selector must be one that some component
 * actually puts on an element.
 *
 * This catches a failure with no build error, no runtime warning, and no visible
 * symptom until someone looks at the screen. Extracting repeated markup into a
 * component moves it into a new CSS Module scope, so a descendant selector left
 * behind in the old stylesheet — `.mnemonicDisplayWide .mnemonicWord` — quietly
 * stops matching anything. It bit this refactor twice: once shrinking the
 * 24-word recovery grid, once styling a filled blank in the verify step. Both
 * times the rule was still there, still valid CSS, and applying to nothing.
 *
 * Deliberately narrow. It does not claim a class is unused (a stylesheet whose
 * component builds names dynamically cannot be judged statically); it claims
 * only that a name appearing in a selector is a name the code emits somewhere.
 *
 * Run with:
 *   node --import tsx --test tests/css-selectors.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const FILES = walk(join(ROOT, 'src'));
const STYLESHEETS = FILES.filter((f) => f.endsWith('.module.css'));
const CODE = FILES.filter((f) => ['.tsx', '.ts'].includes(extname(f)));

/** Class names appearing anywhere in a selector, not only at the start of one. */
function classesInSelectors(css: string): Set<string> {
  const out = new Set<string>();
  // Strip comments and declaration bodies, leaving selectors. @keyframes step
  // selectors (`from`, `50%`) carry no class names, so they fall out naturally.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of withoutComments.matchAll(/(^|\})([^{}]*)\{/g)) {
    const selector = m[2];
    if (selector.trimStart().startsWith('@')) continue; // at-rule preludes
    for (const c of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(c[1]);
  }
  return out;
}

describe('CSS module selectors', () => {
  it('names only classes the code puts on an element', () => {
    const orphans: string[] = [];

    for (const css of STYLESHEETS) {
      const name = basename(css);
      const importers = CODE.map((code) => {
        const src = readFileSync(code, 'utf8');
        const m = src.match(
          new RegExp(`import\\s+(\\w+)\\s+from\\s+'[^']*${name.replace(/\./g, '\\.')}'`),
        );
        return m ? { binding: m[1], src } : null;
      }).filter((x): x is { binding: string; src: string } => x !== null);

      // No importer at all is a different problem, and one this test would
      // report as dozens of orphans rather than the single fact it is.
      if (!importers.length) continue;

      // A component that builds class names from an expression cannot be
      // checked this way, and guessing would make the test lie.
      if (importers.some((i) => new RegExp(`${i.binding}\\[`).test(i.src))) continue;

      const emitted = new Set<string>();
      for (const { binding, src } of importers) {
        for (const m of src.matchAll(new RegExp(`${binding}\\.([a-zA-Z][\\w-]*)`, 'g'))) {
          emitted.add(m[1]);
        }
      }

      for (const c of classesInSelectors(readFileSync(css, 'utf8'))) {
        if (!emitted.has(c)) orphans.push(`${relative(ROOT, css)}  .${c}`);
      }
    }

    assert.deepEqual(
      orphans,
      [],
      `selectors naming a class nothing emits — the rule applies to nothing:\n  ${orphans.join('\n  ')}`,
    );
  });
});
