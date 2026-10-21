/**
 * Physical entropy: a recovery phrase from coin flips or dice rolls.
 *
 * The person, not the CSPRNG, supplies all 256 bits, so the result is checkable
 * offline with tools they already trust:
 *
 *   - coin: each flip is one bit, heads = 1, tails = 0, most significant bit
 *     first. 256 flips are the BIP-39 entropy verbatim (any "binary" BIP-39 tool
 *     reproduces the same 24 words).
 *   - dice: the faces are written as an ASCII digit string ("3514…") and hashed
 *     with SHA-256, the scheme Coldcard and SeedSigner use. A fair d6 carries
 *     log2(6) ≈ 2.585 bits, so 100 rolls (≈ 258.5 bits) are required to cover
 *     the 256-bit hash.
 *
 * Nothing here is mixed with machine randomness. That is deliberate: mixing would
 * make the phrase impossible to verify by hand, which is the point of rolling.
 *
 * @module domain/accounts/physicalEntropy
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { GENERATED_MNEMONIC_STRENGTH_BITS } from '@constants/accounts.ts';

export type PhysicalEntropyKind = 'coin' | 'dice';

/** Results needed per kind for a 256-bit (24-word) phrase. */
export const PHYSICAL_ENTROPY_REQUIRED: Record<PhysicalEntropyKind, number> = {
  coin: GENERATED_MNEMONIC_STRENGTH_BITS,
  dice: 100,
};

/** Bits of entropy one fair result carries. */
export const PHYSICAL_ENTROPY_BITS_PER_RESULT: Record<PhysicalEntropyKind, number> = {
  coin: 1,
  dice: Math.log2(6),
};

/** The faces a result may take. */
export const PHYSICAL_ENTROPY_FACES: Record<PhysicalEntropyKind, readonly number[]> = {
  coin: [0, 1],
  dice: [1, 2, 3, 4, 5, 6],
};

export function isPhysicalEntropyKind(value: unknown): value is PhysicalEntropyKind {
  return value === 'coin' || value === 'dice';
}

/** True when `value` is a face of `kind`. */
export function isPhysicalResult(kind: PhysicalEntropyKind, value: unknown): value is number {
  return typeof value === 'number' && PHYSICAL_ENTROPY_FACES[kind].includes(value);
}

/** Whole bits of entropy collected so far, never above the target. */
export function physicalEntropyBits(kind: PhysicalEntropyKind, count: number): number {
  return Math.min(GENERATED_MNEMONIC_STRENGTH_BITS, Math.floor(count * PHYSICAL_ENTROPY_BITS_PER_RESULT[kind]));
}

/**
 * Turn exactly the required number of results into 32 bytes of BIP-39 entropy.
 * Throws on a wrong count or an impossible face, so a short or tampered list
 * can never quietly become a weak key.
 */
export function physicalEntropyBytes(kind: PhysicalEntropyKind, results: readonly unknown[]): Uint8Array {
  if (!isPhysicalEntropyKind(kind)) throw new Error('Unknown entropy source');
  const required = PHYSICAL_ENTROPY_REQUIRED[kind];
  if (!Array.isArray(results) || results.length !== required) {
    throw new Error(`Expected ${required} results`);
  }
  if (!results.every((r) => isPhysicalResult(kind, r))) throw new Error('Invalid result');
  const values = results as number[];

  if (kind === 'dice') return sha256(new TextEncoder().encode(values.join('')));

  const bytes = new Uint8Array(GENERATED_MNEMONIC_STRENGTH_BITS / 8);
  values.forEach((bit, i) => { bytes[i >> 3] |= bit << (7 - (i & 7)); });
  return bytes;
}

/** How long recorded results stay restorable after the popup closes. */
export const ENTROPY_PROGRESS_TTL_MS = 30 * 60 * 1000;

export interface PhysicalEntropyProgress {
  kind: PhysicalEntropyKind;
  results: number[];
}

/** Restore saved progress, rejecting anything stale or malformed. */
export function restoreEntropyProgress(saved: unknown, now = Date.now()): PhysicalEntropyProgress | null {
  const data = saved as { kind?: unknown; results?: unknown; ts?: unknown } | undefined;
  if (!data || !isPhysicalEntropyKind(data.kind) || !Array.isArray(data.results)) return null;
  if (typeof data.ts !== 'number' || now - data.ts >= ENTROPY_PROGRESS_TTL_MS) return null;
  const kind = data.kind;
  if (data.results.length > PHYSICAL_ENTROPY_REQUIRED[kind] || !data.results.every((r) => isPhysicalResult(kind, r))) return null;
  return { kind, results: data.results as number[] };
}
