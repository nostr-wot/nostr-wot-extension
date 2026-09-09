import { VAULT_PBKDF2_ITERATIONS as PBKDF2_ITERATIONS, LEGACY_VAULT_PBKDF2_ITERATIONS as PBKDF2_ITERATIONS_LEGACY } from '@constants/vault.ts';

/**
 * Work factor for a given password.
 *
 * "Never lock" mode stores the vault under the EMPTY password, and the code that
 * supplies it is public — the KDF cost buys nothing there, because an attacker holding
 * the file already knows the password. It would only cost latency, and on a path that
 * runs on every service-worker cold start (see beginStartupUnlock). So the strong count
 * applies exactly where it can help: vaults with a real password.
 */
export function iterationsFor(password: string): number {
  return password.length > 0 ? PBKDF2_ITERATIONS : PBKDF2_ITERATIONS_LEGACY;
}

/**
 * Derive an AES-256-GCM key from a password using PBKDF2
 * @param iterations - work factor; must match the one the record was written with
 */
export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext with AES-256-GCM
 */
export async function encrypt(key: CryptoKey, plaintext: string): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Decrypt ciphertext with AES-256-GCM
 */
export async function decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new TextDecoder().decode(plaintext);
}