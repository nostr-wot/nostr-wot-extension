# Storage Layer

The extension stores vaults, settings and account metadata through `browser.storage`. Experimental WoT uses a dedicated IndexedDB database, `nostr-wot-graphs-v1`, for public graph snapshots and shared verified follow/relay lists. The retired legacy graph engine is not reused.

| Area | Backing store | Notes |
|------|---------------|-------|
| Experimental WoT graph snapshots and public-list cache | IndexedDB | Packed numeric references; separate snapshot and shared-list stores |
| Experimental WoT settings, progress, inventory and snapshot summary pointers | `browser.storage.local` | Account-scoped graph pointers; small metadata only |
| Encrypted vault (keys, mnemonics, imported post-quantum keys, wallet configs) | `browser.storage.local` (`keyVault`) | AES-256-GCM + PBKDF2, see [Security](security.md) |
| Config (`myPubkey`, `relays`) | `browser.storage.sync` | Synced across the user's browsers |
| Accounts list, active account, domain allowlists, profile cache | `browser.storage.local` | Plaintext metadata (no secrets) |
| NostrConnect session mirrors, pending onboarding | `browser.storage.session` | Ephemeral; cleared when the browser closes — **except on Safari**, see below |

### The `keyVault` record

```ts
{ version: 1, iterations: 600000, salt: "<base64>", iv: "<base64>", ciphertext: "<base64>" }
```

`iterations` records the PBKDF2 work factor the record was written with, so raising the default does not lock anyone out: a record without the field predates the change, is read back at 210,000, and is re-encrypted at the current count on the next successful unlock. See [Security](security.md).

### `storage.session` is not ephemeral on Safari

Safari has no `storage.session`, so `src/lib/browser.ts` shims it onto `storage.local` behind a `__session__` prefix — which means anything written there is **on disk** and survives a browser restart. Two consequences the code has to handle rather than assume away:

- Pending-onboarding secrets (`privkey`, `mnemonic`, `nip46Config.localPrivkey`) are XOR-split across `_pendingOnboardingSecrets` + `_pendingOnboardingSecretsPad`, never written in the clear, and the account stored beside them has all three fields nulled.
- The 5-minute TTL is enforced on read, and `background.ts` additionally sweeps an expired record at startup (`cleanupExpiredPendingOnboarding`) so an abandoned onboarding is not left at rest indefinitely waiting for a read that may never come. A record still inside its TTL is left alone, since on Chrome the service worker restarts constantly during a live onboarding.

---

## Wallet Storage

### Wallet Configuration (Encrypted)

Wallet credentials are stored as `walletConfig` inside the `Account` object, which is encrypted inside the vault (`keyVault` in `browser.storage.local`). This means wallet configs are protected by the same AES-256-GCM + PBKDF2 encryption as private keys and mnemonics.

```ts
// Part of Account in src/domain/accounts/types.ts
walletConfig?: WalletConfig;

// WalletConfig is a discriminated union:
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string; nwcUri?: string };
```

### Auto-Approve Threshold (`browser.storage.local`)

| Key | Value | Purpose |
|-----|-------|---------|
| `walletThreshold_{accountId}` | `number` (sats) | Per-account payment auto-approve threshold. Payments at or below this amount skip the approval prompt. Default: `0` (all payments require approval). |

Managed by privileged methods `wallet_setAutoApproveThreshold` and `wallet_getAutoApproveThreshold`.

## Experimental WoT snapshots

`src/services/wot/snapshots.ts` commits the large payload before publishing its summary pointer and serializes mutations. Failed writes retain the prior completed snapshot; abandoned generations are cleaned up. Legacy experimental local-storage snapshots migrate when read. Account identity must match the snapshot root before queries use it.

The settings database table exposes estimated payload sizes and resync/delete actions per account. Deleting the shared public-list cache preserves snapshots; deleting a snapshot preserves identity keys and accounts. Removal is blocked while sync is running. Disabling WoT preserves stored graphs. Private decrypted mute entries are not saved in either graph store. See [WoT storage and sync](wot.md).
