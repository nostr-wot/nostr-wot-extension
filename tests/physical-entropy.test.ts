/**
 * Coin flips and dice rolls become the same seed any offline tool would derive.
 *
 * Run with:
 *   node --import tsx --test tests/physical-entropy.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ENTROPY_PROGRESS_TTL_MS, PHYSICAL_ENTROPY_REQUIRED, isPhysicalResult, physicalEntropyBits, physicalEntropyBytes, restoreEntropyProgress,
} from '../src/domain/accounts/physicalEntropy.ts';
import { entropyToMnemonic } from '../src/lib/crypto/bip39.ts';
import { adjacentFaces } from '../src/screens/Wizard/EntropyGame/EntropyArt.tsx';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('coin flips', () => {
  it('are the BIP-39 entropy bits, most significant first', async () => {
    const zeros = new Array(256).fill(0);
    assert.equal(await entropyToMnemonic(physicalEntropyBytes('coin', zeros)), `${'abandon '.repeat(23)}art`);
    const ones = new Array(256).fill(1);
    assert.equal(await entropyToMnemonic(physicalEntropyBytes('coin', ones)), `${'zoo '.repeat(23)}vote`);
    const firstBit = [1, ...new Array(255).fill(0)];
    assert.equal(hex(physicalEntropyBytes('coin', firstBit)).slice(0, 2), '80');
    const lastBit = [...new Array(255).fill(0), 1];
    assert.equal(hex(physicalEntropyBytes('coin', lastBit)).slice(-2), '01');
  });
});

describe('dice rolls', () => {
  it('hash the digit string with SHA-256, like Coldcard', () => {
    const rolls = Array.from({ length: 100 }, (_, i) => (i % 6) + 1);
    const expected = createHash('sha256').update(rolls.join('')).digest('hex');
    assert.equal(hex(physicalEntropyBytes('dice', rolls)), expected);
  });

  it('need enough rolls to cover 256 bits', () => {
    assert.ok(PHYSICAL_ENTROPY_REQUIRED.dice * Math.log2(6) >= 256);
    assert.ok((PHYSICAL_ENTROPY_REQUIRED.dice - 1) * Math.log2(6) < 256);
  });
});

describe('validation', () => {
  it('rejects a short, long or tampered list', () => {
    assert.throws(() => physicalEntropyBytes('coin', new Array(255).fill(0)), /Expected 256/);
    assert.throws(() => physicalEntropyBytes('dice', new Array(101).fill(1)), /Expected 100/);
    assert.throws(() => physicalEntropyBytes('dice', [...new Array(99).fill(1), 7]), /Invalid result/);
    assert.throws(() => physicalEntropyBytes('coin', [...new Array(255).fill(0), '1']), /Invalid result/);
    assert.throws(() => physicalEntropyBytes('d20' as never, []), /Unknown entropy source/);
  });

  it('knows each source’s faces', () => {
    assert.equal(isPhysicalResult('coin', 1), true);
    assert.equal(isPhysicalResult('coin', 2), false);
    assert.equal(isPhysicalResult('dice', 0), false);
    assert.equal(isPhysicalResult('dice', 6), true);
  });

  it('counts collected bits up to the target', () => {
    assert.equal(physicalEntropyBits('coin', 10), 10);
    assert.equal(physicalEntropyBits('dice', 10), 25);
    assert.equal(physicalEntropyBits('dice', 100), 256);
    assert.equal(physicalEntropyBits('coin', 300), 256);
  });
});

describe('restoreEntropyProgress', () => {
  const now = 1_000_000;
  it('restores fresh, well-formed progress', () => {
    assert.deepEqual(restoreEntropyProgress({ kind: 'dice', results: [1, 6, 3], ts: now - 1000 }, now), { kind: 'dice', results: [1, 6, 3] });
  });

  it('drops stale, malformed or overfull progress', () => {
    assert.equal(restoreEntropyProgress({ kind: 'dice', results: [1], ts: now - ENTROPY_PROGRESS_TTL_MS }, now), null);
    assert.equal(restoreEntropyProgress({ kind: 'coin', results: [0, 2], ts: now }, now), null);
    assert.equal(restoreEntropyProgress({ kind: 'coin', results: new Array(257).fill(1), ts: now }, now), null);
    assert.equal(restoreEntropyProgress({ kind: 'd20', results: [], ts: now }, now), null);
    assert.equal(restoreEntropyProgress(undefined, now), null);
  });
});

describe('die art', () => {
  it('shows faces that are adjacent on a real die', () => {
    for (let front = 1; front <= 6; front++) {
      const [top, right] = adjacentFaces(front);
      for (const [a, b] of [[front, top], [front, right], [top, right]]) {
        assert.notEqual(a, b);
        assert.notEqual(a + b, 7);
      }
    }
  });
});
