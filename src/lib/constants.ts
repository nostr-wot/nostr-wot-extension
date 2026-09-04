/**
 * Shared constants — timeouts, rate limits, and other magic numbers.
 * @module lib/constants
 */

// ── Timeouts ──

/** Signer request timeout (2 minutes) */
export const SIGNER_REQUEST_TIMEOUT_MS = 120_000;

/** NWC wallet request timeout (1 minute) */
export const NWC_REQUEST_TIMEOUT_MS = 60_000;

/** Mute list fetch timeout */
export const MUTE_LIST_FETCH_TIMEOUT_MS = 8_000;

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

// ── Crypto ──

/** PBKDF2 iterations for vault encryption */
export const PBKDF2_ITERATIONS = 210_000;

/** Minimum password length */
export const MIN_PASSWORD_LENGTH = 8;

// ── Cache ──

/** Profile metadata cache TTL (30 minutes) */
export const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Activity log max entries per domain */
export const ACTIVITY_LOG_MAX_PER_DOMAIN = 200;

/** Activity log global max entries */
export const ACTIVITY_LOG_GLOBAL_MAX = 2000;

// ── Vault ──

/** Default auto-lock timeout (15 minutes) */
export const DEFAULT_AUTO_LOCK_MS = 900_000;

/** Vault unlock polling interval */
export const VAULT_POLL_INTERVAL_MS = 500;

// ── Onboarding ──

/** Pending onboarding account TTL (5 minutes) */
export const ONBOARDING_PENDING_TTL_MS = 5 * 60 * 1000;

// ── Storage keys observed across contexts ──

/**
 * Bumped whenever the vault's lock state changes in EITHER direction, so an open
 * popup can re-read it.
 *
 * Locking was the obvious half. Unlocking matters just as much and is less
 * obvious: on a "Never lock" vault the background auto-unlocks on every
 * service-worker cold start, and a popup that asked while that was still running
 * got told "locked" and had no way to ever learn otherwise.
 *
 * The value is only a change marker — a timestamp, never read for its meaning.
 *
 * It lives here rather than in `lib/vault.ts` so the popup can watch for it
 * without importing the vault module — and with it the whole crypto stack —
 * into its bundle. `storage.onChanged` is the only channel that works for this:
 * runtime messages are not delivered back to the document that sent them, and a
 * background broadcast reaches only a popup that is already listening.
 */
export const LOCK_STATE_KEY = 'vaultLockStateAt';
