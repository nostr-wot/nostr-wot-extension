import { detectRecoveryBackup } from '../src/domain/vault/recoveryBackup.ts';
import { passkeyDisplayName, passkeyRecoveryAccount } from '../src/domain/vault/passkey.ts';
import type { SafeAccount } from '../src/domain/accounts/types.ts';
import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { handlers } from '../src/services/background/vault-handlers.ts';
import { handlers as onboarding } from '../src/services/background/onboarding-handlers.ts';
import { arrayToBase64 } from '../src/lib/crypto/utils.ts';
import { parsePasskeyBackup, validatePasskeyInput } from '../src/domain/vault/passkey.ts';
import { wrapVaultKey, unwrapVaultKey } from '../src/services/vault/passkeyEncryption.ts';
import type { PasskeyInput } from '../src/domain/vault/passkey.ts';
import type { VaultPayload } from '../src/domain/vault/types.ts';
import { importNsec } from '../src/domain/accounts/creation.ts';
import { derivePqKeys } from '../src/lib/crypto/pq.ts';
import { PQ_PROFILE } from '../src/constants/crypto/pq.ts';
import { PASSKEY_MAX_BLOB_BYTES } from '../src/constants/passkey.ts';

const input = (n = 1): PasskeyInput => ({ credentialId: arrayToBase64(new Uint8Array(32).fill(n)), prfSalt: arrayToBase64(new Uint8Array(32).fill(n + 1)), prf: arrayToBase64(new Uint8Array(32).fill(n + 2)) });
const payload = (): VaultPayload => ({ accounts: [{ id: 'test', name: 'Test', type: 'nsec', pubkey: 'a'.repeat(64), privkey: 'b'.repeat(64), mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1 }], activeAccountId: 'test' });
const record = async () => (await browser.storage.local.get('keyVault')).keyVault as any;

describe('passkey vault encryption and lifecycle', () => {
  beforeEach(() => { vault.lock(); resetMockStorage(); });
  afterEach(() => vault.lock());

  async function createOnboarding() {
    await onboarding.get('onboarding_createVault')!({ account: payload().accounts[0], passkey: input(), autoLockMinutes: 15 });
  }
  it('previews verified recovery accounts without replacing the vault', async () => {
    await createOnboarding();
    const backup = await vault.exportPasskeyBackup();
    assert.equal(detectRecoveryBackup(backup), 'vault');
    assert.equal(detectRecoveryBackup('{"format":"unknown"}'), null);
    vault.lock();
    const before = await browser.storage.local.get(null);
    const result = await handlers.get('vault_previewPasskeyBackup')!({backup, ...input()});
    assert.equal((result as any).accounts[0].pubkey, payload().accounts[0].pubkey);
    assert.equal('privkey' in (result as any).accounts[0], false);
    assert.equal(vault.isLocked(), true);
    assert.deepEqual(await browser.storage.local.get(null), before);
    await assert.rejects(handlers.get('vault_previewPasskeyBackup')!({backup, ...input(2)}));
  });
  const configureOnboarding = (options: Record<string, unknown>) => onboarding.get('onboarding_configurePasskeyProtection')!(options);
  for (const mode of ['passkey', 'password', 'none']) it(`authorizes the fresh onboarding ${mode} choice only once without retaining PRF`, async () => {
    await createOnboarding();
    const before = vault.getDecryptedPayload();
    await configureOnboarding({ usePasskey: mode === 'passkey', password: mode === 'none' ? '' : 'chosen-password', autoLockMs: mode === 'none' ? 0 : 900000 });
    assert.deepEqual(vault.getDecryptedPayload(), before);
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
    assert.equal(JSON.stringify(await browser.storage.local.get(null)).includes(input().prf), false);
    vault.lock();
    assert.equal(mode === 'passkey' ? await vault.unlockPasskey(input()) : await vault.unlock(mode === 'none' ? '' : 'chosen-password'), true);
  });
  it('allows the final protection choice after authenticated backup restore', async () => {
    await vault.create('', payload(), input());
    const backup = await vault.exportPasskeyBackup();
    await vault.destroy();
    await handlers.get('vault_restorePasskeyBackup')!({ backup, ...input() });
    await configureOnboarding({ usePasskey: false, password: 'restored-password', autoLockMs: 900000 });
    vault.lock();
    assert.equal(await vault.unlock('restored-password'), true);
  });
  it('does not authorize setup conversion for ordinary creation or unlock', async () => {
    await vault.create('', payload(), input());
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
    vault.lock(); await vault.unlockPasskey(input());
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
  });
  for (const revoke of ['lock', 'switch', 'reauthenticate']) it(`revokes onboarding authorization on ${revoke}`, async () => {
    await createOnboarding();
    if (revoke === 'lock') { vault.lock(); await vault.unlockPasskey(input()); }
    else if (revoke === 'reauthenticate') await vault.unlockPasskey(input());
    else {
      await vault.addAccount({ ...payload().accounts[0], id: 'other' });
      await vault.setActiveAccount('other'); await vault.setActiveAccount('test');
    }
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
    assert.ok(await vault.getPasskey());
  });
  it('expires onboarding authorization after five minutes', async context => {
    await createOnboarding();
    const later = Date.now() + 300001;
    context.mock.method(Date, 'now', () => later);
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
    assert.ok(await vault.getPasskey());
  });
  it('consumes onboarding authorization on a failed write without changing protection', async context => {
    await createOnboarding();
    const before = await record();
    context.mock.method(browser.storage.local, 'set', async () => { throw new Error('storage failed'); });
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /storage failed/);
    context.mock.restoreAll();
    assert.deepEqual(await record(), before);
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
  });
  for (const revoke of ['lock', 'switch']) it(`cancels a pending onboarding None conversion on ${revoke}`, async context => {
    await createOnboarding();
    await vault.addAccount({ ...payload().accounts[0], id: 'other' });
    const before = await record();
    const get = browser.storage.local.get.bind(browser.storage.local);
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    context.mock.method(browser.storage.local, 'get', async (...args: Parameters<typeof get>) => {
      if (args[0] === 'keyVault') { reached(); await gate; }
      return get(...args);
    });
    const pending = configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 });
    await waiting;
    let switched: Promise<void> | undefined;
    if (revoke === 'lock') vault.lock();
    else switched = vault.setActiveAccount('other');
    release();
    await assert.rejects(pending, /verification expired/i);
    await switched;
    context.mock.restoreAll();
    const after = await record();
    assert.equal(after.protection, 'passkey');
    assert.deepEqual(after.passkeys, before.passkeys);
    assert.equal((await browser.storage.local.get('autoLockMs')).autoLockMs, 900000);
  });
  it('serializes concurrent confirmations so only one consumes the setup grant', async () => {
    await createOnboarding();
    const options = { usePasskey: false, password: '', autoLockMs: 0 };
    const results = await Promise.allSettled([configureOnboarding(options), configureOnboarding(options)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  });
  it('requires valid protection options and keeps ordinary settings verification intact', async () => {
    await createOnboarding();
    await assert.rejects(configureOnboarding({ usePasskey: true, autoLockMs: 0 }), /explicitly select None/i);
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 900000 }), /8 characters/i);
    assert.equal(await vault.changeProtection({ usePasskey: false, password: '', autoLockMs: 0 }), false);
    await assert.rejects(configureOnboarding({ usePasskey: false, password: '', autoLockMs: 0 }), /verification expired/i);
    assert.ok(await vault.getPasskey());
  });

  for (const password of ['', 'original-password']) it(`preserves imported nsec and PQC keys in provider/file recovery after ${password ? 'password' : 'no-lock'} migration and adding a passkey`, async () => {
    const account = await importNsec('09'.repeat(32), 'Imported signing identity');
    const seed = new Uint8Array(64).fill(7);
    const keys = derivePqKeys(seed, 0);
    seed.fill(0);
    try {
      await vault.create(password, { accounts: [account], activeAccountId: account.id });
      await vault.setImportedPqKeys(account.id, keys, PQ_PROFILE);
      const originalPq = vault.getDecryptedPayload().accounts[0].pqKeys;
      const cacheIv = crypto.getRandomValues(new Uint8Array(12));
      const cached = await vault.withCacheKey(key => crypto.subtle.encrypt({ name: 'AES-GCM', iv: cacheIv }, key, new TextEncoder().encode('private cache')));
      assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: password, currentPasskey: input(), newPasskey: input() }), true);
      await vault.addPasskey(input(), input(5));
      const backup = await vault.exportPasskeyBackup();
      // The provider blob and file carry this same complete encrypted snapshot.
      const blob = new TextEncoder().encode(backup);
      assert.ok(blob.byteLength < PASSKEY_MAX_BLOB_BYTES, 'a real imported ML-KEM/ML-DSA pair fits the supported blob size');
      for (const secret of [account.privkey!, originalPq!.kem.secret, originalPq!.dsa.secret, input().prf, input(5).prf]) {
        assert.equal(backup.includes(secret), false, 'snapshot must not expose secret material');
      }
      assert.equal(JSON.stringify(vault.listAccounts()).includes('pqKeys'), false);
      await vault.destroy();
      // Restore using the added credential, without the original credential/password.
      await vault.restorePasskeyBackup(new TextDecoder().decode(blob), input(5));
      assert.deepEqual(vault.getDecryptedPayload().accounts[0].pqKeys, originalPq);
      assert.equal(vault.getDecryptedPayload().accounts[0].privkey, account.privkey);
      assert.equal(vault.getDecryptedPayload().accounts[0].mnemonic, null);
      assert.equal(vault.hasImportedPqKeys(account.id), true);
      let secretCopies: Uint8Array[] = [];
      await vault.withImportedPqKeys(account.id, async restored => {
        assert.deepEqual(restored.kemSecret, keys.kem.secretKey);
        assert.deepEqual(restored.dsaSecret, keys.dsa.secretKey);
        assert.equal(restored.kemPublic, arrayToBase64(keys.kem.publicKey));
        assert.equal(restored.dsaPublic, arrayToBase64(keys.dsa.publicKey));
        secretCopies = [restored.kemSecret, restored.dsaSecret];
      });
      assert.ok(secretCopies.every(bytes => bytes.every(value => value === 0)), 'temporary restored secrets are zeroed');
      const plaintext = await vault.withCacheKey(key => crypto.subtle.decrypt({ name: 'AES-GCM', iv: cacheIv }, key, cached));
      assert.equal(new TextDecoder().decode(plaintext), 'private cache');
      vault.lock();
      assert.equal(vault.hasImportedPqKeys(account.id), false);
      assert.equal(await vault.unlockPasskey(input(5)), true);
      assert.deepEqual(vault.getDecryptedPayload().accounts[0].pqKeys, originalPq);
      const publicMetadata = (await browser.storage.local.get('accounts')).accounts;
      assert.equal(JSON.stringify(publicMetadata).includes('pqKeys'), false);
    } finally {
      keys.kem.secretKey.fill(0);
      keys.dsa.secretKey.fill(0);
    }
  });

  it('keeps signing available through passkey → None → password and after unlocking again', async () => {
    await vault.create('', payload(), input());
    await browser.storage.local.set({ activeAccountId: 'test' });
    assert.equal(await vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: '', autoLockMs: 0 }), true);
    await handlers.get('vault_setAutoLock')!({ ms: 900000, password: 'replacement-password' });
    assert.equal(vault.isLocked(), false);
    assert.equal(vault.getActiveAccountId(), 'test');
    await vault.withPrivkey('test', async key => assert.equal(Buffer.from(key).toString('hex'), 'b'.repeat(64)));
    vault.lock();
    assert.equal(await handlers.get('vault_unlock')!({ password: 'replacement-password' }), true);
    assert.equal(vault.getActiveAccountId(), 'test');
    await vault.withPrivkey('test', async key => assert.equal(Buffer.from(key).toString('hex'), 'b'.repeat(64)));
  });

  it('enrolls a first passkey only after proving the current password and preserves the vault', async () => {
    await vault.create('original-password', payload());
    const before = await record();
    assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: 'wrong', newPasskey: input(), currentPasskey: input() }), false);
    assert.deepEqual(await record(), before);
    assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: 'original-password', newPasskey: input(), currentPasskey: input() }), true);
    const backup = await vault.exportPasskeyBackup();
    assert.ok(parsePasskeyBackup(backup).passkeys.length === 1);
    vault.lock();
    assert.equal(await vault.unlockPasskey(input()), true);
    assert.equal(vault.listAccounts()[0].pubkey, payload().accounts[0].pubkey);
  });

  it('toggles registered passkeys without losing accounts, cache keys or enrollment', async () => {
    await vault.create('', payload(), input());
    const enrolled = (await record()).passkeys;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cache = await vault.withCacheKey(key => crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('archive')));
    assert.equal(await vault.changeProtection({ usePasskey: false, currentPasskey: input(9), password: 'new-password' }), false);
    assert.equal(await vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: 'new-password' }), true);
    assert.equal(await vault.getPasskey(), null);
    assert.equal((await vault.listPasskeys()).length, 1);
    assert.deepEqual((await record()).registeredPasskeys.passkeys, enrolled);
    vault.lock();
    assert.equal(await vault.unlockPasskey(input()), false);
    assert.equal(await vault.unlock('new-password'), true);
    await vault.reEncrypt('changed-password');
    const before = await record();
    assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: 'wrong-password', currentPasskey: input() }), false);
    assert.deepEqual(await record(), before);
    assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: 'changed-password', currentPasskey: input(9) }), false);
    assert.equal(await vault.changeProtection({ usePasskey: true, currentPassword: 'changed-password', currentPasskey: input() }), true);
    assert.deepEqual((await record()).passkeys, enrolled);
    vault.lock();
    assert.equal(await vault.unlock('changed-password'), false);
    assert.equal(await vault.unlockPasskey(input()), true);
    await vault.withPrivkey('test', async bytes => assert.equal(Buffer.from(bytes).toString('hex'), 'b'.repeat(64)));
    const restored = await vault.withCacheKey(key => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cache));
    assert.equal(new TextDecoder().decode(restored), 'archive');
  });

  it('does not enroll a passkey through the unlock switch', async () => {
    await vault.create('original-password', payload());
    await assert.rejects(vault.changeProtection({ usePasskey: true, currentPassword: 'original-password', currentPasskey: input() }), /No passkey/);
  });

  it('leaves the old protection usable if saving the replacement fails', async context => {
    await vault.create('', payload(), input());
    const before = await record();
    context.mock.method(browser.storage.local, 'set', async () => { throw new Error('storage failed'); });
    await assert.rejects(vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: 'new-password' }), /storage failed/);
    assert.deepEqual(await record(), before);
    context.mock.restoreAll();
    vault.lock();
    assert.equal(await vault.unlockPasskey(input()), true);
  });

  it('protection-change RPC counts wrong current credentials toward lockout', async () => {
    await vault.create('', payload(), input());
    const change = handlers.get('vault_changeProtection')!;
    for (let i = 0; i < 5; i++) await assert.rejects(change({ usePasskey: false, currentPasskey: input(9), password: 'new-password' }), /incorrect/);
    await assert.rejects(change({ usePasskey: false, currentPasskey: input(), password: 'new-password' }), /Too many/);
    assert.ok(await vault.getPasskey());
  });

  it('preserves enrollment across never-lock and refuses switching a locked vault', async () => {
    await vault.create('', payload(), input());
    await vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: 'new-password' });
    await handlers.get('vault_setAutoLock')!({ ms: 0, currentPassword: 'new-password' });
    assert.equal((await vault.listPasskeys()).length, 1);
    vault.lock();
    await assert.rejects(vault.changeProtection({ usePasskey: true, currentPassword: '', currentPasskey: input() }), /locked/);
    assert.equal(await vault.unlock(''), true);
    await vault.changeProtection({ usePasskey: true, currentPassword: '', currentPasskey: input() });
    assert.ok((await browser.storage.local.get('autoLockMs')).autoLockMs > 0);
  });

  it('keeps secrets out of storage, refuses passwords, unlocks with PRF after saving', async () => {
    await vault.create('', payload(), input());
    const stored = await record();
    assert.equal(stored.version, 2);
    assert.equal(stored.protection, 'passkey');
    assert.equal(stored.salt, undefined);
    assert.equal(JSON.stringify(stored).includes(input().prf), false);
    assert.equal(JSON.stringify(stored).includes('b'.repeat(64)), false);
    await vault.addAccount({ ...payload().accounts[0], id: 'second' });
    assert.deepEqual((await record()).passkeys, stored.passkeys);
    vault.lock();
    assert.equal(await vault.unlock(''), false);
    assert.equal(await vault.unlock('anypassword'), false);
    assert.equal(await vault.unlockPasskey(input(3)), false);
    assert.equal(await vault.unlockPasskey({ ...input(), prf: input(4).prf }), false);
    assert.equal(await vault.unlockPasskey(input()), true);
    assert.equal(vault.listAccounts().length, 2);
    await vault.withPrivkey('test', async bytes => assert.equal(bytes.length, 32));
  });

  it('rejects unsupported PRF, tampering and wrong credential bindings', async () => {
    assert.throws(() => validatePasskeyInput({ ...input(), prf: '' }));
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapVaultKey(bytes, input());
    assert.deepEqual(await unwrapVaultKey(wrapped, input()), bytes);
    await assert.rejects(unwrapVaultKey(wrapped, input(4)));
    await assert.rejects(unwrapVaultKey({ ...wrapped, prfSalt: input(4).prfSalt }, input()));
    await vault.create('', payload(), input());
    const saved = await record();
    saved.ciphertext = arrayToBase64(new Uint8Array(32));
    await browser.storage.local.set({ keyVault: saved });
    vault.lock();
    assert.equal(await vault.unlockPasskey(input()), false);
    assert.equal(vault.isLocked(), true);
  });

  it('adds an independent credential without changing identity and restores using that credential', async () => {
    await vault.create('', payload(), input());
    await vault.addPasskey(input(), input(5));
    assert.equal((await vault.listPasskeys()).length, 2);
    await assert.rejects(vault.addPasskey(input(), input(5)), /already added/);
    const backup = await vault.exportPasskeyBackup();
    assert.equal(parsePasskeyBackup(backup).passkeys.length, 2);
    await assert.rejects(vault.restorePasskeyBackup(backup, input()), /already exists/);
    await vault.destroy();
    await assert.rejects(vault.restorePasskeyBackup(backup, input(7)));
    assert.equal(await vault.exists(), false);
    await vault.restorePasskeyBackup(backup, input(5));
    assert.equal(vault.getActivePubkey(), 'a'.repeat(64));
    vault.lock();
    assert.equal(await vault.unlockPasskey(input()), true);
  });

  it('keeps password vaults compatible and cannot silently downgrade passkey protection', async () => {
    await vault.create('password123', payload());
    assert.equal(await vault.getPasskey(), null);
    vault.lock();
    assert.equal(await vault.unlock('password123'), true);
    await vault.destroy();
    await vault.create('', payload(), input());
    await assert.rejects(vault.reEncrypt('password456'), /do not use a password/);
    await assert.rejects(handlers.get('vault_setAutoLock')!({ ms: 0 }), /automatic locking/);
    await browser.storage.local.set({ autoLockMs: 0 });
    await vault.restoreAutoLockSetting();
    await handlers.get('vault_setAutoLock')!({ ms: 60000, password: 'password456' });
    assert.equal((await record()).protection, 'passkey');
    await assert.rejects(vault.create('', payload(), input(4)), /already exists/);
  });

  it('fails closed on malformed backup or a locked export', async () => {
    assert.throws(() => parsePasskeyBackup('{}'));
    assert.throws(() => parsePasskeyBackup('x'.repeat(16 * 1024 * 1024 + 1)));
    await vault.create('', payload(), input());
    const backup = JSON.parse(await vault.exportPasskeyBackup());
    backup.vault.rpId = 'example.com';
    assert.throws(() => parsePasskeyBackup(JSON.stringify(backup)));
    vault.lock();
    await assert.rejects(vault.exportPasskeyBackup(), /locked/);
  });

  it('uses the same file-size limit for export and import', async () => {
    await vault.create('', payload(), input());
    const saved = await record();
    saved.ciphertext = arrayToBase64(new Uint8Array(13 * 1024 * 1024));
    await browser.storage.local.set({ keyVault: saved });
    await assert.rejects(vault.exportPasskeyBackup(), /size limit/);
  });

  it('only deletes a vault whose decrypted contents prove it is empty', async () => {
    await vault.create('', payload(), input());
    await browser.storage.local.set({ accounts: [] });
    assert.equal(await vault.destroyIfEmpty(), false);
    vault.lock();
    assert.equal(await vault.destroyIfEmpty(), false);
    await vault.unlockPasskey(input());
    await vault.removeAccount('test');
    const backup = await record();
    vault.lock();
    assert.equal(await vault.destroyIfEmpty(), false);
    assert.deepEqual(await record(), backup);
    await vault.unlockPasskey(input());
    assert.equal(await vault.destroyIfEmpty(), true);
    assert.equal(await vault.exists(), false);
  });

  it('can replace an unlocked empty vault after the last account is removed', async () => {
    await vault.create('password123', payload());
    await vault.removeAccount('test');
    await vault.create('', payload(), input());
    assert.equal((await record()).protection, 'passkey');
  });

  it('restores after removing the last account, including after a lock, without losing data on failure', async () => {
    await vault.create('', payload(), input());
    const backup = await vault.exportPasskeyBackup();
    await vault.removeAccount('test');
    await browser.storage.local.set({ accounts: [], activeAccountId: null });
    const empty = await record();
    await assert.rejects(vault.restorePasskeyBackup(backup, input(7)));
    assert.deepEqual(await record(), empty);
    await vault.restorePasskeyBackup(backup, input());
    assert.equal(vault.getActivePubkey(), 'a'.repeat(64));
    await vault.removeAccount('test');
    await browser.storage.local.set({ accounts: [], activeAccountId: null });
    vault.lock();
    await vault.restorePasskeyBackup(backup, input());
    assert.equal(vault.getActivePubkey(), 'a'.repeat(64));
    vault.lock();
    await browser.storage.local.set({ accounts: [], activeAccountId: null });
    await assert.rejects(vault.restorePasskeyBackup(backup, input()), /already exists/);
  });

  it('removal information distinguishes independent seeds, main and derived accounts', async () => {
    const account = { ...payload().accounts[0], type: 'generated' as const, mnemonic: 'synthetic shared seed', derivationIndex: 0 };
    await vault.create('', { accounts: [account], activeAccountId: account.id }, input());
    assert.equal(vault.getAccountRemovalInfo(account.id).warning, 'account.removeOnlySeed');
    await vault.addAccount({ ...account, id: 'child', derivationIndex: 1 });
    await vault.addAccount({ ...account, id: 'other', mnemonic: 'different seed' });
    assert.deepEqual(vault.getAccountRemovalInfo(account.id), { warning: 'account.removeMainSeed', relatedCount: 1 });
    assert.equal(vault.getAccountRemovalInfo('child').warning, 'account.removeDerivedSeed');
    assert.equal(vault.getAccountRemovalInfo('other').warning, 'account.removeOnlySeed');
    await vault.removeAccount(account.id);
    assert.equal(vault.getAccountRemovalInfo('child').warning, 'account.removeOnlySeed');
    await vault.addAccount({ ...account, id: 'sibling', derivationIndex: 2 });
    assert.equal(vault.getAccountRemovalInfo('child').warning, 'account.removeSiblingSeed');
    vault.lock();
    assert.throws(() => vault.getAccountRemovalInfo('child'), /locked/);
  });

  it('reset clears onboarding state so recovery can start from the method screen', async () => {
    await vault.create('', payload(), input());
    await browser.storage.session.set({ wizardState: { step: 'passkeyBackup' }, wizardCreateData: { account: 'old' } });
    await handlers.get('vault_destroy')!({});
    const session = await browser.storage.session.get(['wizardState', 'wizardCreateData']);
    assert.equal(session.wizardState, undefined);
    assert.equal(session.wizardCreateData, undefined);
  });

  it('a concurrent lock wins over a pending passkey unlock', async () => {
    await vault.create('', payload(), input());
    vault.lock();
    const original = browser.storage.local.get;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const gate = new Promise<void>(r => { release = r; });
    browser.storage.local.get = async (...args) => { const result = await original(...args); entered(); await gate; return result; };
    try {
      const unlocking = vault.unlockPasskey(input());
      await started; vault.lock(); release();
      assert.equal(await unlocking, false);
      assert.equal(vault.isLocked(), true);
    } finally { release(); browser.storage.local.get = original; }
  });

  it('onboarding never returns the seed for the passkey path and can retry invalid enrollment', async () => {
    const generated = await onboarding.get('onboarding_generateAccount')!({ hideMnemonic: true }) as any;
    assert.ok(generated.account.pubkey);
    assert.equal(generated.mnemonic, undefined);
    assert.equal(generated.account.privkey, undefined);
    await assert.rejects(onboarding.get('onboarding_createVault')!({ account: generated.account, passkey: { ...input(), prf: '' } }));
    assert.equal(await vault.exists(), false);
    await onboarding.get('onboarding_createVault')!({ account: generated.account, passkey: input(), autoLockMinutes: 15 });
    assert.equal(vault.getActivePubkey(), generated.account.pubkey);
    assert.deepEqual(await onboarding.get('onboarding_checkExistingSeed')!({}), { hasSeed: true });
    vault.lock();
    assert.deepEqual(await onboarding.get('onboarding_checkExistingSeed')!({}), { hasSeed: true });
    await assert.rejects(onboarding.get('onboarding_generateSubAccount')!({}), /locked/i);
    assert.equal(await handlers.get('vault_unlockPasskey')!({ ...input() }), true);
    const sub = await onboarding.get('onboarding_generateSubAccount')!({}) as any;
    assert.equal(sub.derivationIndex, 1);
    assert.notEqual(sub.account.pubkey, generated.account.pubkey);
    assert.equal(sub.account.mnemonic, undefined);
    await onboarding.get('onboarding_addToVault')!({ account: sub.account });
    assert.equal(vault.listAccounts().length, 2);
  });
});

it('passkey recovery account selection prefers the active local signer and excludes remote/read-only identities', () => {
  const account = (id: string, type: SafeAccount['type'], readOnly = false): SafeAccount => ({ id, pubkey: id, name: id, type, readOnly, createdAt: 0 });
  const seed = account('seed', 'generated'); const imported = account('key', 'nsec');
  const remote = account('remote', 'nip46'); const watch = account('watch', 'npub', true);
  assert.equal(passkeyRecoveryAccount([remote, watch, seed, imported], 'key'), imported);
  assert.equal(passkeyRecoveryAccount([remote, watch, seed, imported], 'remote'), seed);
  assert.equal(passkeyRecoveryAccount([remote, watch, account('readonly', 'generated', true)], 'readonly'), undefined);
  assert.equal(passkeyRecoveryAccount([], ''), undefined);
});



describe('passkey display names', () => {
  beforeEach(() => { vault.lock(); resetMockStorage(); });
  afterEach(() => vault.lock());
  it('renames without changing encryption, persists across unlock, and clears to default', async () => {
    await vault.create('', payload(), input());
    const before = await record();
    await handlers.get('vault_renamePasskey')!({ credentialId: input().credentialId, name: '  Hardware key  ' });
    assert.equal((await vault.listPasskeys())[0].name, 'Hardware key');
    assert.equal((await record()).passkeys[0].ciphertext, before.passkeys[0].ciphertext);
    assert.equal(passkeyDisplayName((await vault.listPasskeys())[0], 0, 'Passkey'), 'Hardware key');
    vault.lock();
    await assert.rejects(vault.renamePasskey(input().credentialId, 'No'), /locked/);
    assert.equal(await vault.unlockPasskey(input()), true);
    assert.equal(parsePasskeyBackup(await vault.exportPasskeyBackup()).passkeys[0].name, 'Hardware key');
    await assert.rejects(vault.renamePasskey('unknown', 'No'), /belong/);
    await assert.rejects(vault.renamePasskey(input().credentialId, 'x'.repeat(81)), /Invalid/);
    await vault.renamePasskey(input().credentialId, '');
    assert.equal(passkeyDisplayName((await vault.listPasskeys())[0], 0, 'Passkey'), 'Passkey 1');
  });
  it('requires credential verification before explicitly disabling locking and preserves enrollment', async () => {
    await vault.create('', payload(), input());
    await assert.rejects(vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: '' }), /at least/);
    assert.equal(await vault.changeProtection({ usePasskey: false, currentPasskey: input(9), password: '', autoLockMs: 0 }), false);
    assert.equal(await vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: '', autoLockMs: 0 }), true);
    assert.equal(await vault.getPasskey(), null);
    assert.equal((await vault.listPasskeys()).length, 1);
    assert.equal((await browser.storage.local.get('autoLockMs')).autoLockMs, 0);
    vault.lock();
    assert.equal(await vault.unlock(''), true);
    assert.equal(vault.getActivePubkey(), payload().accounts[0].pubkey);
  });
  it('renames dormant credentials without changing password protection', async () => {
    await vault.create('', payload(), input());
    await vault.changeProtection({ usePasskey: false, currentPasskey: input(), password: 'test-password' });
    await vault.renamePasskey(input().credentialId, 'Laptop');
    assert.equal(await vault.getPasskey(), null);
    assert.equal((await vault.listPasskeys())[0].name, 'Laptop');
    vault.lock();
    assert.equal(await vault.unlock('test-password'), true);
  });
});
