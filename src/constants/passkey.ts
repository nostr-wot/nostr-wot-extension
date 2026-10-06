/** Dedicated RP: the marketing site's origin cannot request these credentials. */
export const PASSKEY_RP_ID = 'passkeys.nostr-wot.com';
export const PASSKEY_VAULT_VERSION = 2;
export const PASSKEY_BACKUP_FORMAT = 'nostr-wot-passkey-vault';
export const PASSKEY_TIMEOUT_MS = 120_000;
export const PASSKEY_MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const PASSKEY_MAX_CREDENTIALS = 8;
export const PASSKEY_KDF_CONTEXT = 'nostr-wot/vault/passkey-wrap/v1';
