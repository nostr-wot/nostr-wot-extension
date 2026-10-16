/** Dedicated RP: the marketing site's origin cannot request these credentials. */
export const PASSKEY_RP_ID = 'passkeys.nostrwot.com';
export const PASSKEY_VAULT_VERSION = 2;
export const PASSKEY_BACKUP_FORMAT = 'nostr-wot-passkey-vault';
export const PASSKEY_TIMEOUT_MS = 120_000;
export const PASSKEY_MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const PASSKEY_MAX_CREDENTIALS = 8;
export const PASSKEY_KDF_CONTEXT = 'nostr-wot/vault/passkey-wrap/v1';

/** Bound provider recovery independently from file import; smaller provider quotas fall back to a file. */
export const PASSKEY_MAX_BLOB_BYTES = 64 * 1024;

/** Existing registrations retain this RP; credentials cannot move between domains. */
export const LEGACY_PASSKEY_RP_ID = 'passkeys.nostr-wot.com';
export const PASSKEY_RECOVERY_PRF = 'a2V5dHItdjE='; // UTF-8 keytr-v1
export const PASSKEY_RECOVERY_KIND = 31777;
export const PASSKEY_RECOVERY_MAX_BYTES = 64 * 1024;
export const PASSKEY_RECOVERY_VERSION = 4;
export const PASSKEY_RECOVERY_SCHEMAS = { seed: 'com.nostrwot.seed.v1', vault: 'com.nostrwot.vault.v1' } as const;

export const PASSKEY_PENDING_RECOVERY_KEY = 'pendingPasskeyRecovery';
export const PASSKEY_PENDING_RECOVERY_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_RECOVERY_RELAY_TIMEOUT_MS = 10000;
export const PASSKEY_RECOVERY_CANDIDATE_LIMIT = 5;

export const PASSKEY_MAX_NAME_LENGTH = 80;

export const PASSKEY_RECOVERY_STATUS_PREFIX = 'passkeyRecoveryStatus:';
export const PASSKEY_RECOVERY_MAX_RELAYS = 16;
