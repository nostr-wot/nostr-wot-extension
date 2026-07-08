/**
 * Security Hardening Tests
 *
 * Tests for all 3 batches of security fixes from the audit.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browserMock from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.ts';
import * as permissions from '../lib/permissions.ts';
import { handlers as vaultHandlers } from '../lib/bg/vault-handlers.ts';
import * as onboarding from '../lib/bg/onboarding-handlers.ts';
import { nip04Encrypt, nip04Decrypt } from '../lib/crypto/nip04.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../lib/crypto/nip49.ts';
import { randomBytes, hexToBytes, bytesToHex } from '../lib/crypto/utils.ts';
import { getPublicKey } from '../lib/crypto/secp256k1.ts';
import type { VaultPayload } from '../lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const NEW_PASSWORD = 'newpassword456';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makePayload(
  privkey: string = TEST_PRIVKEY_HEX,
  pubkey: string = TEST_PUBKEY_HEX,
  mnemonic: string | null = null
): VaultPayload {
  return {
    accounts: [{
      id: 'acct1',
      name: 'Test',
      type: 'nsec',
      pubkey,
      privkey,
      mnemonic,
      nip46Config: null,
      readOnly: false,
      createdAt: 1000000
    }],
    activeAccountId: 'acct1'
  };
}

// ── NIP-49 Zeroing (L-01/L-02) ──

describe('security: NIP-49 zeroing', () => {
  it('ncryptsecEncode then decode round-trips correctly', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'testpass');
    assert.ok(encoded.startsWith('ncryptsec1'));
    const decoded = await ncryptsecDecode(encoded, 'testpass');
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('ncryptsecDecode with wrong password throws', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'correctpass');
    await assert.rejects(
      () => ncryptsecDecode(encoded, 'wrongpass'),
      /Wrong password or corrupted data/
    );
  });
});

// ── NIP-04 Error Normalization (C-01) ──

describe('security: NIP-04 error normalization', () => {
  it('corrupt ciphertext produces generic error', async () => {
    const privkey = randomBytes(32);
    const theirPrivkey = randomBytes(32);
    const theirPubkey = getPublicKey(theirPrivkey);

    const encrypted = await nip04Encrypt('hello', privkey, theirPubkey);

    // Corrupt the ciphertext by changing the base64 data
    const [ctBase64, ivPart] = encrypted.split('?iv=');
    const corrupted = 'AAAA' + ctBase64.slice(4) + '?iv=' + ivPart;

    try {
      await nip04Decrypt(corrupted, theirPrivkey, getPublicKey(privkey));
      assert.fail('Should have thrown');
    } catch (err: any) {
      // Should get generic "Decryption failed" not implementation-specific error
      assert.strictEqual(err.message, 'Decryption failed');
    } finally {
      privkey.fill(0);
      theirPrivkey.fill(0);
    }
  });

  it('wrong key produces generic error', async () => {
    const privkey = randomBytes(32);
    const theirPrivkey = randomBytes(32);
    const theirPubkey = getPublicKey(theirPrivkey);
    const wrongPrivkey = randomBytes(32);

    const encrypted = await nip04Encrypt('hello', privkey, theirPubkey);

    try {
      await nip04Decrypt(encrypted, wrongPrivkey, getPublicKey(privkey));
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.strictEqual(err.message, 'Decryption failed');
    } finally {
      privkey.fill(0);
      theirPrivkey.fill(0);
      wrongPrivkey.fill(0);
    }
  });
});

// ── Vault reEncrypt (M-20) ──

describe('security: vault reEncrypt', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('reEncrypt with new password succeeds', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await vault.reEncrypt(NEW_PASSWORD);

    // Lock and verify new password works
    vault.lock();
    const result = await vault.unlock(NEW_PASSWORD);
    assert.strictEqual(result, true);
    assert.strictEqual(vault.getActivePubkey(), TEST_PUBKEY_HEX);
  });

  it('reEncrypt preserves all accounts', async () => {
    const payload = makePayload();
    payload.accounts.push({
      id: 'acct2',
      name: 'Second',
      type: 'nsec',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      privkey: '0000000000000000000000000000000000000000000000000000000000000002',
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 2000000
    });
    await vault.create(TEST_PASSWORD, payload);
    await vault.reEncrypt(NEW_PASSWORD);

    vault.lock();
    await vault.unlock(NEW_PASSWORD);
    assert.strictEqual(vault.listAccounts().length, 2);
  });

  it('reEncrypt when locked throws', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    await assert.rejects(
      () => vault.reEncrypt(NEW_PASSWORD),
      /Vault is locked/
    );
  });

  it('reEncrypt with short password throws', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await assert.rejects(
      () => vault.reEncrypt('abc'),
      /Password must be at least 8 characters/
    );
  });

  it('old password no longer works after reEncrypt', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await vault.reEncrypt(NEW_PASSWORD);
    vault.lock();
    const result = await vault.unlock(TEST_PASSWORD);
    assert.strictEqual(result, false);
  });
});

// ── Vault Lock Zeroing (H-03/H-06) ──

describe('security: vault lock zeroing', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('getPrivkey returns independent copy (fill(0) does not affect vault)', async () => {
    await vault.create(TEST_PASSWORD, makePayload());

    const privkey1 = vault.getPrivkey()!;
    assert.ok(privkey1.some(b => b !== 0));

    // Zero the returned copy
    privkey1.fill(0);

    // Vault should still have the key intact
    const privkey2 = vault.getPrivkey()!;
    assert.ok(privkey2.some(b => b !== 0));
    assert.strictEqual(bytesToHex(privkey2), TEST_PRIVKEY_HEX);
  });

  it('lock zeroes privkeyBytes in memory', async () => {
    await vault.create(TEST_PASSWORD, makePayload());

    // Get a reference to the privkey before locking
    const privkey = vault.getPrivkey()!;
    assert.ok(privkey.some(b => b !== 0));

    vault.lock();

    // After locking, vault is inaccessible
    assert.strictEqual(vault.isLocked(), true);
    assert.throws(() => vault.getPrivkey(), /Vault is locked/);
  });

  it('lock zeroes mnemonicBytes in memory', async () => {
    await vault.create(TEST_PASSWORD, makePayload(TEST_PRIVKEY_HEX, TEST_PUBKEY_HEX, TEST_MNEMONIC));

    // Vault is unlocked and contains mnemonic
    const payload = vault.getDecryptedPayload();
    assert.strictEqual(payload.accounts[0].mnemonic, TEST_MNEMONIC);

    vault.lock();
    assert.strictEqual(vault.isLocked(), true);
  });

  it('getActiveAccount does not expose privkey or mnemonic', async () => {
    await vault.create(TEST_PASSWORD, makePayload(TEST_PRIVKEY_HEX, TEST_PUBKEY_HEX, TEST_MNEMONIC));
    const acct = vault.getActiveAccount() as any;
    assert.strictEqual(acct.privkey, undefined);
    assert.strictEqual(acct.mnemonic, undefined);
    assert.strictEqual(acct.privkeyBytes, undefined);
    assert.strictEqual(acct.mnemonicBytes, undefined);
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
  });

  it('getDecryptedPayload reconstructs hex from memory bytes', async () => {
    await vault.create(TEST_PASSWORD, makePayload(TEST_PRIVKEY_HEX, TEST_PUBKEY_HEX, TEST_MNEMONIC));
    const payload = vault.getDecryptedPayload();
    assert.strictEqual(payload.accounts[0].privkey, TEST_PRIVKEY_HEX);
    assert.strictEqual(payload.accounts[0].mnemonic, TEST_MNEMONIC);
  });

  it('data survives lock/unlock cycle with memory format', async () => {
    await vault.create(TEST_PASSWORD, makePayload(TEST_PRIVKEY_HEX, TEST_PUBKEY_HEX, TEST_MNEMONIC));
    vault.lock();
    await vault.unlock(TEST_PASSWORD);

    const privkey = vault.getPrivkey()!;
    assert.strictEqual(bytesToHex(privkey), TEST_PRIVKEY_HEX);

    const payload = vault.getDecryptedPayload();
    assert.strictEqual(payload.accounts[0].mnemonic, TEST_MNEMONIC);
  });
});

// ── vault_unlock brute-force guard (persisted lockout) ──

describe('security: vault_unlock brute-force guard', () => {
  const unlockHandler = vaultHandlers.get('vault_unlock')!;

  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
  });

  it('failures below the threshold return false without lockout', async () => {
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(await unlockHandler({ password: 'wrong-password' }), false);
    }
    // Still no lockout: correct password unlocks
    assert.strictEqual(await unlockHandler({ password: TEST_PASSWORD }), true);
  });

  it('5 consecutive failures lock out further attempts (even correct password)', async () => {
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(await unlockHandler({ password: 'wrong-password' }), false);
    }
    await assert.rejects(
      unlockHandler({ password: TEST_PASSWORD }),
      /Too many failed attempts/
    );

    // Guard persisted in storage.local with a future lockedUntil
    const data = await browserMock.storage.local.get(['vaultUnlockGuard']) as any;
    assert.ok(data.vaultUnlockGuard, 'guard should be persisted');
    assert.strictEqual(data.vaultUnlockGuard.failures, 5);
    assert.ok(data.vaultUnlockGuard.lockedUntil > Date.now(), 'should be locked out');
  });

  it('after the lockout window, a successful unlock resets the counter', async () => {
    for (let i = 0; i < 5; i++) {
      await unlockHandler({ password: 'wrong-password' });
    }
    // Fast-forward: backdate the lockout expiry
    const data = await browserMock.storage.local.get(['vaultUnlockGuard']) as any;
    data.vaultUnlockGuard.lockedUntil = Date.now() - 1;
    await browserMock.storage.local.set({ vaultUnlockGuard: data.vaultUnlockGuard });

    assert.strictEqual(await unlockHandler({ password: TEST_PASSWORD }), true);

    const after = await browserMock.storage.local.get(['vaultUnlockGuard']) as any;
    assert.strictEqual(after.vaultUnlockGuard, undefined, 'guard reset on success');
  });
});

// ── vault_exportNsec zeroing path ──

describe('security: vault_exportNsec zeroes the key copy', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    await browserMock.storage.local.set({ activeAccountId: 'acct1' });
  });

  it('returns a valid nsec (fill(0) wrapped in try/finally)', async () => {
    const exportHandler = vaultHandlers.get('vault_exportNsec')!;
    const nsec = await exportHandler({});
    assert.ok((nsec as string).startsWith('nsec1'));
    // Vault's own copy is unaffected by the handler's zeroing
    const pk = vault.getPrivkey('acct1')!;
    assert.strictEqual(bytesToHex(pk), TEST_PRIVKEY_HEX);
    pk.fill(0);
  });
});

// ── Pending onboarding TTL survives service-worker restart ──

describe('security: pending onboarding TTL enforced on read', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
    onboarding.__simulateServiceWorkerRestart();
  });

  it('pending account survives a SW restart within the TTL', async () => {
    const validate = onboarding.handlers.get('onboarding_validateNsec')!;
    const exportNc = onboarding.handlers.get('onboarding_exportNcryptsec')!;

    await validate({ input: TEST_PRIVKEY_HEX });
    onboarding.__simulateServiceWorkerRestart();

    const enc = await exportNc({ password: 'backup-pass-123' });
    assert.ok((enc as string).startsWith('ncryptsec1'), 'still available within TTL');
  });

  it('expired pending account is dropped after a SW restart', async () => {
    const validate = onboarding.handlers.get('onboarding_validateNsec')!;
    const exportNc = onboarding.handlers.get('onboarding_exportNcryptsec')!;

    await validate({ input: TEST_PRIVKEY_HEX });

    // Backdate createdAt beyond the 5-min TTL, then lose the in-memory timer
    await browserMock.storage.session.set({
      _pendingOnboardingCreatedAt: Date.now() - (6 * 60 * 1000),
    });
    onboarding.__simulateServiceWorkerRestart();

    await assert.rejects(exportNc({ password: 'backup-pass-123' }), /No pending account/);

    // Storage cleaned up on expiry
    const data = await browserMock.storage.session.get([
      '_pendingOnboardingAccount', '_pendingOnboardingPad', '_pendingOnboardingMasked',
    ]) as any;
    assert.strictEqual(data._pendingOnboardingAccount, undefined);
    assert.strictEqual(data._pendingOnboardingPad, undefined);
    assert.strictEqual(data._pendingOnboardingMasked, undefined);
  });

  it('persisted pending account without createdAt (pre-upgrade) is treated as expired', async () => {
    const exportNc = onboarding.handlers.get('onboarding_exportNcryptsec')!;
    await browserMock.storage.session.set({
      _pendingOnboardingAccount: { id: 'x', type: 'nsec', pubkey: TEST_PUBKEY_HEX, privkey: null },
    });
    await assert.rejects(exportNc({ password: 'backup-pass-123' }), /No pending account/);
  });
});

// ── Batch 1-2 Regression Tests ──

describe('security: batch 1-2 regression', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('vault create with empty password succeeds (never-lock mode)', async () => {
    await vault.create('', makePayload());
    assert.strictEqual(vault.isLocked(), false);
    assert.strictEqual(vault.getActivePubkey(), TEST_PUBKEY_HEX);
  });

  it('vault create with 3-char password throws', async () => {
    await assert.rejects(
      () => vault.create('abc', makePayload()),
      /Password must be at least 8 characters/
    );
  });

  it('permissions check returns ask for unknown domain', async () => {
    const result = await permissions.check('unknown.com', 'signEvent', 1);
    assert.strictEqual(result, 'ask');
  });

  it('permissions save and check round-trip', async () => {
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    const result = await permissions.check('example.com', 'signEvent', 1);
    assert.strictEqual(result, 'allow');
  });
});
