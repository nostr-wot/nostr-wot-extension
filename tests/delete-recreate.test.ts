/**
 * Regression tests: delete an account (or destroy the vault) → create a NEW
 * account through onboarding again.
 *
 * Reproduces the Safari-reported bug where, after deleting the last account,
 * `onboarding_generateAccount` appeared to return `undefined` to the popup
 * (`undefined is not an object (evaluating 'result.account')` in
 * src/wizard/CreateStep.tsx).
 *
 * Every handler call is wrapped in a timeout so a hang (handler never
 * resolving → background never calls sendResponse → popup receives
 * `undefined`) is reported as a test failure instead of wedging the runner.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browserMock from './helpers/browser-mock.ts';
import * as vault from '../src/lib/vault.ts';
import { handlers as vaultHandlers } from '../src/lib/bg/vault-handlers.ts';
import * as onboarding from '../src/lib/bg/onboarding-handlers.ts';
import type { Account } from '../src/lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const HANDLER_TIMEOUT_MS = 5000;

interface GenerateResult {
  account: Omit<Account, 'privkey'>;
  mnemonic: string;
}

/** Fail loudly if a handler hangs instead of resolving. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${label} did not resolve within ${HANDLER_TIMEOUT_MS}ms (handler hang → popup would see 'undefined')`)),
        HANDLER_TIMEOUT_MS
      );
      if (typeof t === 'object' && 'unref' in t) (t as NodeJS.Timeout).unref();
    }),
  ]);
}

const gen = onboarding.handlers.get('onboarding_generateAccount')!;
const createVault = onboarding.handlers.get('onboarding_createVault')!;
const addToVault = onboarding.handlers.get('onboarding_addToVault')!;
const removeAccount = vaultHandlers.get('vault_removeAccount')!;
const destroyVault = vaultHandlers.get('vault_destroy')!;

/** Run the wizard's create flow: generateAccount + createVault (PasswordStep). */
async function onboardNewAccount(): Promise<GenerateResult> {
  const result = (await withTimeout(gen({}), 'onboarding_generateAccount')) as GenerateResult;
  assert.ok(result, 'onboarding_generateAccount returned nothing');
  assert.ok(result.account, 'onboarding_generateAccount returned no account');
  assert.ok(result.mnemonic, 'onboarding_generateAccount returned no mnemonic');
  await withTimeout(
    createVault({ password: TEST_PASSWORD, account: result.account, upgradeFromReadOnly: null }),
    'onboarding_createVault'
  );
  return result;
}

describe('delete→recreate: remove last account then onboard again', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('vault_removeAccount of the last account, then onboarding_generateAccount succeeds', async () => {
    const first = await onboardNewAccount();
    assert.strictEqual(vault.listAccounts().length, 1);

    // Delete flow used by AccountDropdown.handleRemove
    await withTimeout(removeAccount({ accountId: first.account.id }), 'vault_removeAccount');
    // UI-side cleanup that handleRemove also performs
    await browserMock.storage.sync.remove('myPubkey');
    await browserMock.storage.local.set({ accounts: [], activeAccountId: null });

    assert.strictEqual(vault.listAccounts().length, 0, 'vault should have no accounts left');

    // Re-run onboarding: this is where Safari reported result === undefined
    const second = (await withTimeout(gen({}), 'onboarding_generateAccount (2nd)')) as GenerateResult;
    assert.ok(second, 'second generateAccount returned nothing');
    assert.ok(second.account?.pubkey, 'second generateAccount returned no account');
    assert.strictEqual(second.mnemonic.split(' ').length, 24);
    assert.notStrictEqual(second.account.pubkey, first.account.pubkey, 'new identity expected');

    // And the wizard can complete again (PasswordStep treats vault-with-0-accounts as new vault)
    await withTimeout(
      createVault({ password: TEST_PASSWORD, account: second.account, upgradeFromReadOnly: null }),
      'onboarding_createVault (2nd)'
    );
    const accts = vault.listAccounts();
    assert.strictEqual(accts.length, 1);
    assert.strictEqual(accts[0].pubkey, second.account.pubkey);
  });

  it('vault_destroy, then onboarding_generateAccount succeeds', async () => {
    const first = await onboardNewAccount();
    assert.strictEqual(await vault.exists(), true);

    await withTimeout(destroyVault({}), 'vault_destroy');
    assert.strictEqual(await vault.exists(), false);

    const second = (await withTimeout(gen({}), 'onboarding_generateAccount (after destroy)')) as GenerateResult;
    assert.ok(second?.account?.pubkey, 'generateAccount after destroy returned no account');
    assert.ok(second.mnemonic);
    assert.notStrictEqual(second.account.pubkey, first.account.pubkey);

    await withTimeout(
      createVault({ password: TEST_PASSWORD, account: second.account, upgradeFromReadOnly: null }),
      'onboarding_createVault (after destroy)'
    );
    assert.strictEqual(vault.listAccounts().length, 1);
  });

  it('delete → service-worker restart → onboarding_generateAccount still succeeds', async () => {
    const first = await onboardNewAccount();
    await withTimeout(removeAccount({ accountId: first.account.id }), 'vault_removeAccount');
    await browserMock.storage.sync.remove('myPubkey');
    await browserMock.storage.local.set({ accounts: [], activeAccountId: null });

    // Safari suspends the SW between popup opens; in-memory state is lost
    onboarding.__simulateServiceWorkerRestart();
    vault.lock(); // SW restart also drops the decrypted vault

    const second = (await withTimeout(gen({}), 'onboarding_generateAccount (after SW restart)')) as GenerateResult;
    assert.ok(second?.account?.pubkey);
    assert.ok(second.mnemonic);

    // Vault blob still exists (remove-last-account keeps it) but is locked after
    // restart with a non-empty password: PasswordStep treats 0 accounts as "new
    // vault" and calls createVault, which overwrites — must not hang or throw.
    await withTimeout(
      createVault({ password: TEST_PASSWORD, account: second.account, upgradeFromReadOnly: null }),
      'onboarding_createVault (after SW restart)'
    );
    assert.strictEqual(vault.listAccounts().length, 1);
    assert.strictEqual(vault.listAccounts()[0].pubkey, second.account.pubkey);
  });
});

describe('onboarding_createVault refuses to replace a vault that holds accounts', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('throws rather than overwriting, even while the vault is locked', async () => {
    // Creating replaces the vault outright — the payload is `accounts: [one]`.
    // The wizard is supposed to route to addToVault instead, but PasswordStep's
    // probe swallows every failure into `setVaultExists(false)`, so a cold
    // worker or an active brute-force lockout lands the user on "create a new
    // vault" over a real one. Accepting that destroys every stored key while
    // telling the user we are setting their security up.
    const first = await onboardNewAccount();
    assert.strictEqual(vault.listAccounts().length, 1);

    // The dangerous state: a real vault, locked, so its contents are unreadable.
    vault.lock();
    const second = (await gen({})) as GenerateResult;

    await assert.rejects(
      createVault({ password: TEST_PASSWORD, account: second.account, upgradeFromReadOnly: null }),
      /already exists/,
    );

    // And the original is untouched.
    assert.strictEqual(await vault.exists(), true);
    await vault.unlock(TEST_PASSWORD);
    const accts = vault.listAccounts();
    assert.strictEqual(accts.length, 1);
    assert.strictEqual(accts[0].pubkey, first.account.pubkey, 'the original key must still be there');
  });

  it('still allows onboarding into a vault left empty by removing the last account', async () => {
    // Not merely "exists": removing the last account leaves an empty vault
    // behind, and onboarding through that is supported (the test above this one).
    const first = await onboardNewAccount();
    await removeAccount({ accountId: first.account.id });
    await browserMock.storage.local.set({ accounts: [], activeAccountId: null });

    const second = (await gen({})) as GenerateResult;
    await createVault({ password: TEST_PASSWORD, account: second.account, upgradeFromReadOnly: null });

    assert.strictEqual(vault.listAccounts().length, 1);
  });
});
