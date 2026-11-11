import { PaymentOutcomeUnknownError } from './payment-errors.ts';
import {
  PAYMENT_INTENTS_STORAGE_KEY as STORE_KEY,
  PAYMENT_INTENT_TTL_MS as TTL_MS,
  PAYMENT_INTENT_STUCK_TTL_MS as STUCK_TTL_MS,
} from '@constants/wallet.ts';
/**
 * At-most-once execution for payments that cannot be safely repeated.
 *
 * The popup sends each payment RPC once. A Lightning Address resolves to a fresh
 * invoice on each invocation, so we also protect against duplicate delivery of
 * the same intent across handler calls and worker restarts. The popup stamps
 * one intent ID per click and a completed intent returns its saved result.
 *
 * Records live in `storage.session`, not in a module variable, because the
 * point is to survive exactly the service-worker teardown that causes the
 * retry. They hold an intent id and a payment result — no key material.
 *
 * @module services/wallet/payment-intents
 */

import { sealPrivateValue, openPrivateValue, isPrivateEnvelope } from '../storage/private-cache.ts';
import * as vault from '../vault/vault.ts';
import browser from '../../lib/browser.ts';
import { AsyncLock } from '../../utils/asyncLock.ts';
import { PAYMENT_IN_FLIGHT } from '@constants/wallet.ts';

/**
 * Serializes the whole store, the way services/signing/signer.ts and services/permissions/permissions.ts do
 * for their own session-storage maps. Read-modify-write on a single key is not
 * atomic: two claims that both read before either writes will each write back a
 * map missing the other's record.
 */
const _lock = new AsyncLock();

interface IntentRecord {
  status: 'in-flight' | 'done' | 'unknown';
  result?: unknown;
  at: number;
}

type IntentStore = Record<string, IntentRecord>;

/** Read and prune. Callers must already hold `_lock`. */
async function readStoreLocked(): Promise<IntentStore> {
  const data = await browser.storage.session.get(STORE_KEY) as Record<string, unknown>;
  const store = (data?.[STORE_KEY] as IntentStore | undefined) || {};
  // Prune on read — there is no other moment we are guaranteed to run.
  const now = Date.now();
  let pruned = false;
  for (const [id, rec] of Object.entries(store)) {
    if (!rec || typeof rec.at !== 'number') {
      delete store[id];
      pruned = true;
      continue;
    }
    if (rec.status === 'unknown') continue;
    const ttl = rec.status === 'in-flight' ? STUCK_TTL_MS : TTL_MS;
    if (rec.at < now - ttl) {
      delete store[id];
      pruned = true;
    }
  }
  if (pruned) await writeStoreLocked(store);
  return store;
}

/** Callers must already hold `_lock`. */
async function writeStoreLocked(store: IntentStore): Promise<void> {
  await browser.storage.session.set({ [STORE_KEY]: store });
}

/**
 * Run `send` at most once for `intentId`.
 *
 * - First call: records the intent, runs `send`, remembers the result.
 * - Replay of a completed intent: returns the remembered result, sends nothing.
 * - Replay while the first is still running: throws rather than send twice.
 * - No `intentId`: runs unguarded, so an older popup keeps working.
 *
 * A definite failure clears the record, because the caller sees the error
 * and decides what to do next — `rpc()` does not retry application errors, only
 * transport failures. An ambiguous published payment retains an `unknown` marker
 * without an expiry: retrying that intent must never request another invoice.
 * The user must inspect wallet history before initiating a new payment.
 */
export async function runPaymentOnce<T>(
  intentId: string | undefined,
  send: () => Promise<T>,
): Promise<T> {
  if (!intentId) return send();

  // Claiming the intent — read, check, mark in-flight — has to be one atomic
  // step. Unserialized, two concurrent claims both read "absent" and the second
  // write erases the first's marker; a retry of the erased one then finds no
  // record and sends a second, unrelated invoice. That is the exact failure this
  // module exists to prevent, so the guard cannot itself be racy.
  const existing = await _lock.run(async () => {
    const store = await readStoreLocked();
    const rec = store[intentId];
    if (rec) return rec;
    store[intentId] = { status: 'in-flight', at: Date.now() };
    await writeStoreLocked(store);
    return null;
  });

  if (existing?.status === 'done') {
    if (!isPrivateEnvelope(existing.result)) throw new Error(PAYMENT_IN_FLIGHT);
    return openPrivateValue<T>(`${STORE_KEY}/${intentId}`, existing.result);
  }
  if (existing?.status === 'unknown') throw new PaymentOutcomeUnknownError();
  if (existing?.status === 'in-flight') {
    throw new Error(PAYMENT_IN_FLIGHT);
  }

  let result: T;
  try {
    result = await send();
  } catch (err) {
    await _lock.run(async () => {
      const store = await readStoreLocked();
      if (err instanceof PaymentOutcomeUnknownError) store[intentId] = { status: 'unknown', at: Date.now() };
      else delete store[intentId];
      await writeStoreLocked(store);
    });
    throw err;
  }

  await _lock.run(async () => {
    const store = await readStoreLocked();
    const encrypted = await sealPrivateValue(`${STORE_KEY}/${intentId}`, result);
    store[intentId] = { status: 'done', result: encrypted, at: Date.now() };
    await writeStoreLocked(store);
  });
  return result;
}

// Old session results may contain preimages. Protect them on the next unlock.
vault.onUnlock(async () => {
  await _lock.run(async () => {
    const store = await readStoreLocked();
    for (const [id, record] of Object.entries(store)) {
      if (record.status === 'done' && !isPrivateEnvelope(record.result)) {
        record.result = await sealPrivateValue(`${STORE_KEY}/${id}`, record.result);
      }
    }
    await writeStoreLocked(store);
  });
});

vault.onDestroy(async () => { await _lock.run(() => browser.storage.session.remove(STORE_KEY)); });
