/**
 * Derived-mode passkey keys (nips/passkey/01-passkey-key-modes.md, "Derived mode").
 *
 *   prf_input = SHA-256(UTF-8(salt_label))
 *   secret    = HKDF-SHA256(ikm = PRF(prf_input), salt = prf_input, info = UTF-8(info_label), 32)
 *
 * A zero or out-of-range scalar fails; there is no retry with another input, so every
 * implementation agrees on the key or on the failure.
 *
 * @module lib/crypto/passkeyDerived
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { DERIVED_PARAMETER_SETS, type DerivedParameterSet } from '@constants/passkey.ts';
import { N } from '@constants/crypto/secp256k1.ts';
import { bytesToHex, sha256 } from './utils.ts';
import { getPublicKey } from './secp256k1.ts';

export function isDerivedParameterSet(value: unknown): value is DerivedParameterSet {
  return typeof value === 'number' && Object.prototype.hasOwnProperty.call(DERIVED_PARAMETER_SETS, value);
}

function parameters(set: DerivedParameterSet) {
  if (!isDerivedParameterSet(set)) throw new Error('Unsupported passkey parameter set');
  return DERIVED_PARAMETER_SETS[set];
}

/** 0 < k < n, read big-endian. Out-of-range output is a failure, never a retry. */
export function isValidDerivedScalar(secret: Uint8Array): boolean {
  if (secret.length !== 32) return false;
  let scalar = 0n;
  for (const byte of secret) scalar = (scalar << 8n) | BigInt(byte);
  return scalar !== 0n && scalar < N;
}

/** The public PRF input a derived passkey is evaluated with. Not secret. */
export function derivedPrfInput(set: DerivedParameterSet): Uint8Array {
  return sha256(new TextEncoder().encode(parameters(set).saltLabel));
}

/**
 * Turn a 32-byte PRF output into the secp256k1 private key. The caller owns both
 * buffers and must zero them; this function zeroes only its own intermediates.
 */
export function deriveDerivedPasskeyKey(prfOutput: Uint8Array, set: DerivedParameterSet): Uint8Array {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error('Invalid passkey PRF output');
  const { infoLabel } = parameters(set);
  const salt = derivedPrfInput(set);
  const secret = hkdf(nobleSha256, prfOutput, salt, new TextEncoder().encode(infoLabel), 32);
  if (!isValidDerivedScalar(secret)) {
    secret.fill(0);
    throw new Error('This passkey produced an invalid key. It cannot be imported.');
  }
  return secret;
}

/** Public key (x-only hex) for a derived secret, without keeping any copy of the secret. */
export function derivedPasskeyPubkey(secret: Uint8Array): string {
  return bytesToHex(getPublicKey(secret));
}
