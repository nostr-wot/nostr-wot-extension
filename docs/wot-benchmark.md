# WoT benchmark

[`tests/wot-benchmark.ts`](../tests/wot-benchmark.ts) runs the current production
sync, graph encoding and lookup code against public relays. It is an opt-in diagnostic,
not a CI test or a claim about installed-browser performance.

```sh
WOT_BENCH_MAX_AUTHORS=300 node --import tsx --import ./tests/helpers/register-mocks.ts tests/wot-benchmark.ts <npub-or-hex-pubkey> 2
```

The last argument selects maximum depth (1, 2 or 3); the script runs each depth in
sequence. Depth defaults to 2. `WOT_BENCH_MAX_AUTHORS` bounds the crawl; omitting it
uses the unlimited author setting. Larger crawls can take substantial time and memory.
This command reads public relays; it does not modify installed extension accounts.

Standard output contains one JSON result per depth: sync duration, encoding/decoding
duration, cold/warm lookup duration for up to 100 targets, graph counts, missing/truncated
lists, serialized sizes, socket count, frame count and received bytes. Progress goes to
standard error. Prior depths can warm caches for later depths. Socket/frame counters are
cumulative, and overlapping socket durations must not be added to wall time.

The harness uses mocked browser storage and `fake-indexeddb`; it does not exercise native
storage quota, persistence, popup responsiveness or service-worker lifetime. Current graph
storage uses IndexedDB snapshots (see [WoT implementation](wot.md)). Browser persistence
must be checked separately; a successful Node run does not establish it.

Relay availability and returned lists vary. Missing lists are not empty follow lists,
truncated snapshots are incomplete, and increasing depth does not guarantee a larger
bounded result. Record settings and environment when comparing runs. Timing thresholds
and historic network snapshots do not belong in the current implementation contract.
