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
