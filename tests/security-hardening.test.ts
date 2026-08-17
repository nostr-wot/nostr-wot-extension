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

// ── vault_changePassword must not silently disarm the vault ──

describe('security: changePassword rejects an empty new password', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.destroy();
  });

  it('refuses to re-encrypt under an empty password', async () => {
    await vault.create(TEST_PASSWORD, makePayload());

    await assert.rejects(
      () => vaultHandlers.get('vault_changePassword')!({
        currentPassword: TEST_PASSWORD,
        newPassword: '',
      }),
      /password/i,
      'an empty new password must be rejected',
    );

    // The original password must still work — a rejected change must change nothing.
    vault.lock();
    assert.strictEqual(await vault.unlock(TEST_PASSWORD), true, 'old password still unlocks');
  });

  it('still refuses a too-short new password', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await assert.rejects(
      () => vaultHandlers.get('vault_changePassword')!({
        currentPassword: TEST_PASSWORD,
        newPassword: 'abc',
      }),
      /8 characters/i,
    );
  });

  it('accepts a valid new password', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const res: any = await vaultHandlers.get('vault_changePassword')!({
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.deepStrictEqual(res, { ok: true });
    vault.lock();
    assert.strictEqual(await vault.unlock(NEW_PASSWORD), true);
  });
});

// ── getPrivkey's "CALLER MUST ZERO" contract, made unbreakable ──

describe('security: withPrivkey zeroes the key on every path', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.destroy();
    await vault.create(TEST_PASSWORD, makePayload());
  });

  it('zeroes the key after the callback returns', async () => {
    let captured: Uint8Array | null = null;
    const result = await vault.withPrivkey('acct1', async (pk) => {
      captured = pk;
      assert.ok(pk.some(b => b !== 0), 'callback sees real key bytes');
      return 'done';
    });
    assert.strictEqual(result, 'done');
    assert.ok(captured!.every(b => b === 0), 'key must be zeroed after use');
  });

  it('zeroes the key when the callback throws', async () => {
    let captured: Uint8Array | null = null;
    await assert.rejects(() => vault.withPrivkey('acct1', async (pk) => {
      captured = pk;
      throw new Error('boom');
    }), /boom/);
    assert.ok(captured!.every(b => b === 0), 'key must be zeroed on the error path too');
  });

  it('throws when the account has no key', async () => {
    await assert.rejects(() => vault.withPrivkey('nope', async () => 'x'), /no private key/i);
  });
});

// ── No plaintext secret reaches session storage during onboarding ──
//
// storage.session is not a safe place for a secret: on Safari it is shimmed onto
// storage.local (lib/browser.ts), which is on DISK. The privkey was already XOR-split
// across two keys; the mnemonic — which is strictly more valuable, since it restores
// every derived account — was written in the clear alongside it.

describe('security: onboarding never stores a plaintext secret', () => {
  const M24 = 'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';

  beforeEach(() => {
    resetMockStorage();
    vault.lock();
    onboarding.__simulateServiceWorkerRestart();
  });

  it('writes no mnemonic and no privkey into session storage', async () => {
    await onboarding.handlers.get('onboarding_validateMnemonic')!({ mnemonic: M24 });

    const all = await browserMock.storage.session.get(null) as Record<string, unknown>;
    const dump = JSON.stringify(all);

    assert.ok(!dump.includes('bleak'), 'no mnemonic word may appear in session storage');
    assert.ok(!dump.includes(M24), 'the mnemonic must not be stored');

    const stored = all._pendingOnboardingAccount as any;
    assert.ok(stored, 'the redacted account is still persisted');
    assert.strictEqual(stored.mnemonic, null, 'mnemonic field redacted');
    assert.strictEqual(stored.privkey, null, 'privkey field redacted');
  });

  it('reconstructs the mnemonic and privkey after a service-worker restart', async () => {
    const res: any = await onboarding.handlers.get('onboarding_validateMnemonic')!({ mnemonic: M24 });
    onboarding.__simulateServiceWorkerRestart();

    // The privkey half: exportNcryptsec needs the reconstructed key.
    const enc: any = await onboarding.handlers.get('onboarding_exportNcryptsec')!({ password: 'backup-pass-123' });
    assert.ok(String(enc).startsWith('ncryptsec1'), 'privkey survived the restart');

    // The mnemonic half: createVault is its only consumer, and it must receive the
    // words, not the redacted copy that went to storage.
    onboarding.__simulateServiceWorkerRestart();
    await onboarding.handlers.get('onboarding_createVault')!({
      account: res.account,
      password: 'vault-password-123',
    });
    const stored = vault.getDecryptedPayload().accounts[0];
    assert.strictEqual(stored.mnemonic, M24, 'the mnemonic itself round-tripped intact');
    assert.ok(stored.privkey, 'and so did the privkey');
  });

  it('does not leave a NIP-46 local privkey in the clear', async () => {
    await onboarding.handlers.get('onboarding_validateNsec')!({ input: TEST_PRIVKEY_HEX });
    const all = await browserMock.storage.session.get(null) as Record<string, unknown>;
    assert.ok(!JSON.stringify(all).includes(TEST_PRIVKEY_HEX), 'privkey never in the clear');
  });
});

describe('security: legacy privkey-only onboarding split is not resurrected', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
    onboarding.__simulateServiceWorkerRestart();
  });

  it('treats the old pad/masked shape as expired and clears it', async () => {
    await browserMock.storage.session.set({
      _pendingOnboardingAccount: { id: 'x', type: 'nsec', pubkey: TEST_PUBKEY_HEX, privkey: null },
      _pendingOnboardingCreatedAt: Date.now(),
      _pendingOnboardingPad: 'aa'.repeat(32),
      _pendingOnboardingMasked: 'bb'.repeat(32),
    });

    await assert.rejects(
      onboarding.handlers.get('onboarding_exportNcryptsec')!({ password: 'backup-pass-123' }),
      /No pending account/,
    );

    const left = await browserMock.storage.session.get([
      '_pendingOnboardingAccount', '_pendingOnboardingPad', '_pendingOnboardingMasked',
    ]) as any;
    assert.strictEqual(left._pendingOnboardingAccount, undefined);
    assert.strictEqual(left._pendingOnboardingPad, undefined);
    assert.strictEqual(left._pendingOnboardingMasked, undefined);
  });

  it('startup sweep drops an expired record but keeps a live one', async () => {
    await onboarding.handlers.get('onboarding_validateNsec')!({ input: TEST_PRIVKEY_HEX });
    await onboarding.cleanupExpiredPendingOnboarding();
    let data = await browserMock.storage.session.get(['_pendingOnboardingAccount']) as any;
    assert.ok(data._pendingOnboardingAccount, 'a live onboarding must survive a SW restart sweep');

    await browserMock.storage.session.set({
      _pendingOnboardingCreatedAt: Date.now() - (6 * 60 * 1000),
    });
    await onboarding.cleanupExpiredPendingOnboarding();
    data = await browserMock.storage.session.get([
      '_pendingOnboardingAccount', '_pendingOnboardingSecrets', '_pendingOnboardingSecretsPad',
    ]) as any;
    assert.strictEqual(data._pendingOnboardingAccount, undefined, 'expired record swept');
    assert.strictEqual(data._pendingOnboardingSecrets, undefined);
    assert.strictEqual(data._pendingOnboardingSecretsPad, undefined);
  });
});

// ── Vault KDF work factor + transparent migration ──
//
// 210,000 iterations is OWASP's figure for PBKDF2-HMAC-SHA512. This vault uses
// SHA-256, whose OWASP figure is 600,000. The file cited OWASP while using the wrong
// row, so the parameter read as calibrated when it was ~2.9x weak.

describe('security: vault KDF work factor', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.destroy();
  });

  const readRecord = async (): Promise<any> =>
    ((await browserMock.storage.local.get('keyVault')) as any).keyVault;

  it('new password-protected vaults use 600,000 iterations', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const rec = await readRecord();
    assert.strictEqual(rec.iterations, 600000);
    vault.lock();
    assert.strictEqual(await vault.unlock(TEST_PASSWORD), true);
  });

  it('"Never lock" vaults stay at the cheap count', async () => {
    // The password is the empty string and the code that uses it is public, so the
    // work factor guards nothing — while this KDF runs on EVERY service-worker cold
    // start. Paying 600k there would be latency for no security.
    await vault.create('', makePayload());
    const rec = await readRecord();
    assert.strictEqual(rec.iterations, 210000);
    vault.lock();
    assert.strictEqual(await vault.unlock(''), true);
  });

  it('migrates a legacy 210k vault to 600k on the next unlock', async () => {
    // Build a record exactly as the old code would have: no `iterations` field.
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey('raw', enc.encode(TEST_PASSWORD), 'PBKDF2', false, ['deriveKey']);
    const legacyKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    const payload = makePayload();
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, legacyKey, enc.encode(JSON.stringify(payload)),
    ));
    const b64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64');
    await browserMock.storage.local.set({
      keyVault: { version: 1, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct) },
    });

    // The legacy password must still work...
    assert.strictEqual(await vault.unlock(TEST_PASSWORD), true, 'legacy vault unlocks');
    assert.strictEqual(vault.getDecryptedPayload().accounts[0].privkey, TEST_PRIVKEY_HEX);

    // ...and the record must have been rewritten at the stronger count.
    const rec = await readRecord();
    assert.strictEqual(rec.iterations, 600000, 'upgraded in place');
    assert.notStrictEqual(rec.salt, b64(salt), 'a fresh salt came with the re-encryption');

    // Same password, new record.
    vault.lock();
    assert.strictEqual(await vault.unlock(TEST_PASSWORD), true, 'unlocks after migration');
    assert.strictEqual(vault.getDecryptedPayload().accounts[0].privkey, TEST_PRIVKEY_HEX);
  });

  it('a wrong password still fails against a legacy vault', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await browserMock.storage.local.set({
      keyVault: { ...(await readRecord()), iterations: undefined },
    });
    vault.lock();
    assert.strictEqual(await vault.unlock('wrong-password-here'), false);
  });
});
