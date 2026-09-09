import type { AutoLockOption } from '@domain/vault/autoLock.ts';

// ── Crypto ──

/** Legacy/empty-password vault format; never substitute for the active work factor. */
export const LEGACY_VAULT_PBKDF2_ITERATIONS = 210_000;

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

export const VAULT_STORAGE_KEY = 'keyVault';

export const VAULT_VERSION = 1;

// PBKDF2 work factor, in iterations of HMAC-SHA-256.
//
// 600,000 is OWASP's recommendation for PBKDF2-HMAC-SHA-256. The previous value,
// 210,000, is OWASP's figure for SHA-**512** — the wrong row of the same table, which
// made the parameter look calibrated while being ~2.9x weak. Existing vaults record the
// count they were written with and are upgraded transparently on the next unlock.
export const VAULT_PBKDF2_ITERATIONS = 600000;

export const KEEPALIVE_ALARM = 'vault-keepalive';

// Chrome clamps alarm periods to a 30s (0.5 min) minimum; we just need any
// periodic wake to reset the service-worker idle timer while unlocked.
export const KEEPALIVE_PERIOD_MIN = 0.5;

export const AUTO_LOCK_OPTIONS: readonly AutoLockOption[] = [
  { ms: 300000, labelKey: 'security.5min' },
  { ms: DEFAULT_AUTO_LOCK_MS, labelKey: 'security.15min' },
  { ms: 3600000, labelKey: 'security.1hr' },
  { ms: 0, labelKey: 'security.never' },
] as const;

// ── Unlock brute-force guard (persisted, background-side) ──
//
// The popup's useVaultUnlock hook has its own escalating lockout, but that
// state is in-page and resets on reload. This counter lives in storage.local
// so repeated vault_unlock RPCs hit a server-side lockout regardless of how
// the caller resets its UI. Reset on successful unlock and on vault_destroy.

export const UNLOCK_GUARD_KEY = 'vaultUnlockGuard';

export const UNLOCK_FAILURES_PER_LOCKOUT = 5;

// Every 5 consecutive failures: 1 min, 5 min, 15 min, 30 min (cap)
export const UNLOCK_LOCKOUT_STEPS_MS = [60_000, 300_000, 900_000, 1_800_000];
