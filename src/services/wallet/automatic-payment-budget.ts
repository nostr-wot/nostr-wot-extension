import { WALLET_AUTO_BUDGET_PREFIX, WALLET_AUTO_BUDGET_WINDOW_MS } from '@constants/wallet.ts';
import { readPrivateCache, writePrivateCache } from '../storage/private-cache.ts';

interface BudgetStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}
interface Reservation { at: number; msats: number }

/** One instance in the background worker serializes each account's durable reservations.
 * Reservations intentionally survive payment errors: a timeout may mean the wallet paid.
 * A failed storage operation disables silent approval; callers can still ask the user.
 */
export function createAutomaticPaymentBudget(storage: BudgetStorage = {
  read: readPrivateCache,
  write: writePrivateCache,
}) {
  const queues = new Map<string, Promise<unknown>>();
  return async (accountId: string, amountMsats: number, thresholdSats: number, now = Date.now()): Promise<boolean> => {
    const limit = thresholdSats * 1000;
    if (!accountId || !Number.isSafeInteger(amountMsats) || amountMsats <= 0
      || !Number.isSafeInteger(thresholdSats) || thresholdSats <= 0
      || !Number.isSafeInteger(limit) || amountMsats > limit || !Number.isSafeInteger(now)) return false;
    const prior = queues.get(accountId) ?? Promise.resolve();
    const operation = prior.catch(() => {}).then(async () => {
      const key = `${WALLET_AUTO_BUDGET_PREFIX}${accountId}`;
      const raw = await storage.read(key);
      if (raw !== null && (!Array.isArray(raw) || raw.some(entry => !entry
        || !Number.isSafeInteger(entry.at) || !Number.isSafeInteger(entry.msats) || entry.msats <= 0))) return false;
      const active = ((raw ?? []) as Reservation[]).filter(entry => entry.at > now - WALLET_AUTO_BUDGET_WINDOW_MS);
      const spent = active.reduce((sum, entry) => sum + BigInt(entry.msats), 0n);
      if (spent + BigInt(amountMsats) > BigInt(limit)) return false;
      active.push({ at: now, msats: amountMsats });
      await storage.write(key, active);
      return true;
    }).catch(() => false);
    queues.set(accountId, operation);
    try { return await operation; }
    finally { if (queues.get(accountId) === operation) queues.delete(accountId); }
  };
}

export const reserveAutomaticPayment = createAutomaticPaymentBudget();
