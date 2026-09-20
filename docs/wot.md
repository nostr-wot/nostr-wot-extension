# Experimental Web of Trust (0.8.0)

Enable **Menu → Web of Trust (experimental)** to expose `window.nostr.wot`.
It is disabled on installation and upgrade, including for users of the retired
WoT implementation. There is no wizard step or trust-badge injection. Automatic refresh is separately opt-in. Disabling removes our page API and rejects retained references.
On entry, a notice explains that scores describe follow/mute relationships, not safety or endorsement. **Don’t show again** persists the dismissal on this device; the same notice remains at the bottom of the screen. The sync card shows one status dot and one set of graph counts. **Sync settings**
opens a dedicated screen containing automatic syncing, mode, hops, limits, a database table, the
sync/mute explanation, and sync/resync/clear actions. Save appears only after
sync configuration edits, including automatic-sync changes. Configuration descriptions
are available in info tooltips beside their labels. Back discards unsaved settings edits.

The scoring card accepts npub or hex public keys and opens a popup showing the saved query
mode's score on a 0–100 scale (the API remains 0–1). Muted accounts score zero;
missing results are shown as unavailable. The gear icon at the top right opens a separate scoring
popup for weights and bonuses. Valid scoring edits apply automatically; invalid
values show an error without replacing the saved configuration. Lookups reuse the same scoring and mute logic as
website queries, and never start a graph sync.

If an unpacked update leaves an old background worker running, an unknown WoT method response shows **Reload extension**. Reopen the popup after reloading; the feature is still opt-in.

Listen for `nostr:wotChanged` to detect availability changes after page load.

## Modes and consent

- **Local:** query a snapshot downloaded by pressing **Sync local graph**.
- **Remote oracle:** query the HTTPS oracle configured in the menu.
- **Hybrid:** use local answers, querying that oracle on local misses.

Enabling explains that connected sites with identity access may query follow
relationships. Each request also obeys existing site connection, identity-disable
and getPublicKey permissions. The page cannot enable/configure the feature or
start a sync. HTTPS is required, except loopback development pages. Oracles receive
the active public key and queried public keys; the menu discloses this before
opt-in. Oracle responses are assertions by that server, not verified Nostr events.
The default oracle is `https://wot-oracle.mappingbitcoin.com`. Existing custom
URLs are preserved; previously blank URLs adopt this default. Local mode remains
the default, and no oracle is contacted while the feature is disabled. The server must allow
browser cross-origin requests (CORS); this feature adds no broad host permissions.

## Page API

The historical method names are preserved:

```js
await window.nostr.wot.getStatus();
await window.nostr.wot.getDistance(pubkey);          // hops or null
await window.nostr.wot.isInMyWoT(pubkey, maxHops);   // boolean
await window.nostr.wot.getTrustScore(pubkey);       // 0..1 or null
await window.nostr.wot.getDetails(pubkey);          // { hops, paths, score } or null
await window.nostr.wot.getDistanceBatch(pubkeys, { includePaths: true, includeScores: true });
await window.nostr.wot.getTrustScoreBatch(pubkeys);
await window.nostr.wot.filterByWoT(pubkeys, maxHops);
await window.nostr.wot.getFollows(pubkey);           // omitted pubkey = active identity
await window.nostr.wot.getCommonFollows(pubkey);
await window.nostr.wot.getPath(pubkey);
await window.nostr.wot.getConfig();
await window.nostr.wot.getStats();
await window.nostr.wot.getRelayList(pubkey);
await window.nostr.wot.getRelayPool();
```

Pubkeys accept hex or npub. `getDistanceBatch(pubkeys, true)` retains the legacy
includePaths shorthand. Batches allow 100 targets; oracle requests are processed four at a time,
with a 60-second deadline for the whole query. Relay methods always read the synced
NIP-65 snapshot, including in remote mode. Unavailable lists return null.

Local sync also refreshes the active account’s NIP-51 kind:10000 mute list using the shared mute cache. It downloads verified kind:3 and kind:10002 events from up to six configured
relays, in batches of 50 authors. Depth remains 1–3 hops. Maximum follows per profile is configurable and defaults to Unlimited. Maximum profiles to fetch is configurable and defaults to Unlimited. The total edge limit is user-configurable and defaults to Unlimited; leave Maximum relationships empty to remove that cap. `getStatus()` and `getStats()` expose `truncated`
and `updatedAt`; the menu warns when limits are reached. Missing results may
reflect incomplete relay coverage, an unsynced author, or these limits, not an
absence of relationships. Offline refresh failures preserve the previous snapshot.

Snapshots contain public follow/relay lists in IndexedDB, with small account-scoped
summary pointers in `storage.local`, checked against the active pubkey. The database table’s delete action removes the selected account’s snapshot. Disabling preserves it for later use. No private keys are stored.
Oracle replies are cached in worker memory for 60 seconds; concurrent identical
queries share a request. Requests have a 10-second timeout, a 1 MiB response limit,
no cookies/referrer and no redirects. Settings/account changes invalidate in-flight
work; permission revocation is checked before returning results.

## Code and tests

- `src/domain/wot/`: types, validation and graph/scoring algorithms.
- `src/constants/wot.ts`: defaults and bounds.
- `src/services/wot/`: settings/snapshots, bounded manual/automatic sync, progress, inventory, oracle transport and queries.
- `src/services/background/wot-handlers.ts`: privileged settings and page consent.
- `src/screens/Settings/WotSection.tsx`: existing shared controls and resource hooks.

`tests/wot.test.ts` covers graph cycles/paths, modes, limits, consent, oracle
validation, cancellation, signed relay sync and the actual injected API. The
communication suite verifies the content/background origin and privilege boundary.
Native UI and IndexedDB checks use isolated Chrome fixtures; these do not establish live oracle-provider interoperability. See the [API and scoring proposals](../nips/wot/README.md) and [release audit](audits/2026-09-20.md) for scope and remaining limits.

## Mutes and scoring

The active account’s cached **account mutes** override trust: muted targets score
zero, have no distance/path and are excluded from membership/filter results.
Local traversal excludes muted intermediaries, recalculating shortest paths and
path bonuses. Words, hashtags and event mutes do not penalize an entire identity.
Other people's mutes are not negative votes against an account.

Private NIP-44 (and legacy NIP-04) entries use the existing local account decoder.
Plaintext private lists are neither persisted in snapshots nor sent to an oracle.
Locked, watch-only or remote accounts cannot decrypt these locally: the menu and
`getStatus().muteStatus` report `private-unavailable`; available public mutes still
apply. Missing/unverified cache reports `unavailable`; sync loads it. Website
queries never open relays or request remote-signer decryption. Cached mutes may
be stale until refreshed; acknowledged edits to the shared cache apply immediately.
Connected sites can infer mutes from score changes; the opt-in notice discloses this.

When any account mutes apply, oracle aggregate path counts cannot establish that
all paths avoid muted accounts. Only a returned concrete, unmuted path contributes
(one path, no extra path bonus). A blocked or absent path returns no trust, even
if an alternative path could exist. This conservative limitation applies to hybrid
fallback too. Raw follow/relay lists remain factual source data, not scored lists.

The settings summary separates **People in graph** (unique discovered identities,
excluding your own) from **Follow lists loaded**. At two hops, a small number of
loaded lists can discover hundreds of people; fetching those people's own lists
is only needed for the next hop. Missing requested follow lists are reported
separately. `getStats()` counts all discovered nodes, including the root, and
reports list counts and missing lists too. Maximum hops has its own card and
explanation. Save appears only for unsaved changes; an existing snapshot changes
the sync action to Resync.


## Sync controls and storage

The header info icon opens an explanation of modes, updates, scoring and privacy.
Sync reports the current hop, authors checked, people discovered and lists loaded;
updates are throttled to 750 ms while events arrive, with immediate batch/completion
updates. Interrupted workers report an interrupted sync on reopening. Unsaved
settings remain intact when progress updates arrive.

Automatic syncing is disabled by default. When enabled alongside WoT, a browser
alarm refreshes the active account once a day (1,440 minutes). Existing five-minute
alarms migrate to that interval. Account/settings changes update scheduling without
starting an extra sync; manual Sync/Resync remains available in Sync settings. Overlapping syncs are skipped until the next alarm. This is
polling, not a live relay subscription. Disabling WoT cancels work and clears the
alarm. Newer signed follow lists replace old ones, including empty lists; rebuilding
from the root prunes removed branches. Missing or older relay results retain known
lists rather than restoring stale follow relationships. Hop depth still applies; per-profile follows, fetched profiles and total edges all have optional caps defaulting to Unlimited.

The database card lists stored account graphs, people/list counts and combined
storage bytes. Browser-reported bytes are used where available; other browsers
show an estimate based on serialized data. Inactive accounts retain their snapshots.
These figures cover WoT snapshots, not all extension storage.

Snapshots use a public-key dictionary with numeric references for adjacency,
relay owners and list versions. Hex keys occur once in the dictionary. Earlier
unpacked snapshots remain readable and convert on the next successful sync.
Queries retain a decoded snapshot in worker memory and reuse a numeric breadth-first
index across targets, invalidating it when the graph or mute exclusions change. No persisted private
mute information is added. Small one-hop graphs can have slightly more dictionary
overhead; repeated relationships in larger graphs benefit most.

The scoring popup configures hop weights, extra shortest-path bonuses and their
cap, with a reset to defaults. Values must be finite and between zero and one;
weights cannot increase with distance. Account mutes always override these settings.
Changing weights recalculates cached oracle results without another network request.

### Large-graph storage

Packed snapshots are committed to IndexedDB before publishing a small pointer
and summary in `storage.local`. Failed writes retain the last completed graph;
startup cleanup removes abandoned snapshot generations. Legacy local-storage
snapshots migrate on read. The database panel reports estimated payload bytes,
including the shared verified public-list cache. Browser disk quotas still apply.
Native Chrome testing saved, reloaded and cleared a 44.3 MB fixture using an
isolated HTTP origin; this does not verify extension worker lifetime.

### Repeated profiles

Within one sync, public keys are deduplicated in the next-hop set and the visited
set. A profile reached through several paths is requested only once per relay;
cycles do not trigger repeat requests. Each selected relay receives the batch to
improve coverage and identify newer lists. Manual resync checks all reached authors. Automatic sync reuses non-root verified
public lists younger than five minutes, requests recent changes for stale lists,
and fully reconciles each list at least daily. The root is always checked.
Backdated events outside the incremental overlap window require a full refresh.
Stored lists remain fallback when relays have no newer answer. Progress counts
are maintained incrementally rather than scanning all accumulated edges per batch.

Maximum relationships, Maximum profiles to fetch and Maximum follows per profile
all default to Unlimited. Clear the corresponding field to remove a custom cap.
Custom values must be positive safe integers. Old settings lacking these fields
inherit Unlimited. Clearing a cap permits a newly fetched list to restore entries
that an earlier capped sync omitted.

Automatic alarm ticks are coalesced before starting and dropped while a sync is
already running, so a long crawl does not create a backlog of repeated refreshes.
Account/settings changes still reconcile the scheduler. Website authorization and
final identity checks read metadata only; each page query loads the graph once.


The npub score result explains the same calculation used by website queries:
shortest-path hops (one follow edge per hop), number of shortest paths, distance
points and the applied path bonus after caps. It identifies local versus oracle
evidence and shows the search depth. Paths can share edges. Graph-wide totals are omitted from the score popup.
Mute-list availability distinguishes confirmed empty lists from unreadable private mutes. A muted target scores zero; a missing path remains
unavailable. Positive point contributions show a green plus; mute suppression
is red with a minus, describing an override to zero rather than an invented
numeric deduction. Explanations use the shared purple subtitle token. These private diagnostics use the
internal `experimentalWot_getScoreExplanation` RPC and are not exposed to websites.

Calculating a score opens the shared scrollable modal. Profile metadata loads
independently through the existing cached/coalesced profile reader and renders
with ProfileSummary (name and picture only) when available. The shortened npub and copy action are shown only as a fallback when profile
name/image information is missing or fails. Closing keeps the search input;
late score/profile replies cannot populate a later result.

The sync status percentage measures completed authors in the **current hop**,
not the overall crawl; later frontiers are unknown until follow lists arrive.
Completed syncs no longer repeat the live progress counters.

The database table lists every saved account snapshot with status, estimated
size, resync and confirmed delete actions, plus the shared public-list cache.
Account-targeted resync uses the existing sync engine without switching the
active identity. Settings/account changes still cancel it, and only one crawl
can run at a time. Snapshots whose accounts were removed remain deletable but
cannot be resynced. Deleting a snapshot preserves accounts and keys.
Shared-cache resync runs a full sync for the active account; deleting that cache
preserves all saved account snapshots. Removal is blocked while syncing.

A confirmed empty mute list adds no notice to score results. Mute information
appears only when exclusions exist or availability limits the calculation.
