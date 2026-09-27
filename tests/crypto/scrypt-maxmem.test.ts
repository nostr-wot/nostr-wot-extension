/**
 * The scrypt `maxmem` bound must clear what the installed `@noble/hashes` actually
 * requires — whatever version that is, including versions that did not exist when this
 * was written.
 *
 * `nip49.ts` used to pass `128 * r * (N + p)`, character for character the expression
 * `@noble/hashes` 2.0.1 validates against. From 2.2.0 noble validates against
 * `128 * r * (N + p + 1)`, counting a scratch block it had always allocated, and
 * `package.json` declared `^2.0.1`, which admits 2.2.0 through 2.4.0. A bound sitting
 * exactly on the old line is therefore one block short of what those versions charge,
 * and every ncryptsec encode and decode throws `"maxmem" limit was hit` — the NIP-49
 * encrypted-key backup and import path, dead, for any build resolved from the declared
 * range rather than from the committed lockfile.
 *
 * The NIP-49 suite could not see it: every test there runs scrypt through whatever
 * version the lockfile pinned, so all of them agree with any bound that version
 * tolerates, including a wrong one.
 *
 * So the load-bearing assertion here does not restate any version's expression — that
 * would just move the coupling one version along, and would still be blind to a 2.5 that
 * raises the charge again. It **asks the installed library**, by binary-searching the
 * smallest `maxmem` it will accept at a cheap cost factor, and requires our bound to
 * clear it with room to spare. A future noble that charges more is discovered rather
 * than assumed.
 *
 * The ceiling matters too, in the other direction. Headroom is only free while it stays
 * a handful of fixed blocks: slack that scaled with `N` would quietly authorise a
 * multiple of the V table, and `logN` comes from the payload. So the bound is pinned
 * inside a window — above what the library needs, below `N + p + SLACK` blocks.
 *
 * Run with:
 *   node --import tsx --test tests/crypto/scrypt-maxmem.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { scryptMaxMem } from '../../src/lib/crypto/nip49.ts';
import {
  DEFAULT_LOG_N,
  MAX_LOG_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_MAXMEM_SLACK_BLOCKS,
} from '../../src/constants/crypto/nip49.ts';

const BLOCK_SIZE = 128 * SCRYPT_R;

/** Both ends of the range the decoder accepts, the cost the encoder writes, and a spread between. */
const LOG_N_VALUES = [1, 2, 8, 14, DEFAULT_LOG_N, 20, MAX_LOG_N];

/** Costs cheap enough to actually run scrypt against, repeatedly, in a unit test. */
const PROBE_LOG_N_VALUES = [1, 2, 8, 10];

/**
 * The smallest `maxmem` the installed `@noble/hashes` accepts for these parameters,
 * found by binary search.
 *
 * This is the independent oracle. It reads no version number and restates no formula:
 * it discovers the library's requirement by observing which values it refuses, so it
 * reports 128·r·(N+p) on 2.0.1 and 128·r·(N+p+1) on 2.2.0 onwards without being told
 * that either is the case — and would report a higher figure, and fail the assertions
 * below, on a release that charges more.
 *
 * Only `maxmem` rejections count as a refusal; any other error is a real failure and is
 * rethrown rather than silently widening the search.
 */
async function smallestAcceptedMaxmem(logN: number): Promise<number> {
  const N = 2 ** logN;
  const accepts = async (maxmem: number): Promise<boolean> => {
    try {
      await scryptAsync(new Uint8Array(2), new Uint8Array(16), {
        N, r: SCRYPT_R, p: SCRYPT_P, dkLen: 32, maxmem,
      });
      return true;
    } catch (e) {
      if (e instanceof Error && /maxmem/.test(e.message)) return false;
      throw e;
    }
  };

  // Generous ceiling for the search: if even this is refused, the assumption that
  // `maxmem` is what gates the call is wrong and the test should say so, not loop.
  let lo = 0;
  let hi = BLOCK_SIZE * (N + SCRYPT_P + 64);
  assert.ok(await accepts(hi), `installed @noble/hashes refused maxmem ${hi} at log_n ${logN}`);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await accepts(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

describe('scrypt maxmem accounting', () => {
  it('clears what the installed @noble/hashes actually requires', async () => {
    // The assertion that would have caught the regression, and that will catch the next
    // one: no version, expression or release date appears in it.
    for (const logN of PROBE_LOG_N_VALUES) {
      const required = await smallestAcceptedMaxmem(logN);
      assert.ok(
        scryptMaxMem(logN) >= required,
        `log_n ${logN}: installed @noble/hashes requires maxmem >= ${required}, bound is ${scryptMaxMem(logN)}`
      );
    }
  });

  it('keeps headroom above that requirement rather than sitting on it', async () => {
    // Being exactly right for the installed version is how this broke, so sitting on the
    // line fails here even when the line is today's. Strictly positive headroom is the
    // contract, deliberately not "most of SLACK": this assertion is an early warning, and
    // it should go red when the headroom is spent rather than once users are broken. A
    // noble that charged one more block than this leaves spare would trip it while
    // `scryptMaxMem` still worked, which is the moment to raise SCRYPT_MAXMEM_SLACK_BLOCKS.
    for (const logN of PROBE_LOG_N_VALUES) {
      const required = await smallestAcceptedMaxmem(logN);
      const spare = (scryptMaxMem(logN) - required) / BLOCK_SIZE;
      assert.ok(
        spare >= 1,
        `log_n ${logN}: bound ${scryptMaxMem(logN)} sits on the installed library's requirement `
          + `(${required}) with ${spare} blocks spare — raise SCRYPT_MAXMEM_SLACK_BLOCKS`
      );
      assert.ok(
        spare <= SCRYPT_MAXMEM_SLACK_BLOCKS,
        `log_n ${logN}: ${spare} blocks spare exceeds the ${SCRYPT_MAXMEM_SLACK_BLOCKS} budgeted`
      );
    }
  });

  it('stays within a fixed number of blocks of what the algorithm needs', () => {
    // The ceiling. Headroom is free only while it is a small constant: slack that grew
    // with N would authorise a multiple of the V table, and log_n is attacker-supplied.
    for (const logN of LOG_N_VALUES) {
      const algorithmNeeds = BLOCK_SIZE * (2 ** logN + SCRYPT_P);
      const ceiling = algorithmNeeds + BLOCK_SIZE * SCRYPT_MAXMEM_SLACK_BLOCKS;
      assert.ok(
        scryptMaxMem(logN) <= ceiling,
        `log_n ${logN}: bound ${scryptMaxMem(logN)} exceeds N + p + ${SCRYPT_MAXMEM_SLACK_BLOCKS} blocks (${ceiling})`
      );
      assert.ok(
        scryptMaxMem(logN) >= algorithmNeeds,
        `log_n ${logN}: bound ${scryptMaxMem(logN)} is below the V table and B block the algorithm needs (${algorithmNeeds})`
      );
    }
  });

  it('rejects the formula that shipped broken, at every cost factor', () => {
    // The specific regression, pinned so it cannot come back: `128*r*(N+p)` was 2.0.1's
    // expression and is the floor the bound must stay strictly above. Unlike the probe
    // this names an expression, so it is a regression pin rather than the contract.
    for (const logN of LOG_N_VALUES) {
      const shippedBroken = BLOCK_SIZE * (2 ** logN + SCRYPT_P);
      assert.ok(
        scryptMaxMem(logN) > shippedBroken,
        `log_n ${logN}: bound is back on the 2.0.1 line (${shippedBroken}), which throws from 2.2.0 onwards`
      );
    }
  });

  it('is the bound the NIP-49 derivation actually passes to scrypt', () => {
    // A correct helper that nothing calls is worth nothing, and this file could not see
    // the difference: reverting `deriveScryptKey` to the old inline expression while
    // leaving `scryptMaxMem` intact left every assertion here green, because none of them
    // touch the call site. `nip49.test.ts` catches it, but only on 2.2.0 and later — on
    // the pinned 2.0.1 a call-site regression ships green.
    //
    // Reading the source is a blunt instrument, and deliberate: the alternative is to
    // reach into a module namespace to spy on `scryptAsync`, which is exactly the kind of
    // library-shape coupling this whole file exists to argue against. The repo already
    // tests source and generated assets this way — see tests/test-registration.test.ts.
    const source = readFileSync(
      new URL('../../src/lib/crypto/nip49.ts', import.meta.url), 'utf8'
    );
    assert.match(
      source,
      /maxmem:\s*scryptMaxMem\(/,
      'deriveScryptKey must pass scryptMaxMem(logN) as maxmem, not an inline expression'
    );
    assert.doesNotMatch(
      source,
      /maxmem:\s*128\s*\*/,
      'maxmem is being computed inline again instead of going through scryptMaxMem'
    );
  });

  it('derives the key the NIP-49 encoder needs at the cost it writes', async () => {
    // End to end at the real cost factor, with the real bound.
    const key = await scryptAsync(new TextEncoder().encode('pw'), new Uint8Array(16), {
      N: 1 << DEFAULT_LOG_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: 32,
      maxmem: scryptMaxMem(DEFAULT_LOG_N),
    });
    assert.equal(key.length, 32);
  });

  it('scales with the cost factor rather than being fixed', () => {
    // A constant would pass the round-trip tests while refusing a legitimate
    // higher-cost backup from another client.
    for (let logN = 2; logN <= MAX_LOG_N; logN++) {
      assert.ok(
        scryptMaxMem(logN) > scryptMaxMem(logN - 1),
        `log_n ${logN}: bound must grow with N`
      );
    }
  });

  it('is 67,113,984 bytes at the cost the encoder writes (log_n 16, r 8, p 1)', () => {
    // 64 MiB of V table, one 1 KiB B block, four 1 KiB blocks of headroom. Recorded so
    // the number is reviewable, and as documentation of the scale involved.
    assert.equal(scryptMaxMem(DEFAULT_LOG_N), 67_108_864 + 1_024 + 4 * 1_024);
    assert.equal(scryptMaxMem(DEFAULT_LOG_N), 67_113_984);
  });
});
