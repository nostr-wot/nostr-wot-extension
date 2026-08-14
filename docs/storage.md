# Storage Layer

The extension persists state through `browser.storage` (the WebExtension storage
API), not a custom database. There is **no IndexedDB layer** anymore — the
former `lib/storage.ts` (an IndexedDB follow-graph / relay-list engine left over
from the removed Web-of-Trust subsystem) has been deleted. It held no live data:
nothing wrote to it after the trust-graph sync was removed.

Persisted state lives in three places:

| Area | Backing store | Notes |
|------|---------------|-------|
| Encrypted vault (keys, mnemonics, wallet configs) | `browser.storage.local` (`keyVault`) | AES-256-GCM + PBKDF2, see [Security](security.md) |
| Config (`myPubkey`, `relays`) | `browser.storage.sync` | Synced across the user's browsers |
| Accounts list, active account, domain allowlists, profile cache | `browser.storage.local` | Plaintext metadata (no secrets) |
| NostrConnect session mirrors, pending onboarding | `browser.storage.session` | Ephemeral; cleared when the browser closes — **except on Safari**, see below |

### The `keyVault` record

```ts
{ version: 1, iterations: 600000, salt: "<base64>", iv: "<base64>", ciphertext: "<base64>" }
```

`iterations` records the PBKDF2 work factor the record was written with, so raising the default does not lock anyone out: a record without the field predates the change, is read back at 210,000, and is re-encrypted at the current count on the next successful unlock. See [Security](security.md).

### `storage.session` is not ephemeral on Safari

Safari has no `storage.session`, so `lib/browser.ts` shims it onto `storage.local` behind a `__session__` prefix — which means anything written there is **on disk** and survives a browser restart. Two consequences the code has to handle rather than assume away:

- Pending-onboarding secrets (`privkey`, `mnemonic`, `nip46Config.localPrivkey`) are XOR-split across `_pendingOnboardingSecrets` + `_pendingOnboardingSecretsPad`, never written in the clear, and the account stored beside them has all three fields nulled.
- The 5-minute TTL is enforced on read, and `background.ts` additionally sweeps an expired record at startup (`cleanupExpiredPendingOnboarding`) so an abandoned onboarding is not left at rest indefinitely waiting for a read that may never come. A record still inside its TTL is left alone, since on Chrome the service worker restarts constantly during a live onboarding.

---

## Wallet Storage

### Wallet Configuration (Encrypted)

Wallet credentials are stored as `walletConfig` inside the `Account` object, which is encrypted inside the vault (`keyVault` in `browser.storage.local`). This means wallet configs are protected by the same AES-256-GCM + PBKDF2 encryption as private keys and mnemonics.

```ts
// Part of Account in lib/types.ts
walletConfig?: WalletConfig;

// WalletConfig is a discriminated union:
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string };
```

### Auto-Approve Threshold (`browser.storage.local`)

| Key | Value | Purpose |
|-----|-------|---------|
| `walletThreshold_{accountId}` | `number` (sats) | Per-account payment auto-approve threshold. Payments at or below this amount skip the approval prompt. Default: `0` (all payments require approval). |

Managed by privileged methods `wallet_setAutoApproveThreshold` and `wallet_getAutoApproveThreshold`.
