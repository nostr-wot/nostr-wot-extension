/**
 * Every `var(--x)` the stylesheets use actually resolves.
 *
 * CSS fails silently in a particular way: a `var()` naming an undefined custom
 * property with no fallback makes the whole declaration invalid at computed-value
 * time, and the property is simply dropped. Nothing warns, the build is green,
 * and a colour is just missing — `background: var(--bg-card)` renders transparent.
 * With a fallback it is quieter still: the fallback becomes the real value, so the
 * token looks adopted while the palette has no say over it, and two files reaching
 * for the same idea drift apart (`var(--danger, #ef4444)` next to
 * `var(--danger, #dc2626)`).
 *
 * Both are invisible to typecheck and to the build, which is why this is a test.
 *
 * Run with:
 *   node --import tsx --test tests/theme-tokens.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const THEME = join(ROOT, 'src', 'styles', 'theme.css');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (extname(entry) === '.css') out.push(full);
  }
  return out;
}

const FILES = cssFiles(join(ROOT, 'src'));

/** Custom properties defined anywhere in the stylesheets. */
function defined(): Set<string> {
  const names = new Set<string>();
  for (const f of FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

/** Every `var(--x…)` reference, with the file it appears in and whether it has a fallback. */
function references(): Array<{ name: string; file: string; hasFallback: boolean }> {
  const refs: Array<{ name: string; file: string; hasFallback: boolean }> = [];
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      refs.push({ name: m[1], file: f.slice(ROOT.length + 1), hasFallback: !!m[2] });
    }
  }
  return refs;
}

const DEFINED = defined();
const REFS = references();

describe('theme tokens', () => {
  it('finds tokens to check', () => {
    // Guards the scan itself — a regex matching nothing would make the rest
    // vacuous. This is NOT a floor on how many stylesheets should exist: the
    // migration deletes a .module.css as soon as every declaration in it
    // becomes a utility, so the count drops by design and any threshold tuned
    // to today's number fails for the right reason at the wrong time. What
    // actually proves the scan is reading something is the var() and
    // definition counts below, which live in theme.css and tailwind.css.
    assert.ok(FILES.length > 3, `only found ${FILES.length} stylesheets`);
    assert.ok(REFS.length > 50, `only found ${REFS.length} var() references`);
    assert.ok(DEFINED.size > 15, `only found ${DEFINED.size} definitions`);
  });

  it('every var() names a property the stylesheets define', () => {
    const unresolved = [...new Set(
      REFS.filter((r) => !DEFINED.has(r.name))
        .map((r) => `${r.name}  (${r.hasFallback ? 'falls back' : 'RESOLVES TO NOTHING'}, e.g. ${r.file})`),
    )].sort();

    assert.deepEqual(
      unresolved,
      [],
      `these var() references name properties nothing defines:\n  ${unresolved.join('\n  ')}`,
    );
  });

  it('no declaration is malformed by a stray bracket', () => {
    // `color: var(--danger));` parses as garbage and the browser drops the
    // whole declaration — silently, with the var() itself perfectly valid, so
    // the resolution check above sails past it. Six of these were live at once:
    // one rule had both its declarations dropped and therefore did nothing at
    // all, while looking entirely reasonable in the file.
    const broken: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      // Blank out comments across the whole file rather than per line, so a
      // comment that spans lines cannot leave its tail looking like code. A
      // single-line pass flagged prose that merely quoted `var(--card-bg))`
      // while explaining this very bug, and the fix taken at the time was to
      // reword the comment — which is the test dictating how code may be
      // described. Same-width blanks keep the line numbers honest.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
      code.split('\n').forEach((line, i) => {
        if (/var\(\s*--[a-zA-Z0-9-]+\s*\)\s*\)/.test(line)) {
          broken.push(`${f.slice(ROOT.length + 1)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(broken, [], `unbalanced brackets around var():\n  ${broken.join('\n  ')}`);
  });

  it('theme.css is where the palette lives', () => {
    // Not a style rule for its own sake: tokens defined inside a component's
    // module are scoped to that component, so a second component reaching for
    // the same name silently gets nothing.
    const themeDefined = new Set(
      [...readFileSync(THEME, 'utf8').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const shared = REFS.filter((r) => {
      const uses = new Set(REFS.filter((o) => o.name === r.name).map((o) => o.file));
      return uses.size > 1;
    });
    const orphans = [...new Set(
      shared.filter((r) => !themeDefined.has(r.name)).map((r) => r.name),
    )].sort();

    assert.deepEqual(orphans, [], `used by more than one stylesheet but not defined in theme.css:\n  ${orphans.join('\n  ')}`);
  });
});

describe('tailwind token mapping', () => {
  const TAILWIND = join(ROOT, 'src', 'styles', 'tailwind.css');

  /** Follow a `var(--x)` chain down to the literal it ends at. */
  function resolve(value: string, defs: Map<string, string>, depth = 0): string {
    if (depth > 5) return value;
    const m = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value.trim());
    return m && defs.has(m[1]) ? resolve(defs.get(m[1])!, defs, depth + 1) : value.trim();
  }

  it('every mapping uses a namespace Tailwind actually reads', () => {
    // The second silent failure of this shape. `--duration-fast` looked
    // obviously right and generated nothing at all: Tailwind reads
    // `--transition-duration-*` for the `duration-*` utility, so the mapping
    // compiled, raised no error, and simply produced no class. A namespace
    // Tailwind does not know is not a warning — it is an inert declaration.
    const NAMESPACES = [
      'color', 'font', 'text', 'font-weight', 'tracking', 'leading', 'breakpoint',
      'container', 'radius', 'shadow', 'inset-shadow', 'drop-shadow', 'blur',
      'perspective', 'aspect', 'ease', 'animate', 'transition-duration',
      'transition-timing-function', 'z-index',
    ];
    // Single-value settings rather than namespaces.
    const SINGLES = ['--spacing', '--default-transition-duration', '--default-font-family'];

    const src = readFileSync(join(ROOT, 'src', 'styles', 'tailwind.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const theme = /@theme[^{]*\{([\s\S]*)\}/.exec(src);
    assert.ok(theme, 'no @theme block found — has the file moved?');

    const unknown: string[] = [];
    for (const m of theme![1].matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
      const name = m[1];
      if (SINGLES.includes(name)) continue;
      // `--text-*: initial` and friends clear a namespace; same rules apply.
      const bare = name.replace(/-\*$/, '');
      if (!NAMESPACES.some((ns) => bare === `--${ns}` || bare.startsWith(`--${ns}-`))) {
        unknown.push(name);
      }
    }
    assert.deepEqual(
      unknown,
      [],
      `these map into a namespace Tailwind does not read, so they generate no utility:\n  ${unknown.join('\n  ')}`,
    );
  });

  it('every token mapped into --color-* is actually a colour', () => {
    // A Tailwind colour utility only ever emits `background-color` (or
    // `color`, or `border-color`). Mapping a gradient — --bg-page is a
    // linear-gradient — produces `background-color: linear-gradient(...)`,
    // which is invalid and dropped: the surface renders with no background at
    // all, with nothing in the build or the typecheck to say so. Use
    // `[background:var(--bg-page)]` for those.
    const theme = readFileSync(THEME, 'utf8');
    const defs = new Map<string, string>();
    for (const m of theme.matchAll(/^\s*(--[a-zA-Z0-9-]+):\s*([^;]+);/gm)) defs.set(m[1], m[2]);

    const bad: string[] = [];
    for (const m of readFileSync(TAILWIND, 'utf8').matchAll(/(--color-[a-z-]+):\s*var\((--[a-zA-Z0-9-]+)\);/g)) {
      const literal = resolve(`var(${m[2]})`, defs);
      if (!/^(#|rgba?\(|hsla?\(|transparent|currentColor)/.test(literal)) {
        bad.push(`${m[1]} <- ${m[2]} = ${literal}`);
      }
    }
    assert.deepEqual(bad, [], `mapped as a colour but is not one:\n  ${bad.join('\n  ')}`);
  });
});

describe('theme contrast', () => {
  /** Relative luminance per WCAG 2.x. */
  function luminance(r: number, g: number, b: number): number {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function ratio(fg: [number, number, number], bg: [number, number, number]): number {
    const a = luminance(...fg);
    const b = luminance(...bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /** Flatten `rgba(0,0,0,a)` over an opaque background. */
  function overWhite(alpha: number): [number, number, number] {
    const v = Math.round(255 * (1 - alpha));
    return [v, v, v];
  }

  function tokenAlpha(name: string): number {
    const src = readFileSync(THEME, 'utf8');
    const m = new RegExp(`${name}:\\s*rgba\\(0,\\s*0,\\s*0,\\s*([0-9.]+)\\)`).exec(src);
    assert.ok(m, `${name} is not an rgba(0,0,0,a) token any more — update this test`);
    return Number(m![1]);
  }

  const WHITE: [number, number, number] = [255, 255, 255];

  it('--text-secondary meets AA for body text on the page background', () => {
    const r = ratio(overWhite(tokenAlpha('--text-secondary')), WHITE);
    assert.ok(r >= 4.5, `--text-secondary is ${r.toFixed(2)}:1 against white, AA wants 4.5:1`);
  });

  it('--text-muted meets at least the large-text threshold', () => {
    // Deliberately 3:1 and not 4.5:1. Muted exists to sit visibly below
    // secondary in the hierarchy; raising both to 4.5 makes them the same
    // colour and destroys the distinction the token is for.
    const r = ratio(overWhite(tokenAlpha('--text-muted')), WHITE);
    assert.ok(r >= 3, `--text-muted is ${r.toFixed(2)}:1 against white, want at least 3:1`);
  });

  it('--text-muted stays visibly lighter than --text-secondary', () => {
    assert.ok(
      tokenAlpha('--text-muted') < tokenAlpha('--text-secondary') - 0.05,
      'the two must remain distinguishable, or the hierarchy is decorative only',
    );
  });
});
