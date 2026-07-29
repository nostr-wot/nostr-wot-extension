import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browserMock from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.ts';
import * as permissions from '../lib/permissions.ts';
import * as signer from '../lib/signer.ts';
import * as onboarding from '../lib/bg/onboarding-handlers.ts';
import { addAllowedDomain, removeAllowedDomain } from '../lib/bg/domain-handlers.ts';
import type { VaultPayload } from '../lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
// A second pubkey to act as "their" pubkey for encrypt/decrypt
const THEIR_PUBKEY_HEX = 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';

function makePayload(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1',
      name: 'Test',
      type: 'nsec',
      pubkey: TEST_PUBKEY_HEX,
      privkey: TEST_PRIVKEY_HEX,
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 1000000
    }],
    activeAccountId: 'acct1'
  };
}

async function setupVault(): Promise<void> {
  await vault.create(TEST_PASSWORD, makePayload());
  // Vault is now unlocked
}

// -- Pending Queue Tests --

describe('signer -- pending request queue', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('queueRequest stores entry in session storage', async () => {
    // Set permission to 'ask' (default, no permission saved)
    // Simulate what handleSignEvent does when permission is 'ask'
    await setupVault();

    // Start a signEvent that will queue (permission is 'ask')
    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    // Give the queue time to write to storage
    await new Promise<void>(r => setTimeout(r, 50));

    // Check that pending request exists in storage
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'Should have 1 pending request');
    assert.strictEqual(pending[0].type, 'signEvent');
    assert.strictEqual(pending[0].origin, 'test.com');
    assert.strictEqual(pending[0].needsPermission, true);

    // Resolve it (deny to clean up)
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });

    // signPromise should reject with 'User denied'
    await assert.rejects(signPromise, /User denied/);
  });

  it('resolveRequest removes entry from storage', async () => {
    await setupVault();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);

    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
    await assert.rejects(signPromise, /User denied/);

    // Give storage time to update
    await new Promise<void>(r => setTimeout(r, 50));

    const afterResolve: any[] = await signer.getPending();
    assert.strictEqual(afterResolve.length, 0, 'Should have 0 pending after resolve');
  });

  it('concurrent queueRequest calls do not lose entries (mutex test)', async () => {
    await setupVault();

    // Fire 5 concurrent signEvent requests (the per-origin pending cap)
    const N = 5;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        signer.handleSignEvent(
          { kind: 1, content: `msg ${i}`, tags: [], created_at: Math.floor(Date.now() / 1000) },
          'test.com'
        )
      );
    }

    // Wait for all to be queued (mutex serializes writes)
    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, N, `Should have ${N} pending requests, got ${pending.length}`);

    // Clean up: deny all
    for (const req of pending) {
      signer.resolveRequest(req.id, { allow: false, remember: false });
    }

    // All promises should reject
    for (const p of promises) {
      await assert.rejects(p, /User denied/);
    }
  });

  it('resolveBatch resolves all matching requests at once', async () => {
    await setupVault();

    // Fire 5 concurrent decrypt requests from same origin
    const N = 5;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        signer.handleNip44Decrypt(THEIR_PUBKEY_HEX, 'fakeciphertext', 'coracle.social')
      );
    }

    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, N);

    // Batch deny all readMessages from coracle.social (covers nip04+nip44 decrypt)
    await signer.resolveBatch('coracle.social', 'readMessages', { allow: false, remember: false });

    for (const p of promises) {
      await assert.rejects(p, /User denied/);
    }

    await new Promise<void>(r => setTimeout(r, 50));
    const afterBatch: any[] = await signer.getPending();
    assert.strictEqual(afterBatch.length, 0, 'Batch resolve should clear all matching');
  });

  it('sending a NIP-04 DM produces a single sendMessages permKey for encrypt + signEvent kind 4', async () => {
    // Regression: previously `signEvent:4` and `sendMessages` were distinct permKeys,
    // so a single DM yielded two approval prompts. The DM-kind collapse should bring
    // both wire calls under one approval card.
    await setupVault();

    const p1: Promise<any> = signer.handleNip04Encrypt(THEIR_PUBKEY_HEX, 'hello DM', 'chat.com');
    const p2: Promise<any> = signer.handleSignEvent(
      { kind: 4, content: 'ciphertext', tags: [['p', THEIR_PUBKEY_HEX]], created_at: Math.floor(Date.now() / 1000) },
      'chat.com'
    );

    await new Promise<void>(r => setTimeout(r, 200));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 2, 'Both calls should be queued');
    const permKeys = new Set(pending.map((r: any) => r.permKey));
    assert.deepStrictEqual([...permKeys], ['sendMessages'], 'Encrypt and signEvent:4 should share sendMessages');

    // A single batch resolve must clear both
    await signer.resolveBatch('chat.com', 'sendMessages', { allow: false, remember: false });

    await assert.rejects(p1, /User denied/);
    await assert.rejects(p2, /User denied/);

    await new Promise<void>(r => setTimeout(r, 50));
    const after: any[] = await signer.getPending();
    assert.strictEqual(after.length, 0, 'Single approval should clear the entire DM flow');
  });

  it('NIP-17 seal (signEvent kind 13) shares the sendMessages permKey', async () => {
    await setupVault();

    const p: Promise<any> = signer.handleSignEvent(
      { kind: 13, content: 'sealed', tags: [['p', THEIR_PUBKEY_HEX]], created_at: Math.floor(Date.now() / 1000) },
      'chat.com'
    );

    await new Promise<void>(r => setTimeout(r, 100));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].permKey, 'sendMessages', 'kind 13 should land under sendMessages');

    await signer.resolveBatch('chat.com', 'sendMessages', { allow: false, remember: false });
    await assert.rejects(p, /User denied/);
  });

  it('resolveBatch clears requests across wire methods sharing a permKey (nip04+nip44)', async () => {
    // Regression: "Always allow" for DMs left the nip44 variant orphaned in pending
    // because resolveBatch filtered by wire method (nip04Encrypt) instead of permKey.
    await setupVault();

    const p1: Promise<any> = signer.handleNip04Encrypt(THEIR_PUBKEY_HEX, 'hi via nip04', 'chat.com');
    const p2: Promise<any> = signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hi via nip44', 'chat.com');

    await new Promise<void>(r => setTimeout(r, 200));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 2, 'Both encrypt variants should be queued');
    const permKeys = new Set(pending.map((r: any) => r.permKey));
    assert.deepStrictEqual([...permKeys], ['sendMessages'], 'Both should share the sendMessages permKey');

    // Deny by permKey -- must clear both wire methods
    await signer.resolveBatch('chat.com', 'sendMessages', { allow: false, remember: false });

    await assert.rejects(p1, /User denied/);
    await assert.rejects(p2, /User denied/);

    await new Promise<void>(r => setTimeout(r, 50));
    const after: any[] = await signer.getPending();
    assert.strictEqual(after.length, 0, 'No orphaned nip44 request should remain');
  });

  it('cleanupStale clears all pending requests', async () => {
    await setupVault();

    signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    await signer.cleanupStale();
    assert.strictEqual((await signer.getPending()).length, 0);
  });
});

// -- Approval Flow Tests --

describe('signer -- signEvent approval flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('auto-allows when permission is "allow" and vault unlocked', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signed: any = await signer.handleSignEvent(event, 'test.com');

    assert.ok(signed, 'Should return signed event');
    assert.ok(signed.id, 'Signed event should have id');
    assert.ok(signed.sig, 'Signed event should have sig');
    assert.strictEqual(signed.pubkey, TEST_PUBKEY_HEX);
  });

  it('denies when permission is "deny"', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'deny');

    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /Permission denied/
    );
  });

  it('queues for approval when permission is "ask", signs on approve', async () => {
    await setupVault();
    // No permission saved -- defaults to 'ask'

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);

    // Approve
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should have signature after approval');
    assert.strictEqual(signed.pubkey, TEST_PUBKEY_HEX);
  });

  it('queues for approval when "ask", then denies on deny', async () => {
    await setupVault();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });

    await assert.rejects(signPromise, /User denied/);
  });

  it('saves permission and batch-resolves on "remember" approve', async () => {
    await setupVault();

    // Queue 3 signEvent requests
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 3; i++) {
      promises.push(signer.handleSignEvent(
        { kind: 1, content: `msg ${i}`, tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ));
    }

    await new Promise<void>(r => setTimeout(r, 300));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 3);

    // Approve the first one with "remember"
    signer.resolveRequest(pending[0].id, { allow: true, remember: true, rememberKind: false });

    // All 3 should resolve (first one resolves, saves permission, batch-resolves rest)
    const results: any[] = await Promise.all(promises);
    for (const r of results) {
      assert.ok(r.sig, 'All should be signed');
    }

    // Permission should now be saved
    const perm: string = await permissions.check('test.com', 'signEvent');
    assert.strictEqual(perm, 'allow');
  });

  it('waits for vault unlock when permission is "allow" but vault locked', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');
    vault.lock(); // Lock the vault

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].waitingForUnlock, true);

    // Unlock vault
    await vault.unlock(TEST_PASSWORD);
    // Notify signer that vault is unlocked
    await signer.onVaultUnlocked();

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should sign after vault unlock');
  });

  it('queues for permission AND vault unlock sequentially when both needed', async () => {
    await setupVault();
    vault.lock(); // Lock the vault, no permission saved (ask)

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    // Should be queued for permission
    let pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].needsPermission, true);

    // Approve permission (vault still locked)
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    // Handler should now hit the vault.isLocked() check and queue for unlock
    await new Promise<void>(r => setTimeout(r, 50));

    pending = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'Should have new pending for vault unlock');
    assert.strictEqual(pending[0].waitingForUnlock, true);

    // Unlock vault
    await vault.unlock(TEST_PASSWORD);
    await signer.onVaultUnlocked();

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should sign after both permission + unlock');
  });
});

// -- NIP-44 Decrypt Approval Tests --

describe('signer -- nip44Decrypt approval flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('auto-decrypts when permission is "allow" and vault unlocked', async () => {
    await setupVault();
    await permissions.save('test.com', 'nip44Decrypt', null, 'allow');

    // First encrypt something so we have valid ciphertext
    const { nip44Encrypt } = await import('../lib/crypto/nip44.ts');
    const { hexToBytes } = await import('../lib/crypto/utils.ts');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.ts');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPubkeyBytes: Uint8Array = getPublicKey(hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01')));
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    // Use a known keypair for encrypt/decrypt test
    const plaintext = 'hello secret';
    const ciphertext: string = await nip44Encrypt(plaintext, privkey, theirPubkeyBytes);

    const decrypted: string = await signer.handleNip44Decrypt(theirPubkeyHex, ciphertext, 'test.com');
    assert.strictEqual(decrypted, plaintext);
  });

  it('queues and resolves multiple concurrent decrypt requests', async () => {
    await setupVault();

    // Encrypt test messages
    const { nip44Encrypt } = await import('../lib/crypto/nip44.ts');
    const { hexToBytes } = await import('../lib/crypto/utils.ts');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.ts');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPrivkey: Uint8Array = hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01'));
    const theirPubkeyBytes: Uint8Array = getPublicKey(theirPrivkey);
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    const messages: string[] = ['msg0', 'msg1', 'msg2', 'msg3', 'msg4'];
    const ciphertexts: string[] = [];
    for (const msg of messages) {
      ciphertexts.push(await nip44Encrypt(msg, privkey, theirPubkeyBytes));
    }

    // Fire 5 concurrent decrypt requests (no permission saved -> 'ask')
    const promises: Promise<any>[] = ciphertexts.map((ct: string) =>
      signer.handleNip44Decrypt(theirPubkeyHex, ct, 'chat.com')
    );

    // Wait for all to be queued through mutex
    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 5, `Expected 5 pending, got ${pending.length}`);

    // Batch approve all
    await signer.resolveBatch('chat.com', 'readMessages', { allow: true, remember: false });

    // All should decrypt successfully
    const results: any[] = await Promise.all(promises);
    for (let i = 0; i < messages.length; i++) {
      assert.strictEqual(results[i], messages[i], `Message ${i} should decrypt correctly`);
    }
  });

  it('batch approve with "remember" saves permission and decrypts all', async () => {
    await setupVault();

    const { nip44Encrypt } = await import('../lib/crypto/nip44.ts');
    const { hexToBytes } = await import('../lib/crypto/utils.ts');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.ts');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPrivkey: Uint8Array = hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01'));
    const theirPubkeyBytes: Uint8Array = getPublicKey(theirPrivkey);
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    const messages: string[] = ['secret1', 'secret2', 'secret3'];
    const ciphertexts: string[] = [];
    for (const msg of messages) {
      ciphertexts.push(await nip44Encrypt(msg, privkey, theirPubkeyBytes));
    }

    const promises: Promise<any>[] = ciphertexts.map((ct: string) =>
      signer.handleNip44Decrypt(theirPubkeyHex, ct, 'chat.com')
    );

    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 3);

    // Save permission first (simulating what popup does)
    await permissions.save('chat.com', 'nip44Decrypt', null, 'allow');

    // Batch resolve with remember=true
    await signer.resolveBatch('chat.com', 'readMessages', { allow: true, remember: true });

    const results: any[] = await Promise.all(promises);
    for (let i = 0; i < messages.length; i++) {
      assert.strictEqual(results[i], messages[i]);
    }

    // Permission should be saved
    const perm: string = await permissions.check('chat.com', 'nip44Decrypt');
    assert.strictEqual(perm, 'allow');
  });
});

// -- NIP-46 Cancel Tests --

describe('signer -- cancelNip46InFlight', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('cancelNip46InFlight removes nip46 entry from storage', async () => {
    // Manually insert a NIP-46 in-flight entry into session storage
    const fakeId = 'nip46_test_123';
    const entry = {
      id: fakeId,
      type: 'signEvent',
      origin: 'test.com',
      nip46InFlight: true,
      timestamp: Date.now(),
    };
    await browserMock.storage.session.set({ signerPending: [entry] });

    // Verify it's there
    const before = await signer.getPending();
    assert.strictEqual(before.length, 1);
    assert.strictEqual(before[0].id, fakeId);

    // Cancel it
    await signer.cancelNip46InFlight(fakeId);

    // Verify it's gone
    const after = await signer.getPending();
    assert.strictEqual(after.length, 0, 'Entry should be removed after cancel');
  });

  it('cancelNip46InFlight is safe to call with unknown id', async () => {
    // Should not throw even if the ID doesn't exist
    await signer.cancelNip46InFlight('nonexistent_id');
    const pending = await signer.getPending();
    assert.strictEqual(pending.length, 0);
  });
});

// -- Cancel Unlock Waiter Tests --

describe('signer -- cancelAllUnlockWaiters', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('cancelAllUnlockWaiters rejects all waiters and clears storage', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');
    vault.lock();

    // Start two sign requests that will waitForVaultUnlock
    const p1 = signer.handleSignEvent(
      { kind: 1, content: 'msg1', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );
    const p2 = signer.handleSignEvent(
      { kind: 1, content: 'msg2', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 100));

    // Verify unlock markers are in storage
    const pending = await signer.getPending();
    const unlockWaiters = pending.filter(r => r.waitingForUnlock);
    assert.ok(unlockWaiters.length >= 2, `Should have >=2 unlock waiters, got ${unlockWaiters.length}`);

    // Cancel all
    await signer.cancelAllUnlockWaiters();

    // Both promises should reject with 'Cancelled by user'
    await assert.rejects(p1, /Cancelled by user/);
    await assert.rejects(p2, /Cancelled by user/);

    // Storage should have no unlock waiters left
    const afterCancel = await signer.getPending();
    const remainingUnlock = afterCancel.filter(r => r.waitingForUnlock);
    assert.strictEqual(remainingUnlock.length, 0, 'No unlock waiters should remain');
  });

  it('cancelUnlockWaiter rejects specific waiter, leaves others', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');
    vault.lock();

    // Start two sign requests
    const p1 = signer.handleSignEvent(
      { kind: 1, content: 'msg1', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );
    const p2 = signer.handleSignEvent(
      { kind: 1, content: 'msg2', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 100));

    const pending = await signer.getPending();
    const unlockWaiters = pending.filter(r => r.waitingForUnlock);
    assert.ok(unlockWaiters.length >= 2, `Should have >=2 unlock waiters, got ${unlockWaiters.length}`);

    // Cancel only the first one
    await signer.cancelUnlockWaiter(unlockWaiters[0].id);

    // First should reject
    await assert.rejects(p1, /Cancelled by user/);

    // Second should still be pending — unlock vault to resolve it
    await vault.unlock(TEST_PASSWORD);
    await signer.onVaultUnlocked();

    const signed = await p2;
    assert.ok(signed.sig, 'Second request should sign after unlock');
  });

  it('onVaultUnlocked still resolves remaining waiters after individual cancel', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');
    vault.lock();

    const p1 = signer.handleSignEvent(
      { kind: 1, content: 'msg1', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 100));

    // Unlock vault and fire onVaultUnlocked
    await vault.unlock(TEST_PASSWORD);
    await signer.onVaultUnlocked();

    const signed = await p1;
    assert.ok(signed.sig, 'Request should sign after vault unlock');
  });
});

// -- Edge Cases --

describe('signer -- edge cases', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('rejects account with no private key', async () => {
    const payload: VaultPayload = {
      accounts: [{
        id: 'acct1', name: 'ReadOnly', type: 'npub',
        pubkey: TEST_PUBKEY_HEX, privkey: null,
        mnemonic: null, nip46Config: null,
        readOnly: true, createdAt: 1000000
      }],
      activeAccountId: 'acct1'
    };
    await vault.create(TEST_PASSWORD, payload);
    await permissions.save('test.com', 'signEvent', null, 'allow');

    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /No private key for active account/
    );
  });

  it('rejects when no vault exists at all', async () => {
    // No vault created -- vault.exists() returns false
    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /No signing key available/
    );
  });

  it('rejects when vault stays locked after approval', async () => {
    // This tests the guard: if vault.isLocked() throw after permission+unlock flow
    await setupVault();
    vault.lock();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    // Approve permission, but vault is still locked
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    // waitForVaultUnlock is now active -- fire onVaultUnlocked WITHOUT actually unlocking.
    // This simulates the edge case where the callback fires but vault state isn't updated.
    await new Promise<void>(r => setTimeout(r, 50));
    await signer.onVaultUnlocked();

    // Vault is still locked, so should throw
    await assert.rejects(signPromise, /Vault is locked/);
  });

  it('different origins do not interfere in batch resolve', async () => {
    await setupVault();

    const p1: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'from a', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'site-a.com'
    );
    const p2: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'from b', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'site-b.com'
    );

    await new Promise<void>(r => setTimeout(r, 200));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 2);

    // Batch resolve only site-a.com
    await signer.resolveBatch('site-a.com', 'signEvent:1', { allow: true, remember: false });

    // site-a should resolve
    const signedA: any = await p1;
    assert.ok(signedA.sig);

    // site-b should still be pending
    const remaining: any[] = await signer.getPending();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].origin, 'site-b.com');

    // Clean up
    signer.resolveRequest(remaining[0].id, { allow: false, remember: false });
    await assert.rejects(p2, /User denied/);
  });
});

// -- getPublicKey per-origin auto-approve cooldown --

describe('signer -- getPublicKey cooldown', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('approving getPublicKey auto-allows the next call from the same origin', async () => {
    await setupVault();

    // First call queues for approval
    const first: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'First call must prompt');
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    const pubkey1: any = await first;
    assert.strictEqual(pubkey1, TEST_PUBKEY_HEX);

    // Second call within the cooldown window: no prompt, returns immediately
    const pubkey2: any = await signer.handleGetPublicKey('chat.com');
    assert.strictEqual(pubkey2, TEST_PUBKEY_HEX);

    await new Promise<void>(r => setTimeout(r, 50));
    const after: any[] = await signer.getPending();
    assert.strictEqual(after.length, 0, 'Cooldown call must not enqueue a prompt');
  });

  it('cooldown does NOT cross origins', async () => {
    await setupVault();

    const first: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const p1: any[] = await signer.getPending();
    signer.resolveRequest(p1[0].id, { allow: true, remember: false });
    await first;

    // Different origin must still prompt
    const second: Promise<any> = signer.handleGetPublicKey('other.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const p2: any[] = await signer.getPending();
    assert.strictEqual(p2.length, 1, 'Different origin must produce its own prompt');
    assert.strictEqual(p2[0].origin, 'other.com');

    signer.resolveRequest(p2[0].id, { allow: false, remember: false });
    await assert.rejects(second, /User denied/);
  });

  it('denying getPublicKey does NOT create a cooldown', async () => {
    await setupVault();

    const first: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const p1: any[] = await signer.getPending();
    signer.resolveRequest(p1[0].id, { allow: false, remember: false });
    await assert.rejects(first, /User denied/);

    // Next call must still prompt — deny does not silently auto-allow
    signer.handleGetPublicKey('chat.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    const p2: any[] = await signer.getPending();
    assert.strictEqual(p2.length, 1, 'Deny must not seed a cooldown');

    // Clean up
    signer.resolveRequest(p2[0].id, { allow: false, remember: false });
  });

  it('account switch (rejectPendingForAccount) clears the cooldown', async () => {
    await setupVault();

    const first: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const p1: any[] = await signer.getPending();
    signer.resolveRequest(p1[0].id, { allow: true, remember: false });
    await first;

    // Simulate account switch — must invalidate the cooldown
    await signer.rejectPendingForAccount('acct1');

    signer.handleGetPublicKey('chat.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    const p2: any[] = await signer.getPending();
    assert.strictEqual(p2.length, 1, 'Cooldown must not survive an account switch');

    signer.resolveRequest(p2[0].id, { allow: false, remember: false });
  });

  it('cleanupStale clears the cooldown', async () => {
    await setupVault();

    const first: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const p1: any[] = await signer.getPending();
    signer.resolveRequest(p1[0].id, { allow: true, remember: false });
    await first;

    await signer.cleanupStale();

    signer.handleGetPublicKey('chat.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    const p2: any[] = await signer.getPending();
    assert.strictEqual(p2.length, 1, 'cleanupStale must drop the cooldown');

    signer.resolveRequest(p2[0].id, { allow: false, remember: false });
  });

  it('clearGetPubkeyCooldown(origin) invalidates only that origin', async () => {
    await setupVault();

    // Seed cooldown on two origins
    for (const origin of ['chat.com', 'other.com']) {
      const p: Promise<any> = signer.handleGetPublicKey(origin);
      await new Promise<void>(r => setTimeout(r, 50));
      const pending: any[] = await signer.getPending();
      signer.resolveRequest(pending[0].id, { allow: true, remember: false });
      await p;
    }

    // Clear only chat.com
    signer.clearGetPubkeyCooldown('chat.com');

    // chat.com must re-prompt
    signer.handleGetPublicKey('chat.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    let pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].origin, 'chat.com');
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });

    // other.com must still auto-allow
    const otherPubkey: any = await signer.handleGetPublicKey('other.com');
    assert.strictEqual(otherPubkey, TEST_PUBKEY_HEX);
    await new Promise<void>(r => setTimeout(r, 50));
    pending = await signer.getPending();
    assert.strictEqual(pending.length, 0);
  });
});

// -- getPublicKey on already-connected sites (no self-opening popup) --
//
// Connecting a site IS the consent to share the identity pubkey, so a site on
// the allowlist must never queue a getPublicKey prompt. Before this, approving
// the prompt persisted nothing but a 60s in-memory cooldown, so the prompt --
// and the popup it auto-opens -- came back on every service-worker restart.

describe('signer -- getPublicKey on connected sites', () => {
  // A prompted call stays unresolved for the full 120s request timeout, which
  // would hang the suite instead of failing it. Bound the wait so a regression
  // surfaces as a failed assertion.
  function withinTimeout<T>(p: Promise<T>, ms = 500): Promise<T> {
    return Promise.race([p, new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error('handleGetPublicKey did not resolve -- it prompted')), ms);
      t.unref?.();
    })]);
  }

  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('a connected site gets the pubkey with no prompt', async () => {
    await setupVault();
    await addAllowedDomain('chat.com');

    const call: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 0, 'a connected site must not enqueue a prompt');
    assert.strictEqual(await withinTimeout(call), TEST_PUBKEY_HEX);
  });

  it('does not re-prompt after a service-worker restart', async () => {
    await setupVault();
    await addAllowedDomain('chat.com');
    await withinTimeout(signer.handleGetPublicKey('chat.com'));

    // cleanupStale() drops all in-memory signer state, as an MV3 SW restart does
    await signer.cleanupStale();

    const call: Promise<any> = signer.handleGetPublicKey('chat.com');
    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 0, 'the grant must survive a service-worker restart');
    assert.strictEqual(await withinTimeout(call), TEST_PUBKEY_HEX);
  });

  it('an explicit deny still blocks a connected site', async () => {
    await setupVault();
    await addAllowedDomain('chat.com');
    await permissions.save('chat.com', 'getPublicKey', null, 'deny', 'acct1');

    await assert.rejects(signer.handleGetPublicKey('chat.com'), /Permission denied/);
  });

  it('an origin that is not connected still prompts', async () => {
    await setupVault();

    signer.handleGetPublicKey('stranger.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'an unconnected origin must still ask');
    assert.strictEqual(pending[0].origin, 'stranger.com');

    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
  });

  it('disconnecting the site restores the prompt', async () => {
    await setupVault();
    await addAllowedDomain('chat.com');
    await withinTimeout(signer.handleGetPublicKey('chat.com'));

    await removeAllowedDomain('chat.com');

    signer.handleGetPublicKey('chat.com').catch(() => {});
    await new Promise<void>(r => setTimeout(r, 50));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'a disconnected site must ask again');

    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
  });
});

// -- Account switch invalidation (identity-leak fix) --

describe('signer -- account switch invalidates pending getPublicKey', () => {
  const SECOND_PUBKEY_HEX = '1212121212121212121212121212121212121212121212121212121212121212';

  function makeTwoAccountPayload(): VaultPayload {
    const payload = makePayload();
    payload.accounts.push({
      id: 'acct2',
      name: 'Second',
      type: 'nsec',
      pubkey: SECOND_PUBKEY_HEX,
      privkey: '0000000000000000000000000000000000000000000000000000000000000002',
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 2000000
    });
    return payload;
  }

  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
    await vault.create(TEST_PASSWORD, makeTwoAccountPayload());
    await browserMock.storage.local.set({
      accounts: [
        { id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX },
        { id: 'acct2', type: 'nsec', pubkey: SECOND_PUBKEY_HEX },
      ],
      activeAccountId: 'acct1',
    });
    await browserMock.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
  });

  it('onActiveAccountChanged rejects a pending getPublicKey prompt for the old account', async () => {
    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    // Simulate what every account-change path now does
    await signer.onActiveAccountChanged('acct1', 'acct2');

    await assert.rejects(p, /User denied access/);
    assert.strictEqual((await signer.getPending()).length, 0, 'Pending prompt must be cleared');
  });

  it('approval after a mid-prompt account change never returns account B pubkey', async () => {
    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].pubkey, TEST_PUBKEY_HEX, 'Prompt shows account A identity');

    // Account switches to B while the prompt is open (bypassing invalidation)
    await vault.setActiveAccount('acct2');
    await browserMock.storage.local.set({ activeAccountId: 'acct2' });
    await browserMock.storage.sync.set({ myPubkey: SECOND_PUBKEY_HEX });

    // Approving now must NOT hand out B's pubkey
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });
    await assert.rejects(p, /Account switched/);
  });

  it('approval with unchanged account returns the snapshotted pubkey', async () => {
    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    const pending: any[] = await signer.getPending();
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });
    assert.strictEqual(await p, TEST_PUBKEY_HEX);
  });

  it('vault_setActiveAccount handler rejects pending prompts for the previous account', async () => {
    const vaultHandlers = await import('../lib/bg/vault-handlers.ts');
    const setActive = vaultHandlers.handlers.get('vault_setActiveAccount')!;

    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    await setActive({ accountId: 'acct2' });

    await assert.rejects(p, /User denied access/);
    assert.strictEqual((await signer.getPending()).length, 0);
  });

  it('onboarding_addToVault rejects pending prompts for the previous account', async () => {
    const addToVault = onboarding.handlers.get('onboarding_addToVault')!;

    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    await addToVault({
      account: {
        id: 'acct3',
        name: 'New',
        type: 'nsec',
        pubkey: SECOND_PUBKEY_HEX,
        privkey: '0000000000000000000000000000000000000000000000000000000000000003',
        mnemonic: null,
        nip46Config: null,
        readOnly: false,
        createdAt: 3000000,
      },
    });

    await assert.rejects(p, /User denied access/);
    assert.strictEqual((await signer.getPending()).length, 0);
  });

  it('onboarding_createVault rejects pending prompts for the previous account', async () => {
    const createVault = onboarding.handlers.get('onboarding_createVault')!;

    const p: Promise<any> = signer.handleGetPublicKey('site.com');
    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    await createVault({
      password: 'newvaultpass123',
      account: {
        id: 'acctNew',
        name: 'Fresh',
        type: 'nsec',
        pubkey: SECOND_PUBKEY_HEX,
        privkey: '0000000000000000000000000000000000000000000000000000000000000004',
        mnemonic: null,
        nip46Config: null,
        readOnly: false,
        createdAt: 4000000,
      },
    });

    await assert.rejects(p, /User denied access/);
    assert.strictEqual((await signer.getPending()).length, 0);
  });
});

// -- NIP-46 local deny (permission check before remote routing) --

describe('signer -- NIP-46 accounts honor local deny', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
    await browserMock.storage.local.set({
      accounts: [{ id: 'n1', type: 'nip46', pubkey: TEST_PUBKEY_HEX }],
      activeAccountId: 'n1',
    });
  });

  it('signEvent with a local per-origin deny throws before routing to the bunker', async () => {
    await permissions.save('evil.com', 'signEvent', 1, 'deny');
    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hi', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'evil.com'
      ),
      /Permission denied/
    );
    assert.strictEqual((await signer.getPending()).length, 0, 'Nothing queued or forwarded');
  });

  it('nip04Encrypt with a local deny throws before routing to the bunker', async () => {
    await permissions.save('evil.com', 'nip04Encrypt', null, 'deny');
    await assert.rejects(
      signer.handleNip04Encrypt(THEIR_PUBKEY_HEX, 'secret', 'evil.com'),
      /Permission denied/
    );
    assert.strictEqual((await signer.getPending()).length, 0);
  });

  it('nip44Decrypt with a local deny throws before routing to the bunker', async () => {
    await permissions.save('evil.com', 'nip44Decrypt', null, 'deny');
    await assert.rejects(
      signer.handleNip44Decrypt(THEIR_PUBKEY_HEX, 'ciphertext', 'evil.com'),
      /Permission denied/
    );
  });
});

// -- Full event snapshot in the approval prompt --

describe('signer -- pending entry carries full content and tags', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('stores untruncated content and all tags for a non-kind-3 event', async () => {
    await setupVault();

    const longContent = 'x'.repeat(1000);
    const tags = [['e', 'abc'], ['p', THEIR_PUBKEY_HEX], ['payload', 'hidden-in-tags']];
    const p: Promise<any> = signer.handleSignEvent(
      { kind: 30078, content: longContent, tags, created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].event.content, longContent, 'Content must not be truncated');
    assert.deepStrictEqual(pending[0].event.tags, tags, 'All tags must be stored for every kind');

    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
    await assert.rejects(p, /User denied/);
  });
});

// -- Per-origin pending request cap (popup-spam / DoS guard) --

describe('signer -- per-origin pending request cap', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('rejects the 6th concurrent request from one origin; other origins unaffected', async () => {
    await setupVault();

    const mkEvent = (i: number) => ({
      kind: 1, content: `spam ${i}`, tags: [] as string[][], created_at: Math.floor(Date.now() / 1000)
    });

    const promises: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(signer.handleSignEvent(mkEvent(i), 'spam.com'));
    }
    await new Promise<void>(r => setTimeout(r, 300));
    assert.strictEqual((await signer.getPending()).length, 5);

    // 6th request from the same origin is rejected outright
    await assert.rejects(
      signer.handleSignEvent(mkEvent(6), 'spam.com'),
      /Too many pending requests/
    );

    // A different origin still queues fine
    const other: Promise<any> = signer.handleSignEvent(mkEvent(7), 'ok.com');
    await new Promise<void>(r => setTimeout(r, 100));
    assert.strictEqual((await signer.getPending()).length, 6);

    // Clean up
    for (const req of await signer.getPending()) {
      signer.resolveRequest(req.id, { allow: false, remember: false });
    }
    for (const p of promises) await assert.rejects(p, /User denied/);
    await assert.rejects(other, /User denied/);
  });

  it('resolving requests frees capacity for the origin', async () => {
    await setupVault();

    const mkEvent = (i: number) => ({
      kind: 1, content: `msg ${i}`, tags: [] as string[][], created_at: Math.floor(Date.now() / 1000)
    });

    const promises: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(signer.handleSignEvent(mkEvent(i), 'busy.com'));
    }
    await new Promise<void>(r => setTimeout(r, 300));

    // Deny all to free capacity
    for (const req of await signer.getPending()) {
      signer.resolveRequest(req.id, { allow: false, remember: false });
    }
    for (const p of promises) await assert.rejects(p, /User denied/);
    await new Promise<void>(r => setTimeout(r, 100));

    // New request queues again
    const next: Promise<any> = signer.handleSignEvent(mkEvent(9), 'busy.com');
    await new Promise<void>(r => setTimeout(r, 100));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'Capacity must be freed after resolve');
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
    await assert.rejects(next, /User denied/);
  });
});

// -- NostrConnect (nostrconnect:// QR) persisted/resumable session --

describe('onboarding -- nostrconnect persisted session', () => {
  const SIGNER_PUBKEY = '1111111111111111111111111111111111111111111111111111111111111111';
  const FAKE_URI = 'nostrconnect://abc?relay=wss://relay.test&secret=deadbeef';

  // Controls how the next BunkerSigner.fromURI() resolves.
  let nextBehavior: 'pending' | 'resolve' | 'reject';
  let rejectMessage: string;
  let fromUriCalls: number;

  const initHandler = onboarding.handlers.get('onboarding_initNostrConnect')!;
  const pollHandler = onboarding.handlers.get('onboarding_pollNostrConnect')!;
  const cancelHandler = onboarding.handlers.get('onboarding_cancelNostrConnect')!;

  // Minimal fake BunkerSigner with a static fromURI matching nostr-tools shape.
  const FakeBunkerSigner = {
    fromURI(_sk: Uint8Array, _uri: string, _opts: unknown, signal?: AbortSignal): Promise<any> {
      fromUriCalls++;
      if (nextBehavior === 'resolve') {
        return Promise.resolve({ bp: { pubkey: SIGNER_PUBKEY }, close: () => Promise.resolve() });
      }
      if (nextBehavior === 'reject') {
        return Promise.reject(new Error(rejectMessage));
      }
      // 'pending': never settles on its own (mirrors waiting-for-scan).
      return new Promise(() => { void signal; });
    },
  };

  const fakeCreateUri = (_opts: unknown): string => FAKE_URI;

  beforeEach(() => {
    resetMockStorage();
    nextBehavior = 'pending';
    rejectMessage = 'relay refused';
    fromUriCalls = 0;
    onboarding.__simulateServiceWorkerRestart();
    onboarding.__setNip46Deps({
      BunkerSigner: FakeBunkerSigner as any,
      createNostrConnectURI: fakeCreateUri as any,
    });
  });

  async function readMirror(sessionId: string): Promise<any | undefined> {
    const data = await browserMock.storage.session.get(['_ncSessions']) as Record<string, any>;
    return (data._ncSessions || {})[sessionId];
  }

  it('init persists a waiting mirror and returns uri + sessionId', async () => {
    const res: any = await initHandler({});
    assert.strictEqual(res.nostrconnectUri, FAKE_URI);
    assert.ok(res.sessionId, 'should return a sessionId');

    const mirror = await readMirror(res.sessionId);
    assert.ok(mirror, 'persisted mirror should exist');
    assert.strictEqual(mirror.status, 'waiting');
    assert.strictEqual(mirror.nostrconnectUri, FAKE_URI);
    assert.strictEqual(mirror.localPubkey?.length, 64, 'localPubkey should be 32-byte hex');

    // S-6: the secret must NOT be stored in plaintext on the mirror.
    assert.strictEqual(mirror.secretKeyHex, undefined, 'mirror must not carry plaintext secret');
    const secrets = (await browserMock.storage.session.get(['_ncSessionSecrets']) as any)._ncSessionSecrets;
    assert.ok(secrets[res.sessionId].pad && secrets[res.sessionId].masked, 'secret stored XOR-split');
  });

  it('poll on an unknown sessionId returns expired', async () => {
    const res: any = await pollHandler({ sessionId: 'does-not-exist' });
    assert.deepStrictEqual(res, { expired: true });
  });

  it('SW restart: poll rebuilds via ensureLiveSession and does NOT return expired', async () => {
    const init: any = await initHandler({});

    // Drop the in-memory Map but keep storage.session (SW suspension).
    onboarding.__simulateServiceWorkerRestart();
    const callsBefore = fromUriCalls;

    const res: any = await pollHandler({ sessionId: init.sessionId });
    assert.strictEqual(res.expired, undefined, 'must not be expired after restart');
    assert.strictEqual(res.connected, false, 'signer still waiting -> not connected');
    assert.strictEqual(fromUriCalls, callsBefore + 1, 'ensureLiveSession should rebuild the signer');
  });

  it('signer resolves: poll returns connected + account without leaking secrets, mirror deleted', async () => {
    nextBehavior = 'resolve';
    const init: any = await initHandler({});

    // Let the resolved signerPromise .then run.
    await new Promise<void>(r => setTimeout(r, 20));

    const res: any = await pollHandler({ sessionId: init.sessionId });
    assert.strictEqual(res.connected, true);
    assert.ok(res.account, 'account should be returned');
    assert.strictEqual(res.account.type, 'nip46');
    assert.strictEqual(res.account.pubkey, SIGNER_PUBKEY);
    assert.strictEqual(res.account.privkey, undefined, 'privkey must not leak');
    assert.strictEqual(res.account.nip46Config, undefined, 'nip46Config must not leak');
    assert.strictEqual(res.account.mnemonic, undefined, 'mnemonic must not leak');

    // Mirror must be gone after a successful connect.
    assert.strictEqual(await readMirror(init.sessionId), undefined, 'mirror deleted on connect');
  });

  it('signer rejects: poll returns { error } and deletes the mirror', async () => {
    nextBehavior = 'reject';
    rejectMessage = 'relay handshake failed';
    const init: any = await initHandler({});

    // Let the rejected signerPromise .catch persist the error status.
    await new Promise<void>(r => setTimeout(r, 20));

    const res: any = await pollHandler({ sessionId: init.sessionId });
    assert.strictEqual(res.error, 'relay handshake failed');
    assert.strictEqual(res.expired, undefined, 'a real error must not masquerade as expired');
    assert.strictEqual(await readMirror(init.sessionId), undefined, 'mirror deleted on error');
  });

  it('TTL expiry: poll returns expired and deletes the mirror', async () => {
    const init: any = await initHandler({});

    // Backdate createdAt beyond the 5-min TTL.
    const data = await browserMock.storage.session.get(['_ncSessions']) as Record<string, any>;
    data._ncSessions[init.sessionId].createdAt = Date.now() - (6 * 60 * 1000);
    await browserMock.storage.session.set({ _ncSessions: data._ncSessions });

    const res: any = await pollHandler({ sessionId: init.sessionId });
    assert.deepStrictEqual(res, { expired: true });
    assert.strictEqual(await readMirror(init.sessionId), undefined, 'expired mirror deleted');
  });

  it('cancel removes both the in-memory session and the persisted mirror', async () => {
    const init: any = await initHandler({});
    assert.ok(await readMirror(init.sessionId), 'mirror exists before cancel');

    const res: any = await cancelHandler({ sessionId: init.sessionId });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(await readMirror(init.sessionId), undefined, 'mirror deleted on cancel');

    // A subsequent poll should now report expired (nothing to resume).
    const poll: any = await pollHandler({ sessionId: init.sessionId });
    assert.deepStrictEqual(poll, { expired: true });
  });

  it('init resumes an existing waiting session instead of creating a second', async () => {
    const first: any = await initHandler({});
    const callsAfterFirst = fromUriCalls;

    // Simulate the popup remounting (e.g. after blur) and re-initing.
    onboarding.__simulateServiceWorkerRestart();
    const second: any = await initHandler({});

    assert.strictEqual(second.sessionId, first.sessionId, 'must resume the same sessionId');
    assert.strictEqual(second.nostrconnectUri, first.nostrconnectUri, 'must hand back the same URI');

    // Only one persisted mirror should exist.
    const sessions = (await browserMock.storage.session.get(['_ncSessions']) as any)._ncSessions;
    assert.strictEqual(Object.keys(sessions).length, 1, 'no duplicate session created');

    // The resume must rebuild (one extra fromURI) rather than mint fresh keys.
    assert.strictEqual(fromUriCalls, callsAfterFirst + 1, 'resume rebuilds the live signer');
  });
});
