import { WALLET_DISPLAY_CACHE_PREFIX as PREFIX } from '@constants/wallet.ts';
import * as vault from '../vault/vault.ts';
import { readPrivateCache, writePrivateCache } from '../storage/private-cache.ts';
import browser from '../../lib/browser.ts';
import { walletDisplayKey, type WalletDisplayCache } from '@domain/wallet/display-cache.ts';

let revision = 0;
vault.onSessionInvalidated(() => { revision++; });
let writes: Promise<void> = Promise.resolve();
export const walletDisplayRevision = () => revision;

export async function readWalletDisplayCache(accountId: string): Promise<WalletDisplayCache | null> {
  if (!accountId) return null;
  if (vault.isLocked()) {
    const data = await browser.storage.local.get(walletDisplayKey(accountId));
    const presence = await browser.storage.local.get(`${walletDisplayKey(accountId)}:presence`);
    const providerType = presence[`${walletDisplayKey(accountId)}:presence`] ?? (data[walletDisplayKey(accountId)] as WalletDisplayCache | undefined)?.providerType;
    return typeof providerType === 'string' || providerType === false ? { providerType } : null;
  }
  return readPrivateCache<WalletDisplayCache>(walletDisplayKey(accountId));
}

export function updateWalletDisplayCache(accountId: string, patch: WalletDisplayCache, expected: number): Promise<void> {
  const save = writes.catch(() => {}).then(async () => {
    if (expected !== revision) return;
    const previous = await readWalletDisplayCache(accountId);
    if (expected !== revision) return;
    const next: WalletDisplayCache = { ...previous, providerType: patch.providerType, updatedAt: Date.now() };
    if (typeof patch.balance === 'number' && Number.isFinite(patch.balance)) next.balance = patch.balance;
    if (patch.transactions) next.transactions = patch.transactions.slice(0, 50).map(({paymentHash, amount, fee, memo, status, createdAt}) => ({paymentHash, amount, fee, memo, status, createdAt}));
    await writePrivateCache(walletDisplayKey(accountId), next);
    await browser.storage.local.set({ [`${walletDisplayKey(accountId)}:presence`]: next.providerType });
  });
  writes = save;
  return save;
}

/** Explicit replacement/disconnection invalidates every older pending read. */
export function resetWalletDisplayCache(accountId: string, providerType: string | false): Promise<void> {
  revision++;
  const save = writes.catch(() => {}).then(async () => {
    await browser.storage.local.remove(walletDisplayKey(accountId));
    await browser.storage.local.set({ [`${walletDisplayKey(accountId)}:presence`]: providerType });
    if (!vault.isLocked()) await writePrivateCache(walletDisplayKey(accountId), { providerType });
  });
  writes = save;
  return save;
}

export function clearWalletDisplayCaches(accountId?: string): Promise<void> {
  revision++;
  const save = writes.catch(() => {}).then(async () => {
    const keys = accountId ? [walletDisplayKey(accountId), `${walletDisplayKey(accountId)}:presence`] : Object.keys(await browser.storage.local.get(null)).filter(key => key.startsWith(PREFIX));
    await browser.storage.local.remove(keys);
  });
  writes = save;
  return save;
}

// Migrate every old wallet record at unlock, including accounts not opened in the UI.
vault.onUnlock(async () => {
  const data = await browser.storage.local.get(null);
  for (const key of Object.keys(data).filter(key => key.startsWith(PREFIX) && !key.endsWith(':presence'))) {
    try {
      const cache = await readPrivateCache<WalletDisplayCache>(key);
      if (cache) await browser.storage.local.set({ [`${key}:presence`]: cache.providerType });
    } catch { /* Preserve an unreadable encrypted record; never expose it as plaintext. */ }
  }
});
