/**
 * Tests for src/shared/rpc.ts — popup ↔ background transport wrapper.
 *
 * Regression coverage for the Safari delete→recreate onboarding crash:
 * Safari expresses "background service worker not ready / no responder" by
 * RESOLVING runtime.sendMessage with `undefined` instead of rejecting the way
 * Chrome does ("Receiving end does not exist"). The background always replies
 * with a `{ result }` or `{ error }` envelope, so a missing envelope is a
 * transport failure: rpc() must retry it like a wakeup error and, if it never
 * gets an envelope, throw a clear RpcError — never hand `undefined` to callers
 * (CreateStep crashed on `result.account`).
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// rpc.ts imports @shared/browser.ts, which prefers globalThis.browser over the
// (undefined in Node) chrome global — install the stub BEFORE importing rpc.
let sendImpl: (payload: { method: string; params: unknown }) => Promise<unknown>;
(globalThis as Record<string, unknown>).browser = {
  runtime: {
    sendMessage: (payload: { method: string; params: unknown }) => sendImpl(payload),
  },
};

const { rpc } = await import('../src/shared/rpc.ts');

describe('rpc: response envelope handling', () => {
  beforeEach(() => {
    sendImpl = () => Promise.resolve({ result: null });
  });

  it('unwraps { result }', async () => {
    sendImpl = async () => ({ result: { account: { id: 'a1' }, mnemonic: 'words' } });
    const res = await rpc<{ account: { id: string } }>('onboarding_generateAccount');
    assert.strictEqual(res.account.id, 'a1');
  });

  it('throws RpcError on { error }', async () => {
    sendImpl = async () => ({ error: 'Vault is locked' });
    await assert.rejects(() => rpc('vault_exportNsec'), (err: Error) => {
      assert.strictEqual(err.name, 'RpcError');
      assert.strictEqual(err.message, 'Vault is locked');
      return true;
    });
  });

  it('passes through { result: undefined } without retry (legit empty result)', async () => {
    let calls = 0;
    sendImpl = async () => { calls++; return { result: undefined }; };
    const res = await rpc('vault_getActiveAccountType');
    assert.strictEqual(res, undefined);
    assert.strictEqual(calls, 1, 'an envelope with empty result must not be retried');
  });
});

describe('rpc: Safari undefined-response (no responder) handling', () => {
  it('retries when sendMessage resolves undefined, then returns the late result', async () => {
    // First attempt: SW not ready → Safari resolves undefined.
    // Second attempt: SW awake → real envelope.
    let calls = 0;
    sendImpl = async () => {
      calls++;
      if (calls === 1) return undefined;
      return { result: { account: { id: 'a2' }, mnemonic: 'words' } };
    };
    const res = await rpc<{ account: { id: string } }>('onboarding_generateAccount');
    assert.strictEqual(res.account.id, 'a2');
    assert.strictEqual(calls, 2);
  });

  it('throws RpcError (never resolves undefined) when no responder ever answers', async () => {
    let calls = 0;
    sendImpl = async () => { calls++; return undefined; };
    await assert.rejects(() => rpc('onboarding_generateAccount'), (err: Error) => {
      assert.strictEqual(err.name, 'RpcError');
      assert.match(err.message, /background/i);
      return true;
    });
    assert.strictEqual(calls, 3, 'should retry up to 3 attempts before giving up');
  });
});

describe('rpc: Chrome wakeup-rejection handling', () => {
  it('retries wakeup errors and succeeds', async () => {
    let calls = 0;
    sendImpl = async () => {
      calls++;
      if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { result: 42 };
    };
    const res = await rpc<number>('vault_getAutoLock');
    assert.strictEqual(res, 42);
    assert.strictEqual(calls, 2);
  });

  it('does not retry application-level rejections', async () => {
    let calls = 0;
    sendImpl = async () => { calls++; throw new Error('some other failure'); };
    await assert.rejects(() => rpc('vault_getAutoLock'), /some other failure/);
    assert.strictEqual(calls, 1);
  });
});
