import * as vault from '../vault/vault.ts';
import browser from '@lib/browser.ts';
import type { AccountType } from '@domain/accounts/types.ts';
import { GET_PUBLIC_KEY_COOLDOWN_MS } from '@constants/signing.ts';

// Per-origin getPublicKey cooldown (origin → expiresAt epoch ms).
// After the user approves a getPublicKey request, additional getPublicKey calls
// from the same origin auto-approve until expiresAt. Cleared on account switch
// and on cleanupStale.
const _getPubkeyCooldown: Map<string, number> = new Map();

export function isGetPubkeyCooldownActive(origin: string): boolean {
  const expires = _getPubkeyCooldown.get(origin);
  if (!expires) return false;
  if (Date.now() < expires) return true;
  _getPubkeyCooldown.delete(origin);
  return false;
}

/**
 * Invalidate the getPublicKey auto-approve cooldown.
 * Call when permissions for the origin are explicitly changed by the user
 * so the cooldown cannot outlive a revoke.
 * @param origin - origin to clear; if omitted, clears all origins.
 */
export function clearGetPubkeyCooldown(origin?: string): void {
  if (origin) _getPubkeyCooldown.delete(origin);
  else _getPubkeyCooldown.clear();
}

/**
 * Get info about the currently active account for permission checks.
 *
 * storage.local.activeAccountId is the SINGLE SOURCE OF TRUTH for which account
 * is active.  The vault's internal activeAccountId can diverge after service-worker
 * restarts + auto-unlock, so we never trust it here.
 */
export async function getActiveAccountInfo(): Promise<{ accountId: string | null; accountType: AccountType | null }> {
  const data = await browser.storage.local.get(['accounts', 'activeAccountId']);
  const accountId: string | null = data.activeAccountId as string | null;

  if (!accountId) {
    return { accountId: null, accountType: null };
  }

  // Look up account type from the accounts list (covers all account types)
  const storageAcct = ((data.accounts || []) as Array<{ id: string; type?: string }>).find((a: { id: string; type?: string }) => a.id === accountId);
  if (storageAcct) {
    return { accountId, accountType: (storageAcct.type || 'generated') as AccountType };
  }

  // Account ID set but not found in accounts array -- shouldn't happen
  return { accountId, accountType: null };
}

/**
 * Get the active account's public key
 * @returns hex pubkey
 */
export async function getActivePublicKey(): Promise<string | null> {
  // storage.sync.myPubkey is the canonical source -- always updated by switchAccount/loadConfig
  const data = await browser.storage.sync.get('myPubkey');
  if (data.myPubkey) return data.myPubkey as string;

  // Fallback to vault (e.g., during initial setup before sync storage is set)
  return vault.getActivePubkey();
}
export function startGetPubkeyCooldown(origin: string): void { _getPubkeyCooldown.set(origin, Date.now() + GET_PUBLIC_KEY_COOLDOWN_MS); }
