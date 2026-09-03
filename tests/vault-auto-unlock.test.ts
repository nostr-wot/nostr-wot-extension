/**
 * Never-lock auto-unlock, and the probe that was charging the user for it.
 *
 * The background counts failed unlocks in a persisted guard, so offering the
 * empty password to a vault that is not in never-lock mode is not a free
 * probe — it is a guaranteed failure on the user's record. One of the four
 * screens doing this omitted the mode check, and an abandoned wizard re-ran it
 * on every popup open: five opens, and the user is locked out having typed
 * nothing.
 *
 * Run with:
 *   node --import tsx --test tests/vault-auto-unlock.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isVaultOpen } from '../src/shared/vaultAutoUnlock.ts';

/** Records every RPC so the tests can assert what was NOT asked. */
function fakeRpc(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const call = (async (method: string) => {
    calls.push(method);
    return answers[method];
  }) as <T>(m: string, p?: unknown) => Promise<T>;
  return { call, calls };
}

describe('isVaultOpen', () => {
  it('is open when the vault is not locked, and asks nothing further', async () => {
    const { call, calls } = fakeRpc({ vault_isLocked: false });
    assert.equal(await isVaultOpen(call), true);
    assert.deepEqual(calls, ['vault_isLocked']);
  });

  it('auto-unlocks a never-lock vault', async () => {
    const { call, calls } = fakeRpc({
      vault_isLocked: true, vault_getAutoLock: 0, vault_unlock: true,
    });
    assert.equal(await isVaultOpen(call), true);
    assert.deepEqual(calls, ['vault_isLocked', 'vault_getAutoLock', 'vault_unlock']);
  });

  it('NEVER offers the empty password to a timed-lock vault', async () => {
    // The regression. Each such attempt is charged against the persisted
    // brute-force guard, so a screen that probes blindly locks the user out of
    // their own vault without them touching the keyboard.
    const { call, calls } = fakeRpc({ vault_isLocked: true, vault_getAutoLock: 900_000 });
    assert.equal(await isVaultOpen(call), false);
    assert.ok(!calls.includes('vault_unlock'), 'must not attempt an unlock it knows will fail');
  });

  it('reports locked when the never-lock unlock itself fails', async () => {
    const { call } = fakeRpc({
      vault_isLocked: true, vault_getAutoLock: 0, vault_unlock: false,
    });
    assert.equal(await isVaultOpen(call), false);
  });
});
