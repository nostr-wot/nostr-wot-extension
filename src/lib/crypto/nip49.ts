import {
  VERSION_V2,
  VERSION_LEGACY,
  DEFAULT_LOG_N,
  MAX_LOG_N,
  SCRYPT_R,
  SCRYPT_P,
  SCRYPT_MAXMEM_SLACK_BLOCKS,
  KEY_SECURITY_UNKNOWN,
  V2_PAYLOAD_LENGTH,
  LEGACY_PBKDF2_ITERATIONS,
} from '@constants/crypto/nip49.ts';
/**
 * NIP-49 — Encrypted Private Key (ncryptsec)
 *
 * Spec-compliant v2 format (interoperable with other Nostr apps):
 *   version(0x02, 1B) || log_n(1B) || salt(16B) || nonce(24B) ||
 *   key_security_byte(1B) || ciphertext(48B = 32B key + 16B Poly1305 tag)
 * KDF: scrypt (N = 2^log_n, r = 8, p = 1, dkLen = 32), password NFKC-normalized.
 * Cipher: XChaCha20-Poly1305 with the key_security_byte as AAD.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/49.md — NIP-49
 *
 * Decoding also accepts the legacy local-only 0x01 format (PBKDF2-SHA256 at
 * 210K iterations + AES-256-GCM: version(1) + salt(16) + iv(12) + ciphertext(48))
 * so backups exported by older versions of this extension still import.
 */

import { scryptAsync } from '@noble/hashes/scrypt.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hexToBytes, bytesToHex } from './utils.ts';
import { bech32Encode, bech32Decode, convertBits } from './bech32.ts';

/**
 * The `maxmem` to hand `@noble/hashes` for a scrypt cost of 2^logN, in bytes: the
 * `N + p` blocks the algorithm itself needs, plus {@link SCRYPT_MAXMEM_SLACK_BLOCKS}
 * blocks of headroom for the library's own scratch space.
 *
 * The headroom is the whole point, so it is worth being exact about what this number is
 * and is not. It is **not** a measurement of scrypt's true heap — noble also allocates
 * PBKDF2 and HMAC state it does not charge here. It is a budget chosen to sit above
 * whatever any `@noble/hashes` in the declared range charges against `maxmem`, on the
 * standing assumption that the charge may rise again.
 *
 * It has already risen once. This bound used to be `128·r·(N + p)` — character for
 * character the expression 2.0.1 validates against, and therefore exactly on its line.
 * From 2.2.0 noble validates against `128·r·(N + p + 1)`, counting a scratch block it
 * had always allocated, and notes in its own source that the accounting "is
 * intentionally noble-specific". `package.json` declared `^2.0.1`, which admits 2.2.0
 * through 2.4.0, so any build resolved from the range rather than from the committed
 * lockfile threw `"maxmem" limit was hit` on every encode and decode — while the suite,
 * installed via the lockfile at 2.0.1, stayed green. Sitting a few blocks clear of the
 * line, rather than on it, is what stops the next revision doing the same thing:
 * matching the library's current expression exactly would only move the coupling one
 * version along.
 *
 * `maxmem` is a compatibility bound, not a safety one: it is derived from the cost
 * factor in the payload, so it can never reject an expensive backup. {@link MAX_LOG_N}
 * is what bounds that.
 *
 * @see tests/crypto/scrypt-maxmem.test.ts — probes the installed library for what it
 *      actually requires instead of restating any version's expression.
 */
export function scryptMaxMem(logN: number): number {
    const blockSize = 128 * SCRYPT_R;
    return blockSize * (2 ** logN + SCRYPT_P + SCRYPT_MAXMEM_SLACK_BLOCKS);
}

async function deriveScryptKey(password: string, salt: Uint8Array, logN: number): Promise<Uint8Array> {
    const passwordBytes = new TextEncoder().encode(password.normalize('NFKC'));
    const N = 2 ** logN;
    try {
        return await scryptAsync(passwordBytes, salt, {
            N,
            r: SCRYPT_R,
            p: SCRYPT_P,
            dkLen: 32,
            maxmem: scryptMaxMem(logN)
        });
    } catch (cause) {
        // The import screen renders `error.message` straight into the UI, so a library's
        // internal message would reach the user as-is: the original form of this bug
        // showed them `"maxmem" limit was hit: memUsed(128*r*(N+p+1))=67110912`. Keep the
        // cause for debugging and say something a person can act on. Deliberately not the
        // wrong-password message — a backup this extension cannot stretch at all is a
        // different problem from a password that does not match, and telling someone to
        // retype a correct password is its own kind of harm.
        throw new Error('Could not derive a key from this backup\'s scrypt parameters', { cause });
    } finally {
        passwordBytes.fill(0);
    }
}

async function deriveLegacyKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: LEGACY_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt a private key with a password and encode as ncryptsec (NIP-49 v2)
 */
export async function ncryptsecEncode(privkeyHex: string, password: string): Promise<string> {
    const privkeyBytes = hexToBytes(privkeyHex);
    if (privkeyBytes.length !== 32) throw new Error('Invalid private key length');

    let key: Uint8Array | null = null;
    try {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const nonce = crypto.getRandomValues(new Uint8Array(24));
        key = await deriveScryptKey(password, salt, DEFAULT_LOG_N);

        const aad = new Uint8Array([KEY_SECURITY_UNKNOWN]);
        const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(privkeyBytes);

        // Format: version(1) + log_n(1) + salt(16) + nonce(24) + key_security_byte(1) + ciphertext(48)
        const payload = new Uint8Array(V2_PAYLOAD_LENGTH);
        payload[0] = VERSION_V2;
        payload[1] = DEFAULT_LOG_N;
        payload.set(salt, 2);
        payload.set(nonce, 18);
        payload[42] = KEY_SECURITY_UNKNOWN;
        payload.set(ciphertext, 43);

        const data5bit = convertBits(Array.from(payload), 8, 5, true);
        return bech32Encode('ncryptsec', data5bit!);
    } finally {
        privkeyBytes.fill(0);
        key?.fill(0);
    }
}

async function decodeV2(payload: Uint8Array, password: string): Promise<string> {
    if (payload.length !== V2_PAYLOAD_LENGTH) throw new Error('Invalid ncryptsec payload length');

    const logN = payload[1];
    if (logN < 1 || logN > MAX_LOG_N) throw new Error('Unsupported scrypt cost factor');

    const salt = payload.slice(2, 18);
    const nonce = payload.slice(18, 42);
    const keySecurityByte = payload[42];
    const ciphertext = payload.slice(43);

    const key = await deriveScryptKey(password, salt, logN);
    try {
        const aad = new Uint8Array([keySecurityByte]);
        const decrypted = xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
        const hex = bytesToHex(decrypted);
        decrypted.fill(0);
        return hex;
    } catch {
        throw new Error('Wrong password or corrupted data');
    } finally {
        key.fill(0);
    }
}

async function decodeLegacy(payload: Uint8Array, password: string): Promise<string> {
    const salt = payload.slice(1, 17);
    const iv = payload.slice(17, 29);
    const ciphertext = payload.slice(29);

    const key = await deriveLegacyKey(password, salt);

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key, ciphertext
        );
        const decryptedBytes = new Uint8Array(decrypted);
        const hex = bytesToHex(decryptedBytes);
        decryptedBytes.fill(0);
        return hex;
    } catch {
        throw new Error('Wrong password or corrupted data');
    }
}

/**
 * Decrypt an ncryptsec string with a password.
 * Dispatches on the version byte: 0x02 = NIP-49 scrypt/XChaCha20-Poly1305,
 * 0x01 = legacy local PBKDF2/AES-GCM backups.
 */
export async function ncryptsecDecode(ncryptsec: string, password: string): Promise<string> {
    const decoded = bech32Decode(ncryptsec);
    if (!decoded || decoded.hrp !== 'ncryptsec') throw new Error('Invalid ncryptsec');

    const bytes = convertBits(decoded.data, 5, 8, false);
    if (!bytes) throw new Error('Invalid ncryptsec');
    const payload = new Uint8Array(bytes);

    const version = payload[0];
    if (version === VERSION_V2) return decodeV2(payload, password);
    if (version === VERSION_LEGACY) return decodeLegacy(payload, password);
    throw new Error('Unsupported ncryptsec version');
}
