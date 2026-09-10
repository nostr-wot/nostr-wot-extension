import { PBKDF2_ITERATIONS, SALT_BYTES, IV_BYTES } from '@constants/crypto/keyBackup.ts';

export interface EncryptedBackup {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
}

/** Identify the password-encrypted export envelope without decrypting its contents. */
export function isEncryptedBackup(contents: string): boolean {
  try {
    const value = JSON.parse(contents);
    return value?.v === 1 && ['salt', 'iv', 'ct'].every(
      field => typeof value[field] === 'string' && value[field].length > 0,
    );
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

/**
 * Encrypt `plaintext` under `password`, returning the JSON to write to disk.
 *
 * A fresh salt and IV every time, so encrypting the same secret twice produces
 * different files and neither reveals that they match.
 */
export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const payload: EncryptedBackup = {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(payload);
}

/**
 * Read a backup file back.
 *
 * Used by PQ key import to restore password-encrypted exports.
 *
 * @throws if the envelope is malformed, or the password is wrong (AES-GCM's
 *         authentication tag fails, which is indistinguishable from corruption
 *         and is reported as one thing).
 */
export async function decryptBackup(fileContents: string, password: string): Promise<string> {
  let parsed: EncryptedBackup;
  try {
    parsed = JSON.parse(fileContents) as EncryptedBackup;
  } catch {
    throw new Error('Not a backup file');
  }
  if (!parsed || parsed.v !== 1 || !parsed.salt || !parsed.iv || !parsed.ct) {
    throw new Error('Not a backup file');
  }

  const key = await deriveKey(password, fromBase64(parsed.salt), ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parsed.iv) as BufferSource },
      key,
      fromBase64(parsed.ct) as BufferSource,
    );
  } catch {
    throw new Error('Wrong password, or the file is damaged');
  }
  return new TextDecoder().decode(plaintext);
}
