/**
 * NIP-49 — Encrypted Private Key (ncryptsec) — a thin adapter over `@nostr-wot/accounts`.
 *
 * The format, the scrypt parameters and the legacy 0x01 reader all live in the package now.
 * What is left here is the extension's calling convention: hex strings in and out, and
 * async signatures, because the extension's own implementation was async (WebCrypto and
 * `scryptAsync`) and its call sites await it.
 *
 * ## Why this had to move
 *
 * The extension's own `deriveScryptKey` passed `maxmem: 128 * r * (N + p)`. scrypt also
 * allocates one scratch block; `@noble/hashes` 2.0.1 did not count it when checking
 * `maxmem` and 2.4.0 does. This package declares `@noble/hashes: ^2.0.1`, so a fresh
 * install today resolves 2.4.0 and every ncryptsec operation threw "maxmem limit was hit"
 * by exactly one block — no backup could be written and none could be read — while the
 * lockfile-pinned test suite stayed green because the lockfile still held 2.0.1. The
 * package computes `maxmem` from what the algorithm allocates rather than from what one
 * noble version happens to check, which is correct under both. `tests/vendor.test.ts`
 * exercises it against whichever version is actually installed.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/49.md — NIP-49
 * @module lib/crypto/nip49
 */
import { decryptNcryptsec, encryptNcryptsec } from '@nostr-wot/accounts';
import { hexToBytes, bytesToHex } from './utils.ts';

/**
 * Encrypt a private key with a password and encode as ncryptsec (NIP-49 v2).
 *
 * Takes the key as bytes or as hex. Bytes are the form to prefer and the form the export
 * handler now passes: a hex string cannot be overwritten, so building one on the way in put a
 * second, unzeroable copy of the key in the heap for the garbage collector to get to whenever
 * it felt like it. The hex form stays because callers and tests pass one. The array it decodes
 * to is zeroed here; the string itself is the caller's to regret.
 *
 * @param privkey - the 32-byte key, as bytes (preferred) or hex. Not zeroed: it is the
 *   caller's, and inside a `withPrivkey` scope the vault zeroes it already.
 */
export async function ncryptsecEncode(privkey: Uint8Array | string, password: string): Promise<string> {
  if (typeof privkey !== 'string') return encryptNcryptsec(privkey, password);
  const privkeyBytes = hexToBytes(privkey);
  try {
    return encryptNcryptsec(privkeyBytes, password);
  } finally {
    privkeyBytes.fill(0);
  }
}

/**
 * Decrypt an ncryptsec string with a password.
 *
 * Dispatches on the version byte: 0x02 = NIP-49 scrypt/XChaCha20-Poly1305, 0x01 = the
 * legacy local PBKDF2/AES-GCM backups older versions of this extension exported.
 */
export async function ncryptsecDecode(ncryptsec: string, password: string): Promise<string> {
  const privkey = decryptNcryptsec(ncryptsec, password);
  try {
    return bytesToHex(privkey);
  } finally {
    privkey.fill(0);
  }
}
