# Draft: optional browser Web-of-Trust API

Status: experimental, unnumbered proposal. This extends the NIP-07 provider with an optional `window.nostr.wot` namespace; it does not change signing or require a new event kind.

## Discovery and permission

Applications feature-detect `window.nostr?.wot`. Providers expose it only after user opt-in and notify availability changes with `nostr:wotChanged`, whose `detail.enabled` is a boolean. Clients must still handle rejected calls: an event or retained JavaScript reference is not authorization.

In Nostr WoT 0.8.0, each data request requires a connected HTTPS origin, identity access and the existing public-key permission. HTTP loopback origins are allowed for development. Account switches, disabling the feature and revoked site access invalidate in-flight work. Configuration, syncing, database deletion and private score diagnostics are extension-only operations.

```js
async function inspectRelationship(npub) {
  const provider = window.nostr?.wot;
  if (!provider) return null;
  try {
    return await provider.getDetails(npub);
  } catch {
    return null; // Permission, availability or account state may have changed.
  }
}
window.addEventListener('nostr:wotChanged', () => {
  // Re-check window.nostr?.wot before the next query.
});
```

## Methods

All methods return Promises. Public-key inputs accept 64-character hexadecimal or npub; returned public keys are lowercase hex. Missing evidence is distinct from a zero score.

| Method | Result |
| --- | --- |
| `getDistance(target)` | Shortest hop count, or `null` |
| `isInMyWoT(target, maxHops?)` | Boolean membership within the allowed depth |
| `getDetails(target)` | `{ hops, paths, score }`, or `null`; oracle path counts may be `null` |
| `getTrustScore(target)` | Number from 0 to 1, or `null`; muted targets return 0 |
| `getDistanceBatch(targets, options?)` | Map keyed by normalized target; hop counts or `null`, or objects containing `hops` and requested `paths`/`score` fields |
| `getTrustScoreBatch(targets)` | Map from normalized target to score or `null` |
| `filterByWoT(pubkeys, maxHops?)` | Normalized public keys with reachable, unmuted paths |
| `getFollows(pubkey?)` | Followed public keys; omitted argument uses the active identity |
| `getCommonFollows(pubkey)` | Public keys followed by both identities |
| `getPath(target)` | One shortest local path, including both endpoints, or a validated oracle path; `null` when unavailable |
| `getRelayList(pubkey)` | Synced array of `{ url, read, write }`, or `null` |
| `getRelayPool()` | Synced `{ url, endorsements }` entries, most endorsed first |
| `getStatus()` | `{ configured, mode, hasLocalGraph, updatedAt, truncated, muteStatus }` |
| `getConfig()` | `{ maxHops, timeout, scoring }`; timeout is the per-oracle-request deadline in milliseconds |
| `getStats()` | Local graph counts, missing-list count, timestamp and truncation; remote mode returns the oracle’s statistics object |

Batch options are `{ includePaths?: boolean, includeScores?: boolean }`; a boolean retains the historical `includePaths` shorthand. A missing batch result is `null`, not an object. Local statistics include `nodes` (including self), `people` (excluding self), `authors`, `edges`, `missingFollowLists`, `updatedAt` and `truncated`. Timestamps are Unix milliseconds. `muteStatus` is `ready`, `unavailable` or `private-unavailable`.

## Current implementation bounds

The extension supports 1–3 configured sync hops, defaults to 2, and permits query depth from 0 through the saved maximum. Batches accept at most 100 inputs. Queries have a 60-second deadline, with up to four oracle calls in parallel and 10 seconds per oracle request. Invalid keys, oversized batches, invalid depth, permission failures, missing required local snapshots and transport failures reject the Promise. Clients should not parse error message text as stable error codes.

Queries never start a graph sync. Relay methods use the local snapshot in every mode. Methods do not expose raw private mute lists, account inventories or database management. See [scoring and data](02-scoring-and-data.md) for the meaning and limitations of a result.
