import { P } from '@constants/crypto/secp256k1.ts';

/**
 * secp256k1 — Thin wrapper over @noble/curves
 *
 * Provides the same API surface used by other modules (getPublicKey, ecdh,
 * isValidPrivateKey, liftX, N) via noble's audited implementation.
 *
 * @module lib/crypto/secp256k1
 */

import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { isValidPrivateKey as sharedIsValidPrivateKey } from '@nostr-wot/accounts';
import { bytesToHex } from './utils.ts';

export function getPublicKey(privkey: Uint8Array): Uint8Array {
  return schnorr.getPublicKey(privkey);
}

/**
 * Whether these 32 bytes are a usable secp256k1 secret key.
 *
 * The shared one, which asks the curve whether the scalar is in range rather than deriving
 * a public key and catching. Same answer, but it does not perform a point multiplication on
 * a value that has just been pasted into an import box.
 */
export function isValidPrivateKey(privkey: Uint8Array): boolean {
  return sharedIsValidPrivateKey(privkey);
}

export function ecdh(privkey: Uint8Array, theirPubkey: Uint8Array): Uint8Array {
  if (theirPubkey.length !== 32) throw new Error('Public key must be 32 bytes');
  const prefixed = new Uint8Array(33);
  prefixed[0] = 0x02;
  prefixed.set(theirPubkey, 1);
  const full = secp256k1.getSharedSecret(privkey, prefixed);
  const result = full.slice(1, 33);
  full.fill(0);
  return result;
}

export function liftX(xBytes: Uint8Array): { x: bigint; y: bigint } {
  const point = secp256k1.Point.fromHex('02' + bytesToHex(xBytes));
  const aff = point.toAffine();
  let y = aff.y;
  if (y & 1n) y = P - y;
  return { x: aff.x, y };
}
