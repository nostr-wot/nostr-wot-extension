/** Formats offered by the account import wizard; these are detection hints, not validation. */
export const ENCRYPTED_PRIVATE_KEY_PREFIX = 'ncryptsec1';
export const PRIVATE_KEY_PREFIX = 'nsec1';
export const PRIVATE_KEY_HEX_PATTERN = /^[0-9a-f]{64}$/i;
export const IMPORT_MNEMONIC_WORD_COUNTS: readonly number[] = [12, 24];
export const PQC_SEED_WORD_COUNT = 24;

/** Newly generated accounts need 256-bit seeds for post-quantum derivation. */
export const GENERATED_MNEMONIC_STRENGTH_BITS = 256;

export const MAX_ACCOUNT_NAME_LENGTH = 100;
export const SUBACCOUNT_PREVIEW_DELAY_MS = 350;
