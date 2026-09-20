# Configuration

## 1. Runtime Config

The background keeps a small mutable config object (`config` in `src/services/background/state.ts`):

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

`DEFAULT_RELAYS` (in `src/constants/relays.ts`):

```js
['wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr-01.yakihonne.com']
```

`myPubkey` is initialized from the active account when the vault is loaded. The
user's own read/write relays (NIP-65) take precedence over these defaults when
publishing; the defaults are a fallback for accounts that have not configured a
relay list yet.

Experimental WoT configuration is separate from legacy sync settings: `browser.storage.local.experimentalWot`, validated by `src/domain/wot/validation.ts`, with defaults in `src/constants/wot.ts`.

| Setting | Default |
| --- | --- |
| Enabled / automatic sync | Both false; automatic sync runs daily when enabled |
| Query mode | `local` (also `remote` and `hybrid`) |
| Oracle | `https://wot-oracle.mappingbitcoin.com` |
| Maximum hops | 2; configurable from 1 to 3 |
| Maximum relationships / authors / follows per profile | `null` (Unlimited) |
| Scoring | `WOT_SCORING` distance weights and path bonuses |

Sync settings are saved explicitly; valid scoring changes apply immediately. Existing custom oracle URLs are retained; missing or blank URLs adopt the default. Changing configuration cancels in-flight work. Legacy `browser.storage.sync.mode` does not enable this feature. See [WoT](wot.md) and its [API proposals](../nips/wot/README.md).

---

## 2. Relay List (NIP-65)

The user's read/write relay list is edited in the popup and published as replaceable kind:10002 events via `src/services/background/publish-handlers.ts`. Publication and configured CSV parsing reuse helpers in `src/domain/relays/relayList.ts`. Experimental WoT sync reads the configured relays; it does not replace the user's own published relay configuration.

---

## 3. Profile Metadata Caching

Kind:0 (profile metadata) events are fetched from relays and cached at two levels:

| Level | TTL | Storage |
|-------|-----|---------|
| In-memory | 30 minutes | `profileCache: Map<pubkey, { metadata, fetchedAt }>` |
| Persistent | 30 minutes | `browser.storage.local` under `profile_{pubkey}` |

The fetch queries all configured relays simultaneously, accepts the newest event (highest `created_at`), with a 5-second overall timeout and 4-second per-relay timeout.
