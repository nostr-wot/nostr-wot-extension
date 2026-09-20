# Draft: WoT relationship and scoring semantics

Status: experimental companion to the [browser API proposal](01-browser-wot-api.md). Scores describe relationship evidence, not safety, reputation guarantees or endorsement. Scoring policy is configurable and is not proposed as a universal ranking standard.

## Public graph

Directed follow edges come from verified kind:3 events. Relay preferences come from kind:10002 events. Newer replaceable events replace older lists, including removals; equal timestamps use the lower event ID. Queries use the selected identity as the root. Cycles do not create infinite traversal or extra repeated walks. Local path counts count shortest directed paths; paths can share edges.

Snapshots may be incomplete because relays are unreachable, lists are missing or the user selected limits. A missing path does not prove that no relationship exists. Providers should expose timestamps, missing-list counts and truncation. Nostr WoT uses numeric identity references in IndexedDB, reuses public lists across accounts and preserves the previous completed snapshot when a refresh fails.

## Scores and mutes

Self scores 1. For a reachable target, the extension computes `min(1, distanceWeight[hops] + bonus)`. The bonus is zero at one hop; otherwise it is `min(max(0, paths - 1) * pathBonus[hops], maxPathBonus)`. Unknown oracle path counts add no bonus. Current defaults are distance weights 1, 0.5, 0.25 and 0.1 for hops 1–4, bonuses 0.15, 0.1 and 0.05 for hops 2–4, and a bonus cap of 0.5. The fourth-hop weights are retained for compatibility; the extension currently queries at most three hops. The UI displays scores as percentages while the API uses 0–1.

Only the root account’s account mutes affect scoring. A muted target scores zero and has no distance/path or membership; muted intermediaries cannot contribute local paths. Word, hashtag and event mutes do not penalize an identity. Other users’ mute lists are not negative votes. Raw follow and relay lists are not filtered by scoring policy.

The extension refreshes kind:10000 during sync and reuses the shared mute cache. Private NIP-44 and legacy NIP-04 entries are decoded locally where keys are available, without prompting a remote signer. Private plaintext is not saved in public graph snapshots or sent to an oracle. Unavailable private lists are reported as `private-unavailable`; known public entries still apply. Cache absence or unreachable reads report `unavailable`. Website queries can infer exclusions from scores, even without direct access to mute lists.

## Query modes and oracles

Local mode uses the downloaded snapshot. Remote mode asks the configured HTTPS oracle. Hybrid mode uses local evidence and falls back to the oracle on misses. Oracle answers are assertions, not independently verified event chains. With any known mutes, an aggregate path count cannot establish clean paths: the extension credits only one concrete returned path whose identities avoid the mute set, with no extra path bonus. It does not claim that this is the only possible clean path.

The current oracle adapter uses GET endpoints relative to the configured URL: `distance?from=&to=` → `{ hops, paths? }`, `path?from=&to=` → `{ path }`, `follows?pubkey=` → `{ follows }`, `common-follows?from=&to=` → `{ common }`, and `stats` → an object. HTTP 404 represents no result. Paths must have valid endpoints, unique valid keys and fit the query depth. Requests omit credentials and referrers, reject redirects, limit responses to 1 MiB and cache successful replies for 60 seconds. The default endpoint is `https://wot-oracle.mappingbitcoin.com`; local mode is the default and sends it no queries.

These endpoint shapes document the current adapter, not an accepted oracle standard. Interoperability, stable error codes and a versioned discovery contract remain topics for collaboration.
