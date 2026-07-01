# Storage Layer -- `lib/storage.ts`

`lib/storage.ts` is an IndexedDB layer that predates the removal of the Web-of-Trust
trust-graph subsystem. Most of its machinery (the pubkey/follows stores, delta
encoding, the in-memory graph cache, write buffering) was built for the follow
graph, which no longer exists. The only store that carries **live, meaningful
data today is `relay_lists`** — the cached NIP-65 relay lists used by
`getRelayList` / `getRelayPool`. The graph-era stores are still created for
backward compatibility but are no longer populated.

> The per-account trust-graph databases that older versions accumulated are
> silently deleted on startup (see [Architecture](architecture.md) §2.1).

---

## 1. Database Naming

- Per-account: `nostr-wot-{accountId}` (e.g., `nostr-wot-m7k3a9x2bc`)
- Legacy (pre-multi-account): `nostr-wot`

On startup, `migrateGlobalDatabase(accountId)` migrates data from the legacy
`nostr-wot` database to the active account's per-account database, then deletes
the legacy DB. `deleteDatabase(dbName)` removes a per-account DB entirely
(used both for account deletion and for the startup cleanup of stale trust-graph DBs).

---

## 2. Schema

IndexedDB version 3 with four object stores:

| Store | Key | Schema | Status |
|-------|-----|--------|--------|
| `relay_lists` | `id` (integer, pubkey ID) | `{ id: number, relays: RelayListEntry[] }` | **Live** — cached NIP-65 relay lists |
| `pubkeys` | `id` (auto-increment integer) | `{ id: number, pubkey: string }` | Live — maps pubkeys to the integer IDs used as keys in the other stores |
| `follows_v2` | `id` (integer, matching pubkey ID) | `{ id: number, follows: ArrayBuffer, updated_at: number }` | **Deprecated** — trust-graph store, no longer populated |
| `meta` | `key` (string) | `{ key: string, value: any }` | Deprecated — held graph sync metadata |

The v1 `follows` store (if present) is deleted during upgrade.

---

## 3. Pubkey ID Mapping

String pubkeys (64-char hex) are mapped to sequential integer IDs so the other
stores can key on a compact integer instead of a 64-char string:

- `pubkeyToId: Map<string, number>` -- forward lookup
- `idToPubkey: Map<number, string>` -- reverse lookup
- `nextId: number` -- monotonically increasing counter

All mappings are loaded into memory on `initDB()`. New IDs are assigned
synchronously via `getOrCreateId(pubkey)` and batched for disk persistence. The
`relay_lists` store keys on these IDs.

---

## 4. Relay-list Cache

Relay lists are cached in memory and buffered to disk:

```
relayListCache: Map<pubkeyId, RelayListEntry[]>
```

`loadRelayListCache()` loads the store into memory on `initDB()`. Reads hit the
cache; writes go to memory immediately and are flushed to the `relay_lists`
store via a write buffer (`RELAY_LIST_BUFFER_SIZE` = 100 entries).

---

## 5. Deprecated: Graph Cache & Follow Storage

The following exist only as inert leftovers from the removed trust-graph feature.
Nothing populates them anymore, so the caches load empty:

- **Follow storage format** — follows were stored as delta-encoded sorted
  `Uint32Array`s in `follows_v2` (absolute first value, then per-element deltas)
  for compact storage.
- **In-memory graph cache** — `graphCache: Map<id, Uint32Array>` was loaded on
  `initDB()` via `loadGraphCache()`. `getFollowIdsSync(id)` returned the array
  directly. `loadGraphCache()` still runs but reads an empty store.
- **Follows write buffer** — batched writes into `follows_v2`.

These are retained so the storage module's initialization path and its tests
need not change; they can be removed in a later cleanup.

---

## 6. Database Switching

When the active account changes:

1. `flushWriteBuffer()` -- persist all pending writes
2. `resetCaches()` -- clear all in-memory Maps, buffers, timers
3. `db.close()` -- close the IndexedDB connection
4. `initDB(newAccountId)` -- open the new account's database
5. `loadPubkeyCache()` + `loadGraphCache()` + `loadRelayListCache()` -- reload caches from new DB

---

## 7. Firefox Compatibility

`indexedDB.databases()` is Chrome-only. When listing databases on Firefox, the code falls back to:
- Returning the currently open database
- Probing for the legacy `nostr-wot` database by attempting to open it and checking if it contains data

---

## 8. Wallet Storage

### 8.1 Wallet Configuration (Encrypted)

Wallet credentials are stored as `walletConfig` inside the `Account` object, which is encrypted inside the vault (`keyVault` in `browser.storage.local`). This means wallet configs are protected by the same AES-256-GCM + PBKDF2 encryption as private keys and mnemonics.

```ts
// Part of Account in lib/types.ts
walletConfig?: WalletConfig;

// WalletConfig is a discriminated union:
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string };
```

### 8.2 Auto-Approve Threshold (`browser.storage.local`)

| Key | Value | Purpose |
|-----|-------|---------|
| `walletThreshold_{accountId}` | `number` (sats) | Per-account payment auto-approve threshold. Payments at or below this amount skip the approval prompt. Default: `0` (all payments require approval). |

Managed by privileged methods `wallet_setAutoApproveThreshold` and `wallet_getAutoApproveThreshold`.
