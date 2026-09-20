# WoT optimization review — 2026-09-20

Read-only review of production code, the live benchmark, and focused runtime
reproductions. These are prioritized follow-ups, not claims that every item is
implemented. See [benchmark](wot-benchmark.md) for measured scope and limitations.

## Addressed in this changeset

- All three graph-size caps default to Unlimited and can be set by the user.
- Next-hop candidates are deduplicated as discovered; progress counters are
  incremental. Tests prove overlapping paths/cycles request each author once per
  relay per sync. A subsequent resync intentionally checks again for edits.
- Page authorization and final identity validation no longer load the graph:
  one graph read/decode per page query, previously three.
- Automatic alarm arrivals during an active/queued alarm refresh are skipped.
  Reproduction previously queued three crawls when ticks arrived during one crawl.

## Remaining priorities

1. **Storage capacity and atomic snapshots.** The measured 32.7 MB snapshot cannot
   fit Chrome's default 10 MB storage.local quota with the current manifest.
   Expanded storage permission is one option; a scalable alternative is IndexedDB
   with public author/list records and atomic per-account snapshot generations.
   Keep small settings/progress/inventory metadata in storage.local. Both approaches
   need quota-error handling that preserves the last completed graph. Test a native
   >40 MB save/reload, migration, interrupted writes, clearing and account isolation.

2. **Reuse decoded snapshots and traversal indexes.** Queries still decode once
   and traverse once per request. Cache by snapshot revision, account, depth and
   mute revision/status; coalesce concurrent loads. Weight edits should recalculate
   scores without another traversal. Test invalidation on replacement, clear,
   account changes, mute/unmute, and private-mute availability/lock changes.

3. **Separate progress from graph loading.** Progress notifications currently cause
   the UI to fetch full state, decode the previous snapshot and rescan its edges.
   Store summary counts at snapshot commit and expose progress independently.
   Database inventory should read summaries rather than all extension storage and
   decode every graph. Test that progress-only notifications do zero graph reads.

4. **Reuse relay sockets across batches.** Each 50-author batch currently opens
   fresh connections. A sync-scoped pool with subscription-ID routing and CLOSE
   per subscription can remove connection churn. Preserve multiple-relay coverage,
   newer/empty replacements, cancellation, reconnects, and verification draining.
   Measure setup time before deciding whether to overlap batches.

5. **Coalesce verification and unify replacement ordering.** Reproduced one signed
   event arriving from three relays causing four signature verifications: racing
   relay checks plus sync's extra verification. Share work by identical payload,
   not an untrusted claimed ID. The transport also drops a same-timestamp lower-ID
   replacement before sync can apply its tie-breaker. Preserve forged-ID poisoning
   defenses and test tied/out-of-order/future replacements before changing this.

6. **Incremental refresh with explicit freshness.** Reuse verified public lists
   across snapshots/accounts and immediately fetch newly reached authors. A global
   `since` timestamp alone can miss delayed or backdated lists; periodic full
   reconciliation is still required. Missing replies retain known lists, newer
   empty lists remove links, and reachability must be rebuilt to prune old branches.
   Version relay lists too, and refresh root mutes without waiting for the entire
   crawl to finish.

7. **Keep numeric representation in memory.** Validate dictionary strings once
   instead of on every edge reference; retain numeric bounds checks. Normalize
   legacy duplicates once before eliminating defensive per-traversal sets. Typed
   adjacency/traversal arrays could avoid expanding millions of edges into string
   references. Measure peak heap and actual cold/warm page RPC time first.

The live benchmark's 12-minute wall time does not isolate network waits, signature
verification, connection setup or storage/UI work. It used mock storage, so it
cannot certify native quota or worker-lifetime behavior.
