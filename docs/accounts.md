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

| Type | Source | Can Sign | Vault Entry | Post-quantum keys |
|------|--------|----------|-------------|-------------------|
| `generated` | BIP-39 mnemonic via NIP-06 (`m/44'/1237'/0'/0/0`) | Yes | privkey + mnemonic | Derived from the seed (24 words); a 12-word account may import instead |
| `nsec` | Imported nsec or hex private key | Yes | privkey | Import only — no mnemonic to derive from |
| `npub` | Imported npub or hex public key | No | pubkey only | None; cannot sign an attestation or take part in the hybrid key agreement |
| `nip46` | NIP-46 bunker URL (remote signer) | Yes (remote) | nip46Config | None; nip44 routes to the bunker, which does not know the envelope |
| `external` | Another NIP-07 extension | Yes (delegated) | pubkey only | None |

Imported keys live in `Account.pqKeys` inside the encrypted vault. They are the one thing in the extension the seed phrase cannot restore, so they must be backed up separately — see [Security](security.md) and [Cryptography](crypto.md).

---

## 3. Account ID Generation

Account IDs are generated as 12-character random hex strings:

```js
const arr = crypto.getRandomValues(new Uint8Array(6));
return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
```

---

## 4. Account Switching

When the active account changes (`switchAccount` handler in `src/services/background/vault-handlers.ts`):

1. `vault.setActiveAccount(accountId)` -- update vault's active account pointer (or `clearActiveAccount()` for read-only accounts not in vault)
2. Update `config.myPubkey` and `browser.storage.sync.myPubkey` -- canonical pubkey source for signer
3. Update `browser.storage.local.activeAccountId`
4. **`signer.rejectPendingForAccount(oldAccountId)`** -- reject all pending signing requests for the old account to prevent signing with the wrong key
5. `broadcastAccountChanged(pubkey)` -- notify all tabs about the change

Accounts no longer carry a per-account database; identity state lives entirely in the vault and `browser.storage`.

---

## 6. Read-Only Account Behavior

For accounts without private keys (`npub`, some `external`), the `vault_getActiveAccountType` handler tries the vault first, then falls back to the local `accounts` array -- enabling type detection even without an unlocked vault.

## Import input helpers

`src/domain/accounts/importInput.ts` owns `ImportType` and `detectImportType`, shared format detection for import routing and hints. Detection accepts encrypted/private-key prefixes, 64-character hex and 12/24-word candidates; it does not validate checksums or the BIP-39 wordlist. Account creation and decryption retain those checks. `src/utils/text.ts` provides generic whitespace-aware `countWords`, reused by the import UI, vault seed export and post-quantum seed-length checks. Format constants live in `src/constants/accounts.ts`.

## Account setup and public previews

Nostr Connect offers QR Code and Bunker URL tabs with shared spacing before their content. The NIP-46 identity's signing key remains with the remote signer; returned signed events are checked against the approved request.

When a recovery phrase already exists, Create New opens New Sub-Account. The proposed name is editable. Public npub and hex values appear below their labels in accent color, abbreviated in the middle; each copy icon copies the complete value. Advanced appears below the keys as a marker-free accent control and expands the derivation-path editor with a gap before its fields. There is no redundant Seed account row. Changing the path invalidates the preview until a fresh result arrives; see [custom identity paths](https://nostr-wot.com/en/guides/custom-identity-paths).

Follow suggestions load through `usePublicProfile` and compact `ProfileSummary`. Fresh public metadata is reused; missing profiles use verified kind:0 lookup through `wss://purplepag.es`. The shared cache lasts 30 minutes and retains at most 500 entries. An unavailable profile uses the shortened key and an initial. Directory requests contain the public author key, not private keys or messages; profile pictures load separately from safe HTTP(S) URLs. Loading never blocks selecting people or Skip for now.

The completion screen aligns its summary and Get Started action at the bottom. It shows the account name and a shortened, copyable public key without a metadata table. Only the sub-account creation flow describes derivation from the main seed phrase. Setup can use global rules or copy another account's site overrides; authentication grants remain separate. See [signer permissions](signer.md#5-permission-cascade----srcservicespermissionspermissionsts).
