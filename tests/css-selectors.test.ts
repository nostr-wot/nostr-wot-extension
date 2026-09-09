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
import postcss from 'postcss';

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

describe('CSS cascade boundaries', () => {
  it('keeps reset spacing and decorative child positioning below utilities in the built CSS', () => {
    const assets = join(ROOT, 'dist/assets');
    const violations: string[] = [];
    let checked = 0;
    for (const file of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
      const css = postcss.parse(readFileSync(join(assets, file), 'utf8'));
      css.walkRules((rule) => {
        const reset = rule.selector.split(',').some((s) => s.trim() === '*');
        const decoration = /topoBg.*>\s*\*/.test(rule.selector);
        if (!reset && !decoration) return;
        rule.walkDecls((decl) => {
          if (decl.important || !['margin', 'padding', 'position', 'z-index'].includes(decl.prop)) return;
          checked++;
          let parent: postcss.Rule['parent'] | postcss.Root['parent'] = rule.parent;
          while (parent && !(parent.type === 'atrule' && parent.name === 'layer')) parent = parent.parent;
          if (!parent || parent.type !== 'atrule' || !['base', 'components'].includes(parent.params)) {
            violations.push(`${rule.selector}: ${decl.prop} overrides utility classes`);
          }
        });
      });
    }
    assert.ok(checked >= 4, 'must check the reset and decorative child rules in a current build');
    assert.deepEqual(violations, []);
  });
});

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

describe('CSS module references', () => {
  it('every styles.x names a class the stylesheet defines', () => {
    // The inverse of the check below, and the direction that actually loses
    // styling: `styles.permInfo` for a class that no longer exists is
    // `undefined`, so the element renders with no class at all. It is not a
    // type error — a CSS Module is typed as an index signature — and it is not
    // a build error. The permissions rows moving to ListRow took three classes
    // with them, and the declined-sites list below them quietly lost its
    // layout.
    const missing: string[] = [];

    for (const code of CODE.filter((f) => f.endsWith('.tsx'))) {
      // Comments mention class names while explaining why they are gone; a
      // scan that reads them reports the explanation as the bug.
      const src = readFileSync(code, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const imported = /import\s+(\w+)\s+from\s+'([^']*\.module\.css)'/.exec(src);
      if (!imported) continue;

      const cssPath = join(dirname(code), imported[2]);
      if (!STYLESHEETS.includes(cssPath)) continue;
      const defined = new Set(
        [...readFileSync(cssPath, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]),
      );

      for (const m of src.matchAll(new RegExp(`${imported[1]}\\.([a-zA-Z][\\w-]*)`, 'g'))) {
        if (!defined.has(m[1])) {
          missing.push(`${relative(ROOT, code)}  styles.${m[1]}  (not in ${basename(cssPath)})`);
        }
      }
    }

    assert.deepEqual(
      [...new Set(missing)].sort(),
      [],
      `these render as className={undefined} — the class was renamed or removed:\n  ${[...new Set(missing)].sort().join('\n  ')}`,
    );
  });
});

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

describe('packaged browser documents', () => {
  it('emits each entry document with resolvable scripts and styles', () => {
    const dist=join(ROOT,'dist');
    const manifest=JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
    for (const page of [manifest.action.default_popup,'src/entrypoints/onboarding/index.html','src/entrypoints/prompt/index.html']) {
      const html=readFileSync(join(dist,page),'utf8');
      const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]);
      assert.ok(assets.some(asset=>asset.endsWith('.js')), `${page}: missing mount script`);
      for (const asset of assets) assert.ok(statSync(join(asset.startsWith('/')?dist:dirname(join(dist,page)),asset)).isFile(),`${page}: ${asset}`);
    }
  });
});


describe('welcome screen ownership', () => {
  it('keeps welcome content in screens and document flow in the onboarding shell', () => {
    const screen=readFileSync(join(ROOT,'src/screens/Wizard/WelcomeStep.tsx'),'utf8');
    const shell=readFileSync(join(ROOT,'src/entrypoints/onboarding/OnboardingApp.tsx'),'utf8');
    assert.match(screen,/onboarding.title/);
    assert.match(screen,/onboarding.subtitle/);
    assert.match(screen,/<Button[^>]*onClick=\{onStart\}/);
    assert.match(shell,/<WelcomeStep onStart=/);
    assert.doesNotMatch(screen,/useWizardFlow|rpcNotify|window.close/);
  });
});
