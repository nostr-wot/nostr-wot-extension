/**
 * Derived-mode passkey keys through the published identity SDK candidate.
 *
 *   prf_input = SHA-256(UTF-8(salt_label))
 *   secret    = HKDF-SHA256(ikm = PRF(prf_input), salt = prf_input, info = UTF-8(info_label), 32)
 *
 * A zero or out-of-range scalar fails; there is no retry with another input, so every
 * implementation agrees on the key or on the failure.
 *
 * @module lib/crypto/passkeyDerived
 */

import { deriveNostrKey, derivedPrfInput as sdkDerivedPrfInput } from '@nostr-wot/identity/vault';
import { DERIVED_PARAMETER_SETS, type DerivedParameterSet } from '@constants/passkey.ts';
import { N } from '@constants/crypto/secp256k1.ts';
import { bytesToHex } from './utils.ts';
import { getPublicKey } from './secp256k1.ts';

export function isDerivedParameterSet(value: unknown): value is DerivedParameterSet {
  return typeof value === 'number' && Object.prototype.hasOwnProperty.call(DERIVED_PARAMETER_SETS, value);
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
  if (!isDerivedParameterSet(set)) throw new Error('Unsupported passkey parameter set');
  return sdkDerivedPrfInput({ id: set, ...DERIVED_PARAMETER_SETS[set] });
}

/**
 * Turn a 32-byte PRF output into the secp256k1 private key. The caller owns both
 * buffers and must zero them; this function zeroes only its own intermediates.
 */
export function deriveDerivedPasskeyKey(prfOutput: Uint8Array, set: DerivedParameterSet): Uint8Array {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) throw new Error('Invalid passkey PRF output');
  if (!isDerivedParameterSet(set)) throw new Error('Unsupported passkey parameter set');
  return deriveNostrKey(prfOutput, { id: set, ...DERIVED_PARAMETER_SETS[set] }).secret;
}

/** Public key (x-only hex) for a derived secret, without keeping any copy of the secret. */
export function derivedPasskeyPubkey(secret: Uint8Array): string {
  return bytesToHex(getPublicKey(secret));
}
