import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import type { VaultPayload } from '../src/domain/vault/types.ts';
import type { Account, SafeAccount } from '../src/domain/accounts/types.ts';
import type { WalletConfig } from '../src/domain/wallet/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';

const LNBITS_CONFIG: WalletConfig = {
  type: 'lnbits',
  instanceUrl: 'https://legend.lnbits.com',
  adminKey: 'deadbeef1234567890abcdef',
  walletId: 'wallet-1',
};

const NWC_CONFIG: WalletConfig = {
  type: 'nwc',
  connectionString: 'nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex',
  relay: 'wss://relay.example.com',
};

function makeAccount(overrides?: Partial<Account>): Account {
  return {
    id: 'acct1',
    name: 'Test',
    type: 'nsec',
    pubkey: TEST_PUBKEY_HEX,
    privkey: TEST_PRIVKEY_HEX,
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: 1000000,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<Account>): VaultPayload {
  return {
    accounts: [makeAccount(overrides)],
    activeAccountId: 'acct1',
  };
}

describe('vault -- wallet config storage', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('stores and retrieves account with lnbits wallet config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.ok(acct);
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
  });

  it('stores and retrieves account with nwc wallet config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.ok(acct);
    assert.deepStrictEqual(acct!.walletConfig, NWC_CONFIG);
  });

  it('updateAccountWalletConfig persists config across lock/unlock', async () => {
    await vault.create(TEST_PASSWORD, makePayload());

    // Initially no wallet config
    let decrypted = vault.getDecryptedPayload();
    let acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);

    // Add wallet config
    await vault.updateAccountWalletConfig('acct1', LNBITS_CONFIG);

    // Verify in-memory
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);

    // Lock and re-unlock to verify persistence
    vault.lock();
    await vault.unlock(TEST_PASSWORD);
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
  });

  it('updateAccountWalletConfig with null removes config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));

    // Confirm it exists
    let decrypted = vault.getDecryptedPayload();
    let acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, NWC_CONFIG);

    // Remove it
    await vault.updateAccountWalletConfig('acct1', null);

    // Verify in-memory
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);

    // Verify persistence
    vault.lock();
    await vault.unlock(TEST_PASSWORD);
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);
  });

  it('listAccounts strips walletConfig', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const accounts = vault.listAccounts();
    assert.strictEqual(accounts.length, 1);
    // listAccounts only picks id, name, type, pubkey, readOnly, createdAt
    assert.strictEqual((accounts[0] as Record<string, unknown>).walletConfig, undefined);
    assert.strictEqual(accounts[0].id, 'acct1');
  });

  it('updateAccountWalletConfig throws when vault is locked', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    await assert.rejects(
      () => vault.updateAccountWalletConfig('acct1', LNBITS_CONFIG),
      /Vault is locked/
    );
  });

  it('updateAccountWalletConfig throws for nonexistent account', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await assert.rejects(
      () => vault.updateAccountWalletConfig('nonexistent', LNBITS_CONFIG),
      /Account not found/
    );
  });

  it('getActiveAccountWithWallet returns account with walletConfig', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct);
    assert.strictEqual(acct!.id, 'acct1');
    assert.strictEqual(acct!.pubkey, TEST_PUBKEY_HEX);
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
    // Should NOT have privkeyBytes or mnemonicBytes
    assert.strictEqual((acct as Record<string, unknown>).privkeyBytes, undefined);
    assert.strictEqual((acct as Record<string, unknown>).mnemonicBytes, undefined);
    // Should NOT have privkey or mnemonic
    assert.strictEqual((acct as Record<string, unknown>).privkey, undefined);
    assert.strictEqual((acct as Record<string, unknown>).mnemonic, undefined);
  });

  it('getActiveAccountWithWallet returns null when locked', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));
    vault.lock();
    const acct = vault.getActiveAccountWithWallet();
    assert.strictEqual(acct, null);
  });

  it('getActiveAccountWithWallet returns account without walletConfig when not set', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct);
    assert.strictEqual(acct!.walletConfig, undefined);
  });
});

describe('vault -- explicit public account boundary', () => {
  beforeEach(() => { resetMockStorage(); vault.lock(); });

  it('safe accessors return only public metadata even with every nested credential present', async () => {
    await vault.create(TEST_PASSWORD, makePayload({
      type: 'nip46',
      mnemonic: 'synthetic secret seed words',
      derivationIndex: 2,
      derivationPath: "m/44'/1237'/2'/0/0",
      nip46Config: { bunkerUrl: 'bunker://remote?secret=bunker-secret', relay: 'wss://relay.example', secret: 'bunker-secret', localPrivkey: '22'.repeat(32) },
      walletConfig: LNBITS_CONFIG,
      pqKeys: { profile: 'test', kem: { public: 'public', secret: 'c2VjcmV0' }, dsa: { public: 'public', secret: 'c2VjcmV0' }, importedAt: 1 },
      futureSecret: { nested: 'must never escape' },
    } as Partial<Account>));
    const expected = {
      id: 'acct1', name: 'Test', type: 'nip46', pubkey: TEST_PUBKEY_HEX,
      readOnly: false, createdAt: 1000000, derivationIndex: 2,
      derivationPath: "m/44'/1237'/2'/0/0",
    };
    assert.deepEqual(vault.getActiveAccount(), expected);
    assert.deepEqual(vault.getAccountById('acct1'), expected);
    assert.deepEqual(vault.getActiveAccountWithWallet(), { ...expected, walletConfig: LNBITS_CONFIG });
    assert.deepEqual(vault.listAccounts(), [{ id: 'acct1', name: 'Test', type: 'nip46', pubkey: TEST_PUBKEY_HEX, readOnly: false, createdAt: 1000000 }]);
  });

  it('wallet credential access returns a detached copy and safe reads remain credential-free', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const account = vault.getActiveAccountWithWallet()!;
    assert.ok(account.walletConfig?.type === 'lnbits');
    const originalKey = account.walletConfig.adminKey;
    account.walletConfig.adminKey = 'modified';
    const reread = vault.getActiveAccountWithWallet()!.walletConfig;
    assert.ok(reread?.type === 'lnbits');
    assert.equal(reread.adminKey, originalKey);
    assert.equal('walletConfig' in vault.getActiveAccount()!, false);
  });
});

// A new secret-bearing field cannot silently become part of the public contract.
const publicTypeHasNoSecrets: Extract<keyof SafeAccount,
  'privkey' | 'mnemonic' | 'walletConfig' | 'nip46Config' | 'pqKeys'> extends never ? true : false = true;

describe('vault -- background remote signing capability', () => {
  beforeEach(() => { resetMockStorage(); vault.lock(); });

  it('returns detached NIP-46 credentials without wallet or unrelated secrets', async () => {
    assert.equal(publicTypeHasNoSecrets, true);
    const nip46Config = { bunkerUrl: 'bunker://remote?secret=credential', relay: 'wss://relay.example', secret: 'credential', localPrivkey: '22'.repeat(32), localPubkey: '33'.repeat(32) };
    await vault.create(TEST_PASSWORD, makePayload({ type: 'nip46', nip46Config, walletConfig: LNBITS_CONFIG }));
    const remote = vault.getAccountForRemoteSigning('acct1')!;
    assert.deepEqual(remote, { ...vault.getActiveAccount(), nip46Config });
    remote.nip46Config.localPrivkey = 'changed';
    assert.equal(vault.getAccountForRemoteSigning('acct1')!.nip46Config.localPrivkey, '22'.repeat(32));
    assert.equal(vault.getAccountForRemoteSigning('missing'), null);
    vault.lock();
    assert.equal(vault.getAccountForRemoteSigning('acct1'), null);
  });

  it('refuses non-remote accounts and missing remote configuration', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    assert.equal(vault.getAccountForRemoteSigning('acct1'), null);
    await vault.addAccount(makeAccount({ id: 'remote', type: 'nip46', nip46Config: null }));
    assert.equal(vault.getAccountForRemoteSigning('remote'), null);
  });
});

describe('onboarding -- public account response allowlist', () => {
  beforeEach(() => { resetMockStorage(); vault.lock(); });
  it('all import and generation responses use the public metadata boundary', async () => {
    const onboarding = await import('../src/services/background/onboarding-handlers.ts');
    const vaultHandlers = await import('../src/services/background/vault-handlers.ts');
    const { ncryptsecEncode } = await import('../src/lib/crypto/nip49.ts');
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const encrypted = await ncryptsecEncode(TEST_PRIVKEY_HEX, TEST_PASSWORD);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['onboarding_validateNsec', { input: TEST_PRIVKEY_HEX }],
      ['onboarding_validateNpub', { input: TEST_PUBKEY_HEX }],
      ['onboarding_validateMnemonic', { mnemonic }],
      ['onboarding_connectNip46', { bunkerUrl: `bunker://${TEST_PUBKEY_HEX}?relay=wss://relay.example&secret=private` }],
      ['onboarding_validateNcryptsec', { ncryptsec: encrypted, password: TEST_PASSWORD }],
      ['onboarding_generateAccount', {}],
      ['vault_importNcryptsec', { ncryptsec: encrypted, password: TEST_PASSWORD }],
    ];
    const publicKeys = ['id', 'name', 'type', 'pubkey', 'readOnly', 'createdAt', 'derivationIndex', 'derivationPath'];
    try {
      for (const [method, params] of cases) {
        resetMockStorage(); onboarding.__simulateServiceWorkerRestart();
        const handler = onboarding.handlers.get(method) || vaultHandlers.handlers.get(method)!;
        const response = await handler(params) as { account: Record<string, unknown>; mnemonic?: string };
        assert.ok(response.account.id, method);
        assert.deepEqual(Object.keys(response.account).filter(key => !publicKeys.includes(key)), [], method);
        if (method === 'onboarding_generateAccount') assert.equal(response.mnemonic?.split(' ').length, 24);
      }
    } finally { onboarding.__simulateServiceWorkerRestart(); }
  });
});
