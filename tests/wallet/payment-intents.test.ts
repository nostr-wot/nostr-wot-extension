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
import { runPaymentOnce } from '../../lib/wallet/payment-intents.ts';

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
      /already being sent/,
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
