/**
 * Post-Quantum Key Derivation (ML-KEM / ML-DSA)
 *
 * Thin wrapper over @noble/post-quantum. Derives a post-quantum key pair from the
 * same BIP-39 seed the secp256k1 identity key comes from, so a single mnemonic
 * restores both.
 *
 * The keys are derived as SIBLINGS of the secp256k1 key, never FROM it. This is
 * the security property the whole scheme rests on: BIP-32 and HKDF are both
 * one-way, so an adversary who recovers the secp256k1 private key (via Shor,
 * given the published pubkey) cannot walk back to the seed and therefore cannot
 * derive these keys. Deriving the post-quantum key from the private key instead —
 * `pq = KDF(nsec)` — would be circular and provide no post-quantum security at
 * all. Do not "simplify" this into taking the nsec as input.
 *
 * ML-KEM provides confidentiality only; ML-DSA is the signature scheme. Neither
 * replaces the secp256k1 event signature today.
 *
 * @see https://csrc.nist.gov/pubs/fips/203/final — FIPS 203 (ML-KEM)
 * @see https://csrc.nist.gov/pubs/fips/204/final — FIPS 204 (ML-DSA)
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md — NIP-06 (the seed)
 *
 * @module lib/crypto/pq
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { expand as hkdfExpand, extract as hkdfExtract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Derivation profile identifier. Bump when the derivation changes. */
export const PQ_PROFILE: string = 'nip-pqc/v1';

/** Algorithm identifiers as they appear in the attestation event. */
export const ALG_KEM: string = 'ml-kem-768';
export const ALG_DSA: string = 'ml-dsa-65';

/** Public key sizes in bytes, per FIPS 203 / 204. Used to reject malformed keys. */
export const KEM_PUBLIC_KEY_BYTES: number = 1184;
export const DSA_PUBLIC_KEY_BYTES: number = 1952;

const KEM_SEED_BYTES = 64; // ML-KEM keygen takes d || z
const DSA_SEED_BYTES = 32; // ML-DSA keygen takes xi

export interface PqKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface PqKeys {
  kem: PqKeyPair;
  dsa: PqKeyPair;
}

const encoder = new TextEncoder();

/**
 * Expand the BIP-39 seed into an algorithm-specific key seed.
 *
 * Domain separation is what keeps the two algorithms' seeds independent, and what
 * keeps both independent of the BIP-32 path used for the secp256k1 key.
 */
function deriveSeed(seed: Uint8Array, info: string, length: number): Uint8Array {
  // Empty salt, per the specification — the seed is already high-entropy.
  const prk = hkdfExtract(sha256, seed, undefined);
  try {
    return hkdfExpand(sha256, prk, encoder.encode(info), length);
  } finally {
    prk.fill(0);
  }
}

/** `info` string for the ML-KEM seed at a given NIP-06 account index. */
export function kemInfo(account: number = 0): string {
  return `${PQ_PROFILE}/${ALG_KEM}/${account}`;
}

/** `info` string for the ML-DSA seed at a given NIP-06 account index. */
export function dsaInfo(account: number = 0): string {
  return `${PQ_PROFILE}/${ALG_DSA}/${account}`;
}

/**
 * Derive both post-quantum key pairs from a BIP-39 seed.
 *
 * @param seed - the 64-byte BIP-39 seed (from `mnemonicToSeed`), NOT a private key
 * @param account - NIP-06 account index, so PQ keys track the secp256k1 key
 * @returns ML-KEM and ML-DSA key pairs
 */
export function derivePqKeys(seed: Uint8Array, account: number = 0): PqKeys {
  if (!(seed instanceof Uint8Array) || seed.length === 0) {
    throw new Error('Invalid seed');
  }
  if (!Number.isInteger(account) || account < 0) {
    throw new Error('Invalid account index');
  }

  const kemSeed = deriveSeed(seed, kemInfo(account), KEM_SEED_BYTES);
  const dsaSeed = deriveSeed(seed, dsaInfo(account), DSA_SEED_BYTES);
  try {
    return {
      kem: ml_kem768.keygen(kemSeed),
      dsa: ml_dsa65.keygen(dsaSeed),
    };
  } finally {
    kemSeed.fill(0);
    dsaSeed.fill(0);
  }
}

/**
 * Build the proof-of-possession message that the ML-DSA key signs.
 *
 * Binding all three keys into one signed string is what proves the publisher holds
 * the post-quantum keys it is advertising, and — since ML-KEM cannot sign — is what
 * gives the encapsulation key a possession proof at all.
 */
export function popMessage(pubkeyHex: string, kemPublicKeyB64: string, dsaPublicKeyB64: string): Uint8Array {
  return encoder.encode(`${PQ_PROFILE}/pop:${pubkeyHex}:${kemPublicKeyB64}:${dsaPublicKeyB64}`);
}

/** Sign the proof-of-possession message with the ML-DSA secret key. */
export function signPop(message: Uint8Array, dsaSecretKey: Uint8Array): Uint8Array {
  return ml_dsa65.sign(message, dsaSecretKey);
}

/** Verify a proof-of-possession signature against a published ML-DSA public key. */
export function verifyPop(signature: Uint8Array, message: Uint8Array, dsaPublicKey: Uint8Array): boolean {
  try {
    return ml_dsa65.verify(signature, message, dsaPublicKey);
  } catch {
    return false;
  }
}

/** Encapsulate to a recipient's ML-KEM public key. Returns ciphertext + shared secret. */
export function encapsulate(kemPublicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (kemPublicKey.length !== KEM_PUBLIC_KEY_BYTES) {
    throw new Error('Invalid ML-KEM public key length');
  }
  return ml_kem768.encapsulate(kemPublicKey);
}

/** Decapsulate a ciphertext with our ML-KEM secret key. Returns the shared secret. */
export function decapsulate(cipherText: Uint8Array, kemSecretKey: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(cipherText, kemSecretKey);
}
