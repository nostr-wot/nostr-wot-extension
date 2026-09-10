/** Activity log max entries per domain */
export const ACTIVITY_LOG_MAX_PER_DOMAIN = 200;

/** Activity log global max entries */
export const ACTIVITY_LOG_GLOBAL_MAX = 2000;

// ── Filtering ──

/**
 * Which wire methods each grouped type filter covers.
 *
 * `encrypt` and `decrypt` deliberately span both NIP-04 and NIP-44: to a user
 * asking "what did this site read?", the scheme is an implementation detail.
 * Advanced mode exposes the four individually.
 */
export const TYPE_METHODS: Record<string, string[]> = {
  signEvent: ['signEvent'],
  getPublicKey: ['getPublicKey'],
  encrypt: ['nip04Encrypt', 'nip44Encrypt'],
  decrypt: ['nip04Decrypt', 'nip44Decrypt'],
  nip04Encrypt: ['nip04Encrypt'],
  nip04Decrypt: ['nip04Decrypt'],
  nip44Encrypt: ['nip44Encrypt'],
  nip44Decrypt: ['nip44Decrypt'],
};

/** Display order for the type-filter chips in simple mode. */
export const SIMPLE_TYPE_ORDER = ['signEvent', 'getPublicKey', 'encrypt', 'decrypt'];

/** Display order in advanced mode — one chip per wire method instead of the
 *  collapsed encrypt/decrypt pair. */
export const ADVANCED_TYPE_ORDER = ['signEvent', 'getPublicKey', 'nip04Encrypt', 'nip44Encrypt', 'nip04Decrypt', 'nip44Decrypt'];

/** Rendered rows per page. Grown by the "show more" button, reset whenever
 *  the filters narrowing `rawLog` change (see the effect below). */
export const ACTIVITY_PAGE_SIZE = 40;

/** Translation keys for `availableTypeKeys`' chip keys. A key lookup rather
 *  than the translated text itself, so it can live at module scope without
 *  freezing in whatever language was active on first import — `t()` still
 *  runs at render time, in `typeOptions` below. Kept out of the domain module
 *  because that layer stays i18n-free (see docs/component-standards.md §6,
 *  `permissionRules.ts`). */
export const TYPE_LABEL_KEYS: Record<string, string> = {
  signEvent: 'approval.signEvent',
  getPublicKey: 'perm.readProfile',
  encrypt: 'activity.sendMessage',
  decrypt: 'activity.readMessage',
  nip04Encrypt: 'activity.sendNip04',
  nip44Encrypt: 'activity.sendNip44',
  nip04Decrypt: 'activity.readNip04',
  nip44Decrypt: 'activity.readNip44',
};

/** Maximum retained ciphertext string length; never stores plaintext. */
export const ACTIVITY_MAX_CIPHERTEXT_LENGTH = 131072;

/** Serialized UTF-8 budgets, including JSON punctuation and metadata. */
export const ACTIVITY_ENTRY_MAX_BYTES = 256 * 1024;
export const ACTIVITY_LOG_MAX_BYTES = 4 * 1024 * 1024;
