/**
 * Structural, so this module imports nothing: pulling in `rpc` would drag the
 * browser layer along and make the file unloadable under plain `node --test`,
 * which is the point of having it separate.
 */
type RpcCall = <T>(method: string, params?: unknown) => Promise<T>;

/**
 * Is the vault usable right now, auto-unlocking a never-lock vault if so?
 *
 * A "never lock" vault is stored under the empty password, so a surface that
 * needs it open can simply open it. Four screens did that, and they did not all
 * do it the same way: three checked `autoLockMs === 0` first, and PasswordStep
 * did not — it tried the empty password on *any* locked vault.
 *
 * That is not a harmless probe. The background counts failed unlocks in a
 * persisted brute-force guard (`vaultUnlockGuard`), so on an ordinary
 * timed-lock vault every attempt was a guaranteed failure charged against the
 * user: an abandoned wizard sitting on that step re-ran it on each popup open,
 * and five opens reached a lockout without a password ever being typed.
 *
 * Asking for the mode first costs one RPC and means the empty password is only
 * ever offered where it is genuinely the right one.
 */
export async function isVaultOpen(call: RpcCall): Promise<boolean> {
  const locked = await call<boolean>('vault_isLocked');
  if (!locked) return true;

  const autoLockMs = await call<number>('vault_getAutoLock');
  if (autoLockMs !== 0) return false;

  return !!(await call<boolean>('vault_unlock', { password: '' }));
}
