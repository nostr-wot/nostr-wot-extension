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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
});
