# Configuration

## 1. Runtime Config

The background keeps a small mutable config object (`config` in `lib/bg/state.ts`):

```ts
export interface ExtConfig {
    myPubkey: string | null;   // active account's pubkey
    relays: string[];          // relays used for fetching/publishing
}

export const config: ExtConfig = {
    myPubkey: null,
    relays: DEFAULT_RELAYS,
};
```

`DEFAULT_RELAYS` (in `lib/bg/state.ts`):

```js
['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com']
```

`myPubkey` is initialized from the active account when the vault is loaded. The
user's own read/write relays (NIP-65) take precedence over these defaults when
publishing; the defaults are a fallback for accounts that have not configured a
relay list yet.

> The earlier Mode system (`local` / `remote` / `hybrid`), the remote oracle URL,
> `maxHops`, `timeout`, and the trust `scoring` config have all been removed
> along with the trust-graph subsystem. There is no `browser.storage.sync.mode`
> anymore.

---

## 2. Relay List (NIP-65)

The user's read/write relay list is edited in the popup (Relays card) and
published as a replaceable `kind:10002` event via `publishRelayList`
(`lib/bg/publish-handlers.ts`). Relay URLs are normalized with
`normalizeRelayUrl` (`lib/relayUtils.ts`) before use. Relay-list queries for
arbitrary pubkeys are served by `getRelayList` / `getRelayPool`
(`lib/bg/relay-handlers.ts`), which back the `window.nostr.wot` page API.

---

## 3. Profile Metadata Caching

Kind:0 (profile metadata) events are fetched from relays and cached at two levels:

| Level | TTL | Storage |
|-------|-----|---------|
| In-memory | 30 minutes | `profileCache: Map<pubkey, { metadata, fetchedAt }>` |
| Persistent | 30 minutes | `browser.storage.local` under `profile_{pubkey}` |

The fetch queries all configured relays simultaneously, accepts the newest event (highest `created_at`), with a 5-second overall timeout and 4-second per-relay timeout.
