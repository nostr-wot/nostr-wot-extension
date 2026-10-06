import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import * as vault from '../src/services/vault/vault.ts';
import { archiveTransportOptions } from '../src/services/archive/authentication.ts';

import { importNsec, importNpub } from '../src/domain/accounts/creation.ts';
import { handleNip46Request } from '../src/services/signing/remoteSigner.ts';
import { verifyEvent } from '../src/lib/crypto/nip01.ts';
import browserMock, { resetMockStorage } from './helpers/browser-mock.ts';
import type { Account } from '../src/domain/accounts/types.ts';

const privateKey = '07'.repeat(32);
async function setup(account?: Account) {
  const local = account ?? await importNsec(privateKey, 'Archive');
  await vault.create('archive-test-password', { accounts: [local], activeAccountId: local.id });
  return local;
}

describe('Archive native relay authentication', () => {
  beforeEach(async () => { await vault.destroy(); resetMockStorage(); });
  afterEach(async () => { await vault.destroy(); });

  it('is automatic, account/session scoped and signs exactly the relay challenge', async () => {
    const account = await setup();
    const off = await archiveTransportOptions(account.id);
    assert.equal(typeof off.authenticate, 'function'); assert.ok(off.scope?.startsWith(`archive:${account.id}:`));
    const options = await archiveTransportOptions(account.id);
    const event = await options.authenticate!('test challenge', 'wss://relay.test/path');
    assert.equal(event.kind, 22242); assert.equal(event.content, ''); assert.equal(event.pubkey, account.pubkey);
    assert.deepEqual(event.tags, [['relay', 'wss://relay.test/path'], ['challenge', 'test challenge']]);
    assert.ok(Math.abs(event.created_at - Date.now() / 1000) < 5); assert.equal(await verifyEvent(event), true);
    await assert.rejects(options.authenticate!('challenge', 'https://relay.test'), /relay URL/);
    await assert.rejects(options.authenticate!('', 'wss://relay.test'), /challenge/);
  });

  it('refuses locked, cancelled and stale sessions including away-and-back account switches', async () => {
    const account = await setup();
    const abort = new AbortController();
    const options = await archiveTransportOptions(account.id, abort.signal);
    abort.abort(); await assert.rejects(options.authenticate!('challenge', 'wss://relay.test'), /cancelled/);
    const stale = await archiveTransportOptions(account.id);
    const second = await importNsec('08'.repeat(32), 'Second'); await vault.addAccount(second);
    await vault.setActiveAccount(second.id); await vault.setActiveAccount(account.id);
    await assert.rejects(stale.authenticate!('challenge', 'wss://relay.test'), /session changed/);
    const fresh = await archiveTransportOptions(account.id);
    assert.notEqual(fresh.scope, stale.scope, 'a new vault session never inherits an authenticated socket');
    vault.lock(); await assert.rejects(fresh.authenticate!('challenge', 'wss://relay.test'), /locked/);
    await assert.rejects(archiveTransportOptions(account.id), /locked/);
  });

  it('does not create a remote signer connection or authenticate a read-only account', async () => {
    const local = await importNsec(privateKey);
    const watch = importNpub(local.pubkey, 'Watch'); await setup(watch);
    const readOnly = await archiveTransportOptions(watch.id);
    await assert.rejects(readOnly.authenticate!('challenge', 'wss://relay.test'), /Read-only/);
    await vault.destroy();
    const remote: Account = { ...local, type: 'nip46', privkey: null, nip46Config: { bunkerUrl: `bunker://${local.pubkey}?relay=wss://signer.test`, relay: 'wss://signer.test', secret: null } };
    await setup(remote);
    const options = await archiveTransportOptions(remote.id);
    await assert.rejects(options.authenticate!('challenge', 'wss://relay.test'), /Connect.*remote signer/);
    await assert.rejects(handleNip46Request(vault.getActiveAccount()!, 'signEvent', { pubkey: local.pubkey, kind: 22242, created_at: 10, content: '', tags: [['relay', 'wss://relay.test'], ['challenge', 'challenge']] }, 'extension:archive', { connectedOnly: true }), /not connected/);
  });

  it('passive authentication does not postpone the vault auto-lock deadline', async () => {
    const account = await setup();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      vault.setAutoLockTimeout(1000);
      mock.timers.tick(600);
      const options = await archiveTransportOptions(account.id);
      await options.authenticate!('challenge', 'wss://relay.test');
      mock.timers.tick(401);
      assert.equal(vault.isLocked(), true, 'automatic auth leaves the original idle deadline intact');
    } finally { mock.timers.reset(); vault.setAutoLockTimeout(900000); }
  });


  it('supports a public watch-only account outside the vault without authorizing its signature', async () => {
    const local = await setup();
    const watch = importNpub(local.pubkey, 'Public watch-only');
    await browserMock.storage.local.set({ accounts: [watch], activeAccountId: watch.id });
    assert.equal(vault.getAccountById(watch.id), null);
    const options = await archiveTransportOptions(watch.id);
    options.assertSession!(); assert.equal(typeof options.authenticate, 'function');
    const auth = await archiveTransportOptions(watch.id);
    await assert.rejects(auth.authenticate!('challenge', 'wss://relay.test'), /Read-only/);
    await browserMock.storage.local.set({ accounts: [{ ...watch, readOnly: false }] });
    await assert.rejects(archiveTransportOptions(watch.id), /unavailable/);
    vault.lock(); assert.throws(options.assertSession!, /locked/);
  });

});
