/**
 * A payment happens at most once, however many times the popup asks.
 *
 * `rpc()` retries three times when the message port closes without a reply,
 * because an MV3 worker that was asleep and a worker that died mid-handler look
 * identical from the popup. `wallet_payToLightningAddress` asks the endpoint for
 * a fresh invoice on every call, so each retry carries a different payment hash
 * and the node cannot recognise the duplicate — it just pays again.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/payment-intents.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import browserMock, { resetMockStorage } from '../helpers/browser-mock.ts';
import { runPaymentOnce } from '../../src/lib/wallet/payment-intents.ts';

beforeEach(() => {
  resetMockStorage();
});

describe('runPaymentOnce', () => {
  it('sends once and replays the result to a retry', async () => {
    let sends = 0;
    const send = async () => { sends++; return { preimage: 'abc', amountSats: 500 }; };

    const first = await runPaymentOnce('intent-1', send);
    const retry = await runPaymentOnce('intent-1', send);

    assert.equal(sends, 1, 'the second attempt must not pay again');
    assert.deepEqual(retry, first, 'the retry must see the original result');
  });

  it('sends again for a different intent — a second click is a second payment', async () => {
    let sends = 0;
    const send = async () => { sends++; return { preimage: `p${sends}` }; };

    await runPaymentOnce('intent-1', send);
    await runPaymentOnce('intent-2', send);

    assert.equal(sends, 2);
  });

  it('refuses a replay that arrives while the first is still in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let sends = 0;
    const send = async () => { sends++; await gate; return { preimage: 'abc' }; };

    const inFlight = runPaymentOnce('intent-1', send);
    // Let the in-flight record land before the replay reads it.
    await new Promise((r) => setTimeout(r, 0));

    await assert.rejects(
      runPaymentOnce('intent-1', send),
      /PAYMENT_IN_FLIGHT/,
      'a concurrent replay must not start a second payment',
    );

    release();
    await inFlight;
    assert.equal(sends, 1);
  });

  it('lets the user try again after a failure', async () => {
    // rpc() does not auto-retry application errors, so a throw means the user
    // saw it. The intent must not be left blocking a deliberate second attempt.
    let sends = 0;
    const failing = async () => { sends++; throw new Error('endpoint offline'); };

    await assert.rejects(runPaymentOnce('intent-1', failing), /endpoint offline/);
    await assert.rejects(runPaymentOnce('intent-1', failing), /endpoint offline/);

    assert.equal(sends, 2, 'a failed payment is retryable');
  });

  it('runs unguarded when no intent id is supplied', async () => {
    // An older popup that does not stamp intents keeps working, unprotected but
    // not broken.
    let sends = 0;
    const send = async () => { sends++; return { preimage: 'abc' }; };

    await runPaymentOnce(undefined, send);
    await runPaymentOnce(undefined, send);

    assert.equal(sends, 2);
  });

  it('survives a service-worker teardown between the payment and the retry', async () => {
    // The record lives in storage.session precisely so that it outlives the
    // worker. Nothing here holds module state, so a fresh read must still find it.
    let sends = 0;
    const send = async () => { sends++; return { preimage: 'abc' }; };

    await runPaymentOnce('intent-1', send);

    const stored = await browserMock.storage.session.get('walletPaymentIntents');
    assert.equal(stored.walletPaymentIntents['intent-1'].status, 'done',
      'the intent must be readable from storage, not from a module variable');

    await runPaymentOnce('intent-1', send);
    assert.equal(sends, 1);
  });

  it('forgets intents once they are older than the retry window', async () => {
    const stale = Date.now() - 11 * 60 * 1000;
    await browserMock.storage.session.set({
      walletPaymentIntents: { old: { status: 'done', result: { preimage: 'x' }, at: stale } },
    });

    let sends = 0;
    await runPaymentOnce('new', async () => { sends++; return { preimage: 'y' }; });

    const stored = await browserMock.storage.session.get('walletPaymentIntents');
    assert.equal(stored.walletPaymentIntents.old, undefined, 'stale intents must be pruned');
    assert.equal(sends, 1);
  });
});

describe('runPaymentOnce -- concurrent claims', () => {
  it('does not lose an in-flight record to a concurrent claim for a different intent', async () => {
    // Two payments claimed at once both read the store, both write it back whole.
    // Whichever writes second erases the other's in-flight marker — and once the
    // marker is gone a retry finds nothing and sends a second, unrelated invoice,
    // which is precisely what this module exists to stop.
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((r) => { releaseA = r; });

    let sendsA = 0;
    const sendA = async () => {
      sendsA++;
      // Only the first send holds the payment open; a replay that wrongly gets
      // through must return promptly, or it would deadlock against the very
      // gate the test uses to end it.
      if (sendsA === 1) await gateA;
      return { preimage: 'a' };
    };
    const sendB = async () => ({ preimage: 'b' });

    const a = runPaymentOnce('intent-a', sendA);
    const b = runPaymentOnce('intent-b', sendB);
    await b;

    // intent-a is still in flight, so its record must still be there and this
    // replay must be refused rather than allowed to send a second invoice.
    let replayError: Error | null = null;
    try {
      await runPaymentOnce('intent-a', sendA);
    } catch (e) {
      replayError = e as Error;
    }

    releaseA();
    await a.catch(() => {});

    assert.match(
      replayError?.message || '(the replay was allowed to send)',
      /PAYMENT_IN_FLIGHT/,
      "the concurrent claim for intent-b erased intent-a's in-flight record",
    );
    assert.equal(sendsA, 1, 'intent-a must have been sent exactly once');
  });

  it('keeps a completed result across a concurrent claim', async () => {
    const first = await runPaymentOnce('intent-a', async () => ({ preimage: 'a' }));
    await runPaymentOnce('intent-b', async () => ({ preimage: 'b' }));

    let resent = 0;
    const replay = await runPaymentOnce('intent-a', async () => { resent++; return { preimage: 'x' }; });

    assert.equal(resent, 0, 'a completed intent must never re-send');
    assert.deepEqual(replay, first);
  });

  it('does not prune an in-flight record just because it is old', async () => {
    // The prune dropped anything past the TTL regardless of status. An in-flight
    // record is the one thing that must outlive it: deleting it re-arms the
    // double payment it was placed there to prevent.
    await browserMock.storage.session.set({
      walletPaymentIntents: {
        stuck: { status: 'in-flight', at: Date.now() - 11 * 60 * 1000 },
      },
    });

    await runPaymentOnce('other', async () => ({ preimage: 'x' }));

    const stored = await browserMock.storage.session.get('walletPaymentIntents');
    assert.ok(
      stored.walletPaymentIntents.stuck,
      'an in-flight record must survive the done-record TTL',
    );
  });
});
