/**
 * Shared constants — timeouts, rate limits, and other magic numbers.
 * @module constants/signing
 */

// ── Timeouts ──

/** Signer request timeout (2 minutes) */
export const SIGNER_REQUEST_TIMEOUT_MS = 120_000;

/** NIP-07 call timeout (inject.ts → content.ts) */
export const NIP07_CALL_TIMEOUT_MS = 120_000;

/**
 * After the user approves a getPublicKey request for an origin, additional
 * getPublicKey requests from the same origin auto-approve for this window.
 * Suppresses the typical "site calls getPublicKey twice on init" double prompt
 * without weakening the per-request consent model for any other method.
 * Per-origin and not persisted across service-worker restarts.
 */
export const GET_PUBLIC_KEY_COOLDOWN_MS = 60_000;

/** WebLN call timeout (inject.ts → content.ts) */
export const WEBLN_CALL_TIMEOUT_MS = 120_000;

// Cap on concurrently-pending ACTIONABLE requests per origin. Blunts
// popup-spam / DoS from a connected tab: once an origin has this many
// unresolved prompts, further queueRequest calls are rejected immediately.
export const MAX_PENDING_PER_ORIGIN = 5;

export const NIP07_SIGNING_METHODS = new Set([
    'nip07_signEvent', 'nip07_nip04Encrypt', 'nip07_nip04Decrypt',
    'nip07_nip44Encrypt', 'nip07_nip44Decrypt'
]);

/** Bound locally retained unread rejection summaries; never store event content. */
export const SIGNER_REJECTIONS_KEY = 'signerRejections';
export const MAX_SIGNER_REJECTIONS = 100;
export const SIGNER_BADGE_PENDING_COLOR = '#f59e0b';
export const SIGNER_BADGE_REJECTED_COLOR = '#dc2626';

/** Includes approval, unlock, remote work and permission/connect waits. */
export const MAX_IN_FLIGHT_PER_ORIGIN = 64;
export const MAX_IN_FLIGHT_GLOBAL = 256;
/** Full event JSON bytes, including tags; accommodates large contact lists. */
export const MAX_EVENT_BYTES = 1024 * 1024;
export const MAX_EVENT_TAGS = 10_000;
export const MAX_TAG_VALUES = 1024;
export const MAX_CRYPTO_PLAINTEXT_BYTES = 65535;
export const MAX_CRYPTO_CIPHERTEXT_LENGTH = 131072;

/** Last signed kind:3, kept separately from verified published relay data. */
export const SIGNED_FOLLOW_LIST_PREFIX = 'signedFollowList_';
