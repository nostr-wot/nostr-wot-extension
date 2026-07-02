# Account System

## 1. Registry

Accounts are stored in two locations:

| Storage | Key | Contents |
|---------|-----|----------|
| `browser.storage.local` | `accounts` | Array of `{ id, name, pubkey, type, readOnly }` -- public metadata, always accessible |
| `browser.storage.local` | `keyVault` | Encrypted vault containing full account objects (with `privkey`, `mnemonic`) |
| `browser.storage.local` | `activeAccountId` | Currently selected account ID |

The local `accounts` array enables UI rendering even when the vault is locked. The vault holds the authoritative account data including secrets.

---

## 2. Account Types

| Type | Source | Can Sign | Vault Entry |
|------|--------|----------|-------------|
| `generated` | BIP-39 mnemonic via NIP-06 (`m/44'/1237'/0'/0/0`) | Yes | privkey + mnemonic |
| `nsec` | Imported nsec or hex private key | Yes | privkey |
| `npub` | Imported npub or hex public key | No | pubkey only |
| `nip46` | NIP-46 bunker URL (remote signer) | Yes (remote) | nip46Config |
| `external` | Another NIP-07 extension | Yes (delegated) | pubkey only |

---

## 3. Account ID Generation

Account IDs are generated as 12-character random hex strings:

```js
const arr = crypto.getRandomValues(new Uint8Array(6));
return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
```

---

## 4. Account Switching

When the active account changes (`switchAccount` handler in `lib/bg/vault-handlers.ts`):

1. `vault.setActiveAccount(accountId)` -- update vault's active account pointer (or `clearActiveAccount()` for read-only accounts not in vault)
2. Update `config.myPubkey` and `browser.storage.sync.myPubkey` -- canonical pubkey source for signer
3. Update `browser.storage.local.activeAccountId`
4. **`signer.rejectPendingForAccount(oldAccountId)`** -- reject all pending signing requests for the old account to prevent signing with the wrong key
5. `broadcastAccountChanged(pubkey)` -- notify all tabs about the change

Accounts no longer carry a per-account database; identity state lives entirely in the vault and `browser.storage`.

---

## 6. Read-Only Account Behavior

For accounts without private keys (`npub`, some `external`), the `vault_getActiveAccountType` handler tries the vault first, then falls back to the local `accounts` array -- enabling type detection even without an unlocked vault.
