import type { SafeAccount } from '@domain/accounts/types.ts';
import { PASSKEY_MAX_NAME_LENGTH, LEGACY_PASSKEY_RP_ID, PASSKEY_VAULT_VERSION, PASSKEY_MAX_BACKUP_BYTES, PASSKEY_MAX_CREDENTIALS, PASSKEY_BACKUP_FORMAT, PASSKEY_RECOVERY_PRF } from '@constants/passkey.ts';

export type RecoveryScope = 'private-key' | 'seed' | 'vault';
export interface PasskeyMetadata { name?: string; credentialId: string; prfSalt: string; rpId?: string; recoveryPubkey?: string; recoveryScope?: RecoveryScope; }
export function validRpId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes('.') && value.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}
function validMetadata(input: PasskeyMetadata): boolean {
  return (input.name === undefined || (validPasskeyName(input.name))) && ((input.recoveryPubkey === undefined) === (input.recoveryScope === undefined)) && (input.rpId === undefined || validRpId(input.rpId)) && (input.recoveryPubkey === undefined || /^[0-9a-f]{64}$/.test(input.recoveryPubkey)) && (input.recoveryScope === undefined || ['private-key', 'seed', 'vault'].includes(input.recoveryScope));
}
function validPrfSalt(value: unknown): boolean { return value === PASSKEY_RECOVERY_PRF || validBase64(value, 32); }
/** PRF output is transient secret material: never persist or log this request. */
export interface PasskeyInput extends PasskeyMetadata { prf: string; largeBlobSupported?: boolean; }
export interface PasskeyProof { credentialId: string; prf: string; }
export interface PasskeyWrapper extends PasskeyMetadata { iv: string; ciphertext: string; }
export interface PasskeyVaultRecord {
  version: typeof PASSKEY_VAULT_VERSION;
  protection: 'passkey';
  rpId: string;
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
  if (!input || !validBase64(input.credentialId, 1, 1024) || !validPrfSalt(input.prfSalt) || !validMetadata(input) || !validBase64(input.prf, 32)) throw new Error('Invalid passkey encryption response');
}

export function validatePasskeyRecord(value: unknown): asserts value is PasskeyVaultRecord {
  const record = value as PasskeyVaultRecord | null;
  if (!record || record.version !== PASSKEY_VAULT_VERSION || record.protection !== 'passkey' || !validRpId(record.rpId)
    || !validBase64(record.iv, 12) || !validBase64(record.ciphertext, 16, PASSKEY_MAX_BACKUP_BYTES)
    || !Array.isArray(record.passkeys) || record.passkeys.length < 1 || record.passkeys.length > PASSKEY_MAX_CREDENTIALS
    || new Set(record.passkeys.map(p => p?.credentialId)).size !== record.passkeys.length
    || record.rpId !== (record.passkeys[0]?.rpId ?? LEGACY_PASSKEY_RP_ID)
    || record.passkeys.some(p => !p || !validBase64(p.credentialId, 1, 1024) || !validPrfSalt(p.prfSalt) || !validMetadata(p) || !validBase64(p.iv, 12) || !validBase64(p.ciphertext, 48))) {
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

/** Prefer the active local signer; remote and watch-only identities cannot sign recovery events. */
export function passkeyRecoveryAccount(accounts: readonly SafeAccount[], activePubkey: string): SafeAccount | undefined {
  const local = accounts.filter(account => !account.readOnly && (account.type === 'generated' || account.type === 'nsec'));
  return local.find(account => account.pubkey === activePubkey) ?? local[0];
}

/** Labels are presentation metadata, never credential identity or encryption input. */
export function passkeyDisplayName(credential: PasskeyMetadata, index: number, fallback: string): string {
  return credential.name?.trim() || `${fallback} ${index + 1}`;
}

export function validPasskeyName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PASSKEY_MAX_NAME_LENGTH && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}


export interface RelayRecoveryHealth {
  relay: string;
  status: 'found' | 'missing' | 'unavailable' | 'invalid';
  checkedAt: number;
  createdAt?: number;
  eventId?: string;
}

export interface PasskeyRecoveryStatus { blobSaved: boolean | null; relays: string[]; accepted: Record<string, { eventId: string; acceptedAt: number }>; }

/** Counts only locally registered credentials; providers cannot be silently enumerated. */
export function defaultPasskeyName(existingCount = 0): string {
  return existingCount === 0 ? "Nostr WoT Main" : `Nostr WoT Account ${existingCount + 1}`;
}
