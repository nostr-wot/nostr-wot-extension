/**
 * Post-Quantum Key Derivation (ML-KEM-1024 / ML-DSA-87)
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

import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { expand as hkdfExpand, extract as hkdfExtract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Derivation profile identifier. Bump when the derivation changes. */
export const PQ_PROFILE: string = 'nip-pqc/v1';

/** Algorithm identifiers as they appear in the attestation event. */
export const ALG_KEM: string = 'ml-kem-1024';
export const ALG_DSA: string = 'ml-dsa-87';

/** Public key sizes in bytes, per FIPS 203 / 204. Used to reject malformed keys. */
export const KEM_PUBLIC_KEY_BYTES: number = 1568;
export const DSA_PUBLIC_KEY_BYTES: number = 2592;

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
      kem: ml_kem1024.keygen(kemSeed),
      dsa: ml_dsa87.keygen(dsaSeed),
    };
  } finally {
    kemSeed.fill(0);
    dsaSeed.fill(0);
  }
}

/** Secret key sizes in bytes, per FIPS 203 / 204. */
export const KEM_SECRET_KEY_BYTES: number = 3168;
export const DSA_SECRET_KEY_BYTES: number = 4896;

/** Pull base64 blobs of the two secret-key lengths out of arbitrary pasted text. */
function findSecretKeys(text: string): { kem?: string; dsa?: string } {
  // Base64 of 3168 bytes is 4224 chars; of 4896 bytes, 6528. Matching on length is what
  // lets the labels, order and surrounding chatter be irrelevant.
  const found: { kem?: string; dsa?: string } = {};
  for (const token of text.match(/[A-Za-z0-9+/=]{64,}/g) || []) {
    let bytes: Uint8Array;
    try {
      bytes = _unb64(token);
    } catch {
      continue;
    }
    if (bytes.length === KEM_SECRET_KEY_BYTES && !found.kem) found.kem = token;
    else if (bytes.length === DSA_SECRET_KEY_BYTES && !found.dsa) found.dsa = token;
  }
  return found;
}

/**
 * Build both key pairs from the secret keys alone.
 *
 * ML-KEM and ML-DSA can each recompute their public key from their secret, so a pasted
 * public key would add nothing except another thing to get wrong. Deriving it and then
 * proving the pair by round trip is strictly stronger than trusting one that was supplied.
 */
function fromSecretKeys(secrets: { kem?: string; dsa?: string }): PqKeys {
  if (!secrets.kem) {
    throw new Error(`Could not find an ${ALG_KEM} secret key (${KEM_SECRET_KEY_BYTES} bytes) in what you pasted.`);
  }
  if (!secrets.dsa) {
    throw new Error(`Could not find an ${ALG_DSA} secret key (${DSA_SECRET_KEY_BYTES} bytes) in what you pasted.`);
  }

  const kemSecret = decodeKey(secrets.kem, `${ALG_KEM} secret key`, KEM_SECRET_KEY_BYTES);
  const dsaSecret = decodeKey(secrets.dsa, `${ALG_DSA} secret key`, DSA_SECRET_KEY_BYTES);

  let keys: PqKeys;
  try {
    keys = {
      kem: { publicKey: ml_kem1024.getPublicKey(kemSecret), secretKey: kemSecret },
      dsa: { publicKey: ml_dsa87.getPublicKey(dsaSecret), secretKey: dsaSecret },
    };
  } catch {
    throw new Error('Those secret keys could not be read. Check you copied them completely.');
  }
  return provePairs(keys);
}

/** Decode one base64 key and check its length. */
function decodeKey(b64: string, label: string, length: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = _unb64(b64);
  } catch {
    throw new Error(`The ${label} could not be decoded — is it complete?`);
  }
  if (bytes.length !== length) {
    throw new Error(`The ${label} is ${bytes.length} bytes, expected ${length} — it looks truncated.`);
  }
  return bytes;
}

/**
 * Parse and validate an externally generated post-quantum key file.
 *
 * An account with no 24-word mnemonic has nothing to derive from, so its keys have to come
 * from outside — `scripts/pqc-keygen.mjs --independent --keyfile` writes the file shape.
 *
 * The secret keys ALONE are also accepted, pasted as the generator prints them, because
 * both algorithms can recompute their public key from their secret. That makes the public
 * halves derived rather than supplied, which removes a whole class of mistake: there is no
 * longer a public key that could fail to match. Every field is user-supplied, and the
 * dangerous failure is not a malformed one but a *plausible* one: a public key paired with
 * a different secret.
 * That file imports cleanly, publishes an attestation senders encrypt to, and then
 * fails to decrypt a single message, with nothing to indicate why. So neither pair is
 * taken on its word:
 *
 *   ML-KEM  encapsulate to the public key, decapsulate with the secret, compare
 *   ML-DSA  sign with the secret, verify against the public key
 *
 * Both cost a few milliseconds and turn a silent permanent failure into an import error.
 *
 * @param text - key file contents, pasted or read from a file
 * @returns both validated key pairs
 * @throws Error naming the specific algorithm and problem
 */
export function parsePqKeyfile(text: string): PqKeys {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Nothing to import.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: accept the secret keys as the generator prints them, with or without
    // labels and in either order. The public halves are recomputed below, so the secrets
    // are the whole input — there is nothing else worth asking the user to carry around.
    return fromSecretKeys(findSecretKeys(raw));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('That is not a valid key file (expected JSON).');
  }

  // A file carrying only the secrets is enough too.
  const asObj = parsed as Record<string, any>;
  if (typeof asObj.kem?.public !== 'string' && typeof asObj.dsa?.public !== 'string') {
    return fromSecretKeys({
      kem: typeof asObj.kem?.secret === 'string' ? asObj.kem.secret : undefined,
      dsa: typeof asObj.dsa?.secret === 'string' ? asObj.dsa.secret : undefined,
    });
  }

  const file = parsed as Record<string, any>;
  if (file.v !== PQ_PROFILE) {
    throw new Error(`Unsupported key file version ${JSON.stringify(file.v ?? null)} — expected ${PQ_PROFILE}.`);
  }
  if (file.alg?.kem !== ALG_KEM) throw new Error(`This key file is not ${ALG_KEM}.`);
  if (file.alg?.dsa !== ALG_DSA) throw new Error(`This key file is not ${ALG_DSA}.`);

  for (const section of ['kem', 'dsa'] as const) {
    if (!file[section] || typeof file[section] !== 'object') {
      throw new Error(`Key file is missing its ${section} section.`);
    }
    for (const half of ['public', 'secret'] as const) {
      if (typeof file[section][half] !== 'string') {
        throw new Error(`Key file is missing the ${section} ${half} key.`);
      }
    }
  }

  const decode = (b64: string, label: string, length: number): Uint8Array => {
    let bytes: Uint8Array;
    try {
      bytes = _unb64(b64);
    } catch {
      throw new Error(`The ${label} could not be decoded — is the file complete?`);
    }
    if (bytes.length === 0) {
      throw new Error(`The ${label} could not be decoded — is the file complete?`);
    }
    if (bytes.length !== length) {
      throw new Error(`The ${label} is ${bytes.length} bytes, expected ${length} — the file looks truncated.`);
    }
    return bytes;
  };

  const keys: PqKeys = {
    kem: {
      publicKey: decode(file.kem.public, `${ALG_KEM} public key`, KEM_PUBLIC_KEY_BYTES),
      secretKey: decode(file.kem.secret, `${ALG_KEM} secret key`, KEM_SECRET_KEY_BYTES),
    },
    dsa: {
      publicKey: decode(file.dsa.public, `${ALG_DSA} public key`, DSA_PUBLIC_KEY_BYTES),
      secretKey: decode(file.dsa.secret, `${ALG_DSA} secret key`, DSA_SECRET_KEY_BYTES),
    },
  };

  return provePairs(keys);
}

/** Prove each pair belongs together, by using it. */
function provePairs(keys: PqKeys): PqKeys {
  // Prove the KEM pair: encapsulate to the public key, open it with the secret.
  let kemMatches = false;
  try {
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(keys.kem.publicKey);
    const opened = ml_kem1024.decapsulate(cipherText, keys.kem.secretKey);
    kemMatches = opened.length === sharedSecret.length && opened.every((b, i) => b === sharedSecret[i]);
    opened.fill(0);
    sharedSecret.fill(0);
  } catch {
    kemMatches = false;
  }
  if (!kemMatches) {
    throw new Error(`The ${ALG_KEM} keys do not match each other — this public key belongs to a different secret key.`);
  }

  // Prove the signature pair the same way.
  let dsaMatches = false;
  try {
    const probe = encoder.encode(`${PQ_PROFILE}/keyfile-check`);
    dsaMatches = ml_dsa87.verify(ml_dsa87.sign(probe, keys.dsa.secretKey), probe, keys.dsa.publicKey);
  } catch {
    dsaMatches = false;
  }
  if (!dsaMatches) {
    throw new Error(`The ${ALG_DSA} keys do not match each other — this public key belongs to a different secret key.`);
  }

  return keys;
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
  return ml_dsa87.sign(message, dsaSecretKey);
}

/** Verify a proof-of-possession signature against a published ML-DSA public key. */
export function verifyPop(signature: Uint8Array, message: Uint8Array, dsaPublicKey: Uint8Array): boolean {
  try {
    return ml_dsa87.verify(signature, message, dsaPublicKey);
  } catch {
    return false;
  }
}

/** Encapsulate to a recipient's ML-KEM public key. Returns ciphertext + shared secret. */
export function encapsulate(kemPublicKey: Uint8Array): { cipherText: Uint8Array; sharedSecret: Uint8Array } {
  if (kemPublicKey.length !== KEM_PUBLIC_KEY_BYTES) {
    throw new Error('Invalid ML-KEM public key length');
  }
  return ml_kem1024.encapsulate(kemPublicKey);
}

/** Decapsulate a ciphertext with our ML-KEM secret key. Returns the shared secret. */
export function decapsulate(cipherText: Uint8Array, kemSecretKey: Uint8Array): Uint8Array {
  return ml_kem1024.decapsulate(cipherText, kemSecretKey);
}

// ── Message envelope ────────────────────────────────────────────────────────

/**
 * The post-quantum message envelope, matching @nostr-wot/pq on the wire.
 *
 *   version 1B (0x01) | alg 1B (0x01) | kem_ct 1568B | nonce 24B | AEAD(padded)
 *
 * Self-describing on purpose: `isPqEnvelope` lets `nip44Decrypt` route a payload by
 * looking at it, so a caller never has to say which scheme a ciphertext used. The
 * encrypt side cannot infer anything — it needs the recipient's ML-KEM key — so that
 * direction stays an explicit opt-in.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { arrayToBase64 as _b64, base64ToArray as _unb64 } from './utils.ts';

export const ENVELOPE_VERSION = 0x01;
export const ALG_MLKEM1024_XCHACHA = 0x01;
export const KEM_CIPHERTEXT_BYTES = 1568;

const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const HEADER_BYTES = 2 + KEM_CIPHERTEXT_BYTES + NONCE_BYTES;
const MAX_PLAINTEXT_BYTES = 65535;

function calcPaddedLen(len: number): number {
  if (len <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function pad(plaintext: Uint8Array): Uint8Array {
  if (plaintext.length === 0) throw new Error('Cannot encrypt an empty message');
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Message too long');
  const padded = new Uint8Array(2 + calcPaddedLen(plaintext.length));
  new DataView(padded.buffer).setUint16(0, plaintext.length, false);
  padded.set(plaintext, 2);
  return padded;
}

function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 2) throw new Error('bad padding');
  const len = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint16(0, false);
  if (len === 0 || len > MAX_PLAINTEXT_BYTES) throw new Error('bad padding');
  const out = padded.subarray(2, 2 + len);
  if (out.length !== len || padded.length !== 2 + calcPaddedLen(len)) throw new Error('bad padding');
  return out;
}

/** Binds version, algorithm and both pubkeys so a ciphertext cannot be moved or downgraded. */
function associatedData(sender: string, recipient: string, kemCt: Uint8Array): Uint8Array {
  const prefix = encoder.encode(
    `${PQ_PROFILE}/env:${ENVELOPE_VERSION}:${ALG_MLKEM1024_XCHACHA}:${sender}:${recipient}:`,
  );
  const ad = new Uint8Array(prefix.length + kemCt.length);
  ad.set(prefix, 0);
  ad.set(kemCt, prefix.length);
  return ad;
}

/** Combine the KEM secret with the classic NIP-44 conversation key. Never use either alone. */
export function hybridKey(sharedSecret: Uint8Array, conversationKey: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(sharedSecret.length + conversationKey.length);
  ikm.set(sharedSecret, 0);
  ikm.set(conversationKey, sharedSecret.length);
  const prk = hkdfExtract(sha256, ikm, undefined);
  try {
    return hkdfExpand(sha256, prk, encoder.encode(`${PQ_PROFILE}/hybrid`), 32);
  } finally {
    ikm.fill(0);
    prk.fill(0);
  }
}

/** True if this payload is one of our envelopes, so decrypt can route without being told. */
export function isPqEnvelope(payload: string): boolean {
  try {
    const bytes = _unb64(payload);
    return (
      bytes.length >= HEADER_BYTES + TAG_BYTES &&
      bytes[0] === ENVELOPE_VERSION &&
      bytes[1] === ALG_MLKEM1024_XCHACHA
    );
  } catch {
    return false;
  }
}

export function pqEncrypt(
  plaintext: string,
  recipientKemKey: Uint8Array,
  conversationKey: Uint8Array,
  sender: string,
  recipient: string,
): string {
  if (recipientKemKey.length !== KEM_PUBLIC_KEY_BYTES) throw new Error('Invalid ML-KEM public key length');
  if (conversationKey.length !== 32) throw new Error('Invalid conversation key');

  const { cipherText: kemCt, sharedSecret } = encapsulate(recipientKemKey);
  const key = hybridKey(sharedSecret, conversationKey);
  const nonce = randomBytes(NONCE_BYTES);
  try {
    const sealed = xchacha20poly1305(key, nonce, associatedData(sender, recipient, kemCt))
      .encrypt(pad(encoder.encode(plaintext)));
    const out = new Uint8Array(HEADER_BYTES + sealed.length);
    out[0] = ENVELOPE_VERSION;
    out[1] = ALG_MLKEM1024_XCHACHA;
    out.set(kemCt, 2);
    out.set(nonce, 2 + KEM_CIPHERTEXT_BYTES);
    out.set(sealed, HEADER_BYTES);
    return _b64(out);
  } finally {
    key.fill(0);
    sharedSecret.fill(0);
  }
}

/** One generic error for every failure — distinguishing them would be an oracle. */
export function pqDecrypt(
  payload: string,
  kemSecretKey: Uint8Array,
  conversationKey: Uint8Array,
  sender: string,
  recipient: string,
): string {
  try {
    if (conversationKey.length !== 32) throw new Error('x');
    const bytes = _unb64(payload);
    if (bytes.length < HEADER_BYTES + TAG_BYTES) throw new Error('x');
    if (bytes[0] !== ENVELOPE_VERSION || bytes[1] !== ALG_MLKEM1024_XCHACHA) throw new Error('x');

    const kemCt = bytes.subarray(2, 2 + KEM_CIPHERTEXT_BYTES);
    const nonce = bytes.subarray(2 + KEM_CIPHERTEXT_BYTES, HEADER_BYTES);
    const sealed = bytes.subarray(HEADER_BYTES);

    const sharedSecret = decapsulate(kemCt, kemSecretKey);
    const key = hybridKey(sharedSecret, conversationKey);
    try {
      return new TextDecoder().decode(
        unpad(xchacha20poly1305(key, nonce, associatedData(sender, recipient, kemCt)).decrypt(sealed)),
      );
    } finally {
      key.fill(0);
      sharedSecret.fill(0);
    }
  } catch {
    throw new Error('Decryption failed');
  }
}
