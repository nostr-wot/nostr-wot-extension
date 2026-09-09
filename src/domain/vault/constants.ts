// ── Crypto ──

/** PBKDF2 iterations for vault encryption */
export const PBKDF2_ITERATIONS = 210_000;

/** Minimum password length */
export const MIN_PASSWORD_LENGTH = 8;

// ── Vault ──

/** Default auto-lock timeout (15 minutes) */
export const DEFAULT_AUTO_LOCK_MS = 900_000;

/** Vault unlock polling interval */
export const VAULT_POLL_INTERVAL_MS = 500;

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
 * It lives here rather than in `services/vault/vault.ts` so the popup can watch for it
 * without importing the vault module — and with it the whole crypto stack —
 * into its bundle. `storage.onChanged` is the only channel that works for this:
 * runtime messages are not delivered back to the document that sent them, and a
 * background broadcast reaches only a popup that is already listening.
 */
export const LOCK_STATE_KEY = 'vaultLockStateAt';
