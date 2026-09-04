/**
 * Password-encrypted backup files.
 *
 * The format the popup writes when you choose "download encrypted" for a seed
 * phrase or a post-quantum key file. AES-256-GCM under a PBKDF2-SHA-256 key, in
 * a small JSON envelope:
 *
 *   { "v": 1, "salt": base64, "iv": base64, "ct": base64 }
 *
 * This lived inline in the seed-export modal, which meant nothing verified that
 * what it wrote could ever be read back — in a key-custody extension, where the
 * file is the last copy of something a user cannot reconstruct. It is here
 * because a second export (post-quantum key files) needs exactly the same
 * envelope, and because a round-trip is only testable once the two halves exist
 * in one place.
 *
 * The work factor is deliberately the legacy 210,000 rather than the vault's
 * 600,000, so files written by earlier builds stay readable: the envelope has no
 * iterations field to read a different count out of. Raising it means adding
 * that field and defaulting its absence to 210,000, the same migration the vault
 * already did.
 *
 * @module lib/crypto/keyBackup
 */

const PBKDF2_ITERATIONS = 210000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBackup {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
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
 * Exists so the format can be proven to round-trip. Nothing in the extension
 * imports a backup today — these files are for the user to keep — but a backup
 * format with no decrypt path is a claim nobody has ever checked.
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
