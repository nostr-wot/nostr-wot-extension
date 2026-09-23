import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { readPrivateCache, writePrivateCache, removePrivateCache } from '../storage/private-cache.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { paymentRecordsKey, type PaymentNotice } from '@domain/wallet/payment-records.ts';
import type { Transaction } from '@domain/wallet/types.ts';

interface Records { notes: Record<string, string>; notices: PaymentNotice[]; }
const writes = new AsyncLock();
const empty = (): Records => ({ notes: {}, notices: [] });

async function change(accountId: string, assertCurrent: () => void, update: (records: Records) => void) {
  return writes.run(async () => {
    assertCurrent();
    const records = await readPrivateCache<Records>(paymentRecordsKey(accountId)) || empty();
    assertCurrent();
    update(records);
    await writePrivateCache(paymentRecordsKey(accountId), records);
  });
}

/** Store before dispatch: a lock after settlement must not erase the sender's note.
 * Notes are display metadata, never evidence that a payment settled. */
export async function savePaymentNote(accountId: string, hash: string, note: string, assertCurrent: () => void) {
  if (!note.trim()) return;
  await change(accountId, assertCurrent, records => {
    records.notes = Object.fromEntries([...Object.entries(records.notes).filter(([key]) => key !== hash), [hash, note.slice(0, 1000)]].slice(-500));
  });
}

export async function applyPaymentNotes(accountId: string, transactions: Transaction[]): Promise<Transaction[]> {
  const records = await readPrivateCache<Records>(paymentRecordsKey(accountId));
  return transactions.map(tx => tx.amount < 0 && records?.notes[tx.paymentHash]
    ? { ...tx, memo: records.notes[tx.paymentHash] } : tx);
}

export async function recordPaymentSuccess(accountId: string, origin: string, amount: number, assertCurrent: () => void) {
  await change(accountId, assertCurrent, records => {
    records.notices = [...records.notices, { id: crypto.randomUUID(), origin, amount, timestamp: Date.now() }].slice(-20);
  });
}

export async function getPaymentNotices(accountId: string): Promise<PaymentNotice[]> {
  return (await readPrivateCache<Records>(paymentRecordsKey(accountId)))?.notices || [];
}

export async function acknowledgePaymentNotices(accountId: string, ids: string[], assertCurrent: () => void) {
  await change(accountId, assertCurrent, records => {
    records.notices = records.notices.filter(notice => !ids.includes(notice.id));
  });
}

export async function clearPaymentRecords(accountId?: string) {
  await writes.run(async () => {
    const keys = accountId ? [paymentRecordsKey(accountId)] : Object.keys(await browser.storage.local.get(null)).filter(key => key.startsWith(paymentRecordsKey('')));
    for (const key of keys) await removePrivateCache(key);
  });
}

// Encrypted records are also erased by private-cache's destroy hook.
vault.onDestroy(() => clearPaymentRecords());
