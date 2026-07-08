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

const VERSION_V2: number = 0x02;
const VERSION_LEGACY: number = 0x01;
const DEFAULT_LOG_N: number = 16;
const MAX_LOG_N: number = 22;
const SCRYPT_R: number = 8;
const SCRYPT_P: number = 1;
// key_security_byte 0x02 = "client does not track this data" per NIP-49
const KEY_SECURITY_UNKNOWN: number = 0x02;
const V2_PAYLOAD_LENGTH: number = 1 + 1 + 16 + 24 + 1 + 48; // 91 bytes

const LEGACY_PBKDF2_ITERATIONS: number = 210000;

async function deriveScryptKey(password: string, salt: Uint8Array, logN: number): Promise<Uint8Array> {
    const passwordBytes = new TextEncoder().encode(password.normalize('NFKC'));
    try {
        return await scryptAsync(passwordBytes, salt, {
            N: 1 << logN,
            r: SCRYPT_R,
            p: SCRYPT_P,
            dkLen: 32,
            maxmem: 128 * SCRYPT_R * ((1 << logN) + SCRYPT_P)
        });
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
