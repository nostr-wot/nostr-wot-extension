/**
 * At-most-once execution for payments that cannot be safely repeated.
 *
 * `rpc()` retries up to three times when the message port closes without a
 * reply (see src/shared/rpc.ts) — necessary, because an MV3 service worker is
 * torn down after ~30s idle and the first message after wake-up can reject
 * before the listener is re-registered. From the popup, "the worker was asleep"
 * and "the worker did the work and then died before replying" are the same
 * event, so the retry is blind.
 *
 * For most handlers that is harmless. It is not harmless for
 * `wallet_payToLightningAddress`, which resolves the address and asks the
 * endpoint for a *fresh invoice* on every call: two invoices have two payment
 * hashes, so the Lightning node has no way to recognise the second as a
 * duplicate and pays it. (`wallet_payInvoice` does not need this — the same
 * bolt11 carries the same payment hash, and the node itself refuses to pay it
 * twice.)
 *
 * So the deduplication has to live here: the popup stamps one intent id per
 * click, and a replay of that id returns the first result instead of sending
 * money again.
 *
 * Records live in `storage.session`, not in a module variable, because the
 * point is to survive exactly the service-worker teardown that causes the
 * retry. They hold an intent id and a payment result — no key material.
 *
 * @module lib/wallet/payment-intents
 */

import browser from '../browser.ts';

const STORE_KEY = 'walletPaymentIntents';

/** How long a completed intent stays replayable. Retries happen in milliseconds; this is slack. */
const TTL_MS = 10 * 60 * 1000;

interface IntentRecord {
  status: 'in-flight' | 'done';
  result?: unknown;
  at: number;
}

type IntentStore = Record<string, IntentRecord>;

async function readStore(): Promise<IntentStore> {
  const data = await browser.storage.session.get(STORE_KEY) as Record<string, unknown>;
  const store = (data?.[STORE_KEY] as IntentStore | undefined) || {};
  // Prune on read — there is no other moment we are guaranteed to run.
  const cutoff = Date.now() - TTL_MS;
  let pruned = false;
  for (const [id, rec] of Object.entries(store)) {
    if (!rec || typeof rec.at !== 'number' || rec.at < cutoff) {
      delete store[id];
      pruned = true;
    }
  }
  if (pruned) await writeStore(store);
  return store;
}

async function writeStore(store: IntentStore): Promise<void> {
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
 * A `send` that *throws* clears the record, because the caller sees the error
 * and decides what to do next — `rpc()` does not retry application errors, only
 * transport failures. The residual risk is unchanged from any Lightning wallet:
 * a payment that failed after the sats left cannot be distinguished from one
 * that never left.
 */
export async function runPaymentOnce<T>(
  intentId: string | undefined,
  send: () => Promise<T>,
): Promise<T> {
  if (!intentId) return send();

  const store = await readStore();
  const existing = store[intentId];
  if (existing?.status === 'done') return existing.result as T;
  if (existing?.status === 'in-flight') {
    throw new Error('That payment is already being sent');
  }

  store[intentId] = { status: 'in-flight', at: Date.now() };
  await writeStore(store);

  let result: T;
  try {
    result = await send();
  } catch (err) {
    const after = await readStore();
    delete after[intentId];
    await writeStore(after);
    throw err;
  }

  const after = await readStore();
  after[intentId] = { status: 'done', result, at: Date.now() };
  await writeStore(after);
  return result;
}
