export const PERMISSIONS_STORAGE_KEY = 'signerPermissions';

export const GLOBAL_DEFAULTS_KEY = 'signerUseGlobalDefaults';

export const DEFAULT_BUCKET = '_default';

// Decisions: "allow" | "deny" | "ask"

// Event kinds that are part of the "send a DM" flow. signEvent for any of
// these collapses into the sendMessages permission so a single approval
// covers both the encrypt step and the matching signEvent.
//   4    NIP-04 legacy DM
//   13   NIP-59 seal (wraps an encrypted DM)
//   14   NIP-17 chat rumor
//   1059 NIP-59 gift wrap
export const DM_SIGN_KINDS = new Set<number>([4, 13, 14, 1059]);

export const DISMISS_DURATION_KEY = 'dismissDurationMs';

export const SESSION_DISMISSED_KEY = 'sessionDismissedDomains';

/** 0 means "until the browser restarts". */
export const DISMISS_DURATIONS = [0, 86_400_000, 604_800_000, 2_592_000_000] as const;

export const DISMISS_DURATION_DEFAULT = 604_800_000;

// ── Wait for domain to be connected ──

export const CONNECT_WAIT_TIMEOUT_MS = 120_000;

/**
 * Which permission rules exist, and which are worth offering.
 *
 * Deliberately separate from `permissions.ts`: that module imports `t()` for
 * its labels, which drags the whole i18n/browser layer in and makes it
 * unloadable under plain `node --test`. These are the parts that decide
 * something, so they are the parts worth testing — and they need no i18n.
 */

/**
 * The three answers a permission rule can hold.
 *
 * `tests/i18n-keys.test.ts` reads this array to check that `perms.allow`,
 * `perms.deny` and `perms.ask` exist in every locale, so it lives in one place
 * rather than in each screen that renders the chips.
 */
export const DECISIONS = ['allow', 'deny', 'ask'] as const;

/** Permission keys a read-only or remote-signer account can meaningfully hold. */
export const READ_ONLY_KEYS = ['getPublicKey'];

export const COMMON_PERM_KEYS = [
  'getPublicKey',
  'signEvent:0',
  'signEvent:1',
  'signEvent:3',
  'signEvent:5',
  'signEvent:6',
  'signEvent:7',
  'signEvent:1111',
  'signEvent:9734',
  'signEvent:24242',
  'signEvent:27235',
  'signEvent:30023',
  'readMessages',
  'sendMessages',
];
