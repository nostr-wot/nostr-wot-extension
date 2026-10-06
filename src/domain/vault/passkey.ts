import { PASSKEY_RP_ID, PASSKEY_VAULT_VERSION, PASSKEY_MAX_BACKUP_BYTES, PASSKEY_MAX_CREDENTIALS, PASSKEY_BACKUP_FORMAT } from '@constants/passkey.ts';

export interface PasskeyMetadata { credentialId: string; prfSalt: string; }
/** PRF output is transient secret material: never persist or log this request. */
export interface PasskeyInput extends PasskeyMetadata { prf: string; }
export interface PasskeyProof { credentialId: string; prf: string; }
export interface PasskeyWrapper extends PasskeyMetadata { iv: string; ciphertext: string; }
export interface PasskeyVaultRecord {
  version: typeof PASSKEY_VAULT_VERSION;
  protection: 'passkey';
  rpId: typeof PASSKEY_RP_ID;
  passkeys: PasskeyWrapper[];
  iv: string;
  ciphertext: string;
}

export function validBase64(value: unknown, min: number, max = min): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))) return false;
  const length = value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  return length >= min && length <= max;
}

export function validatePasskeyInput(value: unknown): asserts value is PasskeyInput {
  const input = value as PasskeyInput | null;
  if (!input || !validBase64(input.credentialId, 1, 1024) || !validBase64(input.prfSalt, 32) || !validBase64(input.prf, 32)) throw new Error('Invalid passkey encryption response');
}

export function validatePasskeyRecord(value: unknown): asserts value is PasskeyVaultRecord {
  const record = value as PasskeyVaultRecord | null;
  if (!record || record.version !== PASSKEY_VAULT_VERSION || record.protection !== 'passkey' || record.rpId !== PASSKEY_RP_ID
    || !validBase64(record.iv, 12) || !validBase64(record.ciphertext, 16, PASSKEY_MAX_BACKUP_BYTES)
    || !Array.isArray(record.passkeys) || record.passkeys.length < 1 || record.passkeys.length > PASSKEY_MAX_CREDENTIALS
    || new Set(record.passkeys.map(p => p?.credentialId)).size !== record.passkeys.length
    || record.passkeys.some(p => !p || !validBase64(p.credentialId, 1, 1024) || !validBase64(p.prfSalt, 32) || !validBase64(p.iv, 12) || !validBase64(p.ciphertext, 48))) {
    throw new Error('Invalid passkey vault backup');
  }
}

/** Strictly bounded before JSON parsing; no key material is decrypted here. */
export function parsePasskeyBackup(text: string): PasskeyVaultRecord {
  if (typeof text !== 'string' || text.length > PASSKEY_MAX_BACKUP_BYTES) throw new Error('Invalid passkey vault backup');
  const value = JSON.parse(text);
  if (value?.format !== PASSKEY_BACKUP_FORMAT) throw new Error('Invalid passkey vault backup');
  validatePasskeyRecord(value.vault);
  return value.vault;
}
