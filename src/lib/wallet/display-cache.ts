import browser from '../browser.ts';
import type { Transaction } from './types.ts';

/** Display data only. Credentials, invoices and preimages never enter this cache. */
export interface WalletDisplayCache {
  providerType: string | false;
  balance?: number;
  transactions?: Transaction[];
  updatedAt?: number;
}
const PREFIX = 'walletDisplay_';
let revision = 0;
let writes: Promise<void> = Promise.resolve();
export const walletDisplayKey = (accountId: string) => `${PREFIX}${accountId}`;
export const walletDisplayRevision = () => revision;

export async function readWalletDisplayCache(accountId: string): Promise<WalletDisplayCache | null> {
  if (!accountId) return null;
  const data = await browser.storage.local.get(walletDisplayKey(accountId));
  return data[walletDisplayKey(accountId)] as WalletDisplayCache || null;
}

export function updateWalletDisplayCache(accountId: string, patch: WalletDisplayCache, expected: number): Promise<void> {
  const save = writes.catch(() => {}).then(async () => {
    if (expected !== revision) return;
    const previous = await readWalletDisplayCache(accountId);
    if (expected !== revision) return;
    const next: WalletDisplayCache = { ...previous, providerType: patch.providerType, updatedAt: Date.now() };
    if (typeof patch.balance === 'number' && Number.isFinite(patch.balance)) next.balance = patch.balance;
    if (patch.transactions) next.transactions = patch.transactions.slice(0, 50).map(({paymentHash, amount, fee, memo, status, createdAt}) => ({paymentHash, amount, fee, memo, status, createdAt}));
    await browser.storage.local.set({ [walletDisplayKey(accountId)]: next });
  });
  writes = save;
  return save;
}

/** Explicit replacement/disconnection invalidates every older pending read. */
export function resetWalletDisplayCache(accountId: string, providerType: string | false): Promise<void> {
  revision++;
  const save = writes.catch(() => {}).then(() => browser.storage.local.set({ [walletDisplayKey(accountId)]: { providerType } }));
  writes = save;
  return save;
}

export function clearWalletDisplayCaches(accountId?: string): Promise<void> {
  revision++;
  const save = writes.catch(() => {}).then(async () => {
    const keys = accountId ? [walletDisplayKey(accountId)] : Object.keys(await browser.storage.local.get(null)).filter(key => key.startsWith(PREFIX));
    await browser.storage.local.remove(keys);
  });
  writes = save;
  return save;
}
