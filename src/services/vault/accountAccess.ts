import type { MemoryVaultPayload } from '@domain/vault/types.ts';
import type { VaultPayload } from '@domain/vault/types.ts';
import type { Account, SafeAccount, SafeAccountWithWallet, BackgroundRemoteSignerAccount } from '@domain/accounts/types.ts';
import { toSafeAccount } from '@domain/accounts/account.ts';
import { toMemoryAccount, toStoragePayload } from './serialization.ts';

/** Operations access the live private session through injected capabilities. */
export function createAccountAccess(readPayload: () => MemoryVaultPayload | null, save: () => Promise<void>, resetAutoLock: () => void, invalidateSession: () => void) {

  /**
   * Get the active account's pubkey from the unlocked session
   */
  function getActivePubkey(): string | null {
    const _decrypted = readPayload();
    if (!_decrypted) return null;
    const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
    return acct?.pubkey || null;
  }

  /**
   * Get the active account ID
   */
  function getActiveAccountId(): string | null {
    const _decrypted = readPayload();
    return _decrypted?.activeAccountId || null;
  }

  /**
   * Get the active account
   */
  function getActiveAccount(): SafeAccount | null {
    const _decrypted = readPayload();
    if (!_decrypted) return null;
    const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
    if (!acct) return null;
    return toSafeAccount(acct);
  }

  /**
   * Background-only wallet capability; never exposes remote signer credentials.
   * The returned config is detached from the private session.
   */
  function getActiveAccountWithWallet(): SafeAccountWithWallet | null {
    const _decrypted = readPayload();
    if (!_decrypted) return null;
    const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
    if (!acct) return null;
    return { ...toSafeAccount(acct), ...(acct.walletConfig ? { walletConfig: structuredClone(acct.walletConfig) } : {}) };
  }

  /**
   * Get a deep copy of the decrypted vault payload
   * @throws {Error} if vault is locked
   */
  function getDecryptedPayload(): VaultPayload {
    const _decrypted = readPayload();
      if (!_decrypted) throw new Error('Vault is locked');
      return toStoragePayload(_decrypted);
  }

  /**
   * Get the private key bytes for a specific account
   * CALLER MUST ZERO THE RETURNED ARRAY AFTER USE
   * @param accountId - defaults to active account
   * @returns 32-byte private key
   */
  function getPrivkey(accountId?: string): Uint8Array | null {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    resetAutoLock();

    const id = accountId || _decrypted.activeAccountId;
    const acct = _decrypted.accounts.find(a => a.id === id);
    if (!acct || !acct.privkeyBytes) return null;

    // Return a copy so caller's fill(0) doesn't affect vault
    return new Uint8Array(acct.privkeyBytes);
  }

  /**
   * Run `fn` with the account's private key and zero it afterwards, on every path.
   *
   * `getPrivkey()` hands out a copy and documents "CALLER MUST ZERO", which makes the
   * guarantee only as good as each call site's memory — and at least one call site had
   * already forgotten it. Prefer this wrapper: the zeroing is not the caller's job any
   * more, and an early return or a throw cannot skip it.
   *
   * @param accountId - defaults to the active account
   * @param fn - receives the key; it is zeroed as soon as this settles
   */
  async function withPrivkey<T>(
    accountId: string | undefined,
    fn: (privkey: Uint8Array) => Promise<T>,
  ): Promise<T> {
    const privkey = getPrivkey(accountId);
    if (!privkey) throw new Error('No private key for this account');
    try {
      return await fn(privkey);
    } finally {
      privkey.fill(0);
    }
  }

  /**
   * Get public account metadata by ID; credentials are never included.
   */
  function getAccountById(accountId: string): SafeAccount | null {
    const _decrypted = readPayload();
    if (!_decrypted || !accountId) return null;
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct) return null;
    return toSafeAccount(acct);
  }

  /** Background-only remote signer credentials; never expose through UI/page RPCs. */
  function getAccountForRemoteSigning(accountId: string): BackgroundRemoteSignerAccount | null {
    const account = readPayload()?.accounts.find(a => a.id === accountId);
    if (!account || account.type !== 'nip46' || !account.nip46Config) return null;
    const config = account.nip46Config;
    return {
      ...toSafeAccount(account),
      nip46Config: {
        bunkerUrl: config.bunkerUrl,
        relay: config.relay,
        secret: config.secret,
        ...(config.localPrivkey !== undefined ? { localPrivkey: config.localPrivkey } : {}),
        ...(config.localPubkey !== undefined ? { localPubkey: config.localPubkey } : {}),
      },
    };
  }

  /**
   * Get all accounts (public metadata only, no keys)
   */
  function listAccounts(): Array<{ id: string; name: string; type: string; pubkey: string; readOnly: boolean; createdAt: number }> {
    const _decrypted = readPayload();
    if (!_decrypted) return [];
    return _decrypted.accounts.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      pubkey: a.pubkey,
      readOnly: a.readOnly || !a.privkeyBytes,
      createdAt: a.createdAt
    }));
  }

  /**
   * Add an account to the vault
   * @param account
   */
  async function addAccount(account: Account): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    if (_decrypted.accounts.some(a => a.id === account.id)) {
      throw new Error('Account already exists in vault');
    }
    _decrypted.accounts.push(toMemoryAccount(account));
    await save();
  }

  /**
   * Remove an account from the vault
   * @param accountId
   */
  async function removeAccount(accountId: string): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    invalidateSession();
    _decrypted.accounts = _decrypted.accounts.filter(a => a.id !== accountId);
    if (_decrypted.activeAccountId === accountId) {
      _decrypted.activeAccountId = _decrypted.accounts[0]?.id || null;
    }
    await save();
  }

  /**
   * Set the active account
   * @param accountId
   */
  async function setActiveAccount(accountId: string): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct) throw new Error('Account not found');
    if (_decrypted.activeAccountId !== accountId) invalidateSession();
    _decrypted.activeAccountId = accountId;
    await save();
  }

  /**
   * Clear the vault's in-memory active account so getActiveAccount() returns null.
   * Used when switching to an account not in the vault (read-only/npub).
   * Does NOT persist -- vault re-reads on next unlock.
   */
  function clearActiveAccount(): void {
    const _decrypted = readPayload();
    if (_decrypted) {
      if (_decrypted.activeAccountId !== null) invalidateSession();
      _decrypted.activeAccountId = null;
    }
  }

  /**
   * Update the NIP-46 ephemeral keypair for an account (persists to vault).
   * Called after first NIP-46 connect to store the generated keypair so
   * reconnects after service worker restart use the same identity.
   */
  async function updateAccountNip46Keys(accountId: string, localPrivkey: string, localPubkey: string): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct || !acct.nip46Config) throw new Error('Account not found or not NIP-46');
    acct.nip46Config = { ...acct.nip46Config, localPrivkey, localPubkey };
    await save();
  }

  /**
   * Update the wallet config for an account (persists to vault).
   * Pass null to remove wallet config.
   */
  async function updateAccountWalletConfig(
    accountId: string,
    walletConfig: Account['walletConfig'] | null,
  ): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct) throw new Error('Account not found');
    invalidateSession();
    if (walletConfig === null) {
      delete acct.walletConfig;
    } else {
      acct.walletConfig = walletConfig;
    }
    await save();
  }
  return { getActivePubkey, getActiveAccountId, getActiveAccount, getActiveAccountWithWallet, getDecryptedPayload, getPrivkey, withPrivkey, getAccountById, getAccountForRemoteSigning, listAccounts, addAccount, removeAccount, setActiveAccount, clearActiveAccount, updateAccountNip46Keys, updateAccountWalletConfig };
}
