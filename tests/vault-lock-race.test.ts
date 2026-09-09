/**
 * The popup must not be told "locked" while the unlock that will succeed is
 * still running.
 *
 * In "Never lock" mode the background re-unlocks the vault on every
 * service-worker cold start, and that unlock is asynchronous — a storage read
 * plus PBKDF2. Chrome tears the worker down after ~30s idle, so a popup opened
 * at any ordinary moment lands inside that window. `vault_isLocked` answered
 * `isLocked()` directly and won the race, and because a successful unlock wrote
 * nothing the popup watches, the answer never corrected: the wallet card, the
 * Wallet menu row and every locked-gated action stayed hidden for the whole life
 * of that popup, then came back on the next open for no visible reason.
 *
 * services/signing/signer.ts already awaited this gate. The RPC the popup trusts did not.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault-lock-race.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { handlers as vaultHandlers } from '../src/services/background/vault-handlers.ts';
import type { VaultPayload } from '../src/domain/vault/types.ts';

const PASSWORD = 'testpassword123';

function payload(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1', name: 'Test', type: 'nsec',
      pubkey: 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659',
      privkey: 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef',
      mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1000000,
    }],
    activeAccountId: 'acct1',
  } as VaultPayload;
}

const isLocked = vaultHandlers.get('vault_isLocked')!;

describe('vault_isLocked -- the cold-start window', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
  });

  it('waits for an in-flight startup unlock instead of answering "locked"', async () => {
    await vault.create(PASSWORD, payload());
    vault.lock();
    assert.strictEqual(vault.isLocked(), true);

    // Exactly what background.ts does on cold start, with a delay standing in
    // for the storage read and PBKDF2.
    vault.beginStartupUnlock(async () => {
      await new Promise((r) => setTimeout(r, 40));
      await vault.unlock(PASSWORD);
    });

    // The popup asks immediately, as it does when it opens the worker.
    const answer = await isLocked({});

    assert.strictEqual(
      answer,
      false,
      'answering "locked" here hides the wallet for the whole life of the popup',
    );
    assert.strictEqual(vault.isLocked(), false);
  });

  it('still reports locked when no startup unlock is running', async () => {
    await vault.create(PASSWORD, payload());
    vault.lock();

    assert.strictEqual(await isLocked({}), true);
  });

  it('reports unlocked normally', async () => {
    await vault.create(PASSWORD, payload());
    assert.strictEqual(await isLocked({}), false);
  });

  it('reports locked when the startup unlock fails', async () => {
    // A wrong stored password, or no vault: the gate must not turn a failed
    // auto-unlock into a claim that the vault is open.
    await vault.create(PASSWORD, payload());
    vault.lock();

    vault.beginStartupUnlock(async () => {
      await new Promise((r) => setTimeout(r, 10));
      await vault.unlock('the-wrong-password');
    });

    assert.strictEqual(await isLocked({}), true);
  });
});

import { loadVaultState } from '../src/context/VaultContext';
it('a retired status read cannot overwrite a newer unlocked result, including on failure', async () => {
  for (const fail of [false,true]) {
    const patches:unknown[]=[];
    let current=true, finish!:()=>void;
    const gate=new Promise<void>(resolve=>{finish=resolve;});
    const old=loadVaultState(value=>patches.push(value),()=>current,async(method:string)=>{
      await gate;
      if(fail) throw new Error('old worker response');
      return (method==='vault_isLocked'?true:method==='vault_getActiveAccountType'?{type:'nsec'}:true) as never;
    });
    current=false;
    await loadVaultState(value=>patches.push(value),()=>true,async(method:string)=>
      (method==='vault_isLocked'?false:method==='vault_getActiveAccountType'?{type:'nsec'}:true) as never);
    finish();await old;
    assert.equal(patches.length,1);
    assert.equal((patches[0] as {locked:boolean}).locked,false);
  }
});
it('a current failed vault read remains fail-closed',async()=>{
  const patches:unknown[]=[];
  await loadVaultState(value=>patches.push(value),()=>true,async()=>{throw new Error('offline');});
  assert.deepEqual(patches,[{locked:true}]);
});
