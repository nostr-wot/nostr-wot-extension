# WoT live profile benchmark

Initial baseline with the former 20,000-edge default (now replaced by configurable Unlimited). Measured 2026-09-19 against the default relay pool, using the production sync
and graph code with isolated in-memory browser storage. Profile:
`npub19tv378w29hx4ljy7wgydreg9nu96czrs6clu8wkzr3af8z86rr7sujx4xe`.

| Maximum hops | Sync wall time | People | Loaded lists | Edges | Plain JSON | Dictionary JSON | 100-target lookup |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.01 s | 243 | 1 | 243 | 17,101 B | 17,773 B | 0.42 ms |
| 2 | 22.78 s | 7,437 | 115 | 20,000 | 1,407,904 B | 636,421 B | 6.81 ms |
| 3 | 22.59 s | 7,219 | 137 | 20,000 | 1,421,058 B | 629,787 B | 11.03 ms |

Depths two and three hit the 20,000-edge cap: **neither is a complete graph**.
The three-hop run exhausted its edge budget before exploring the third layer.
Relay responses and author ordering vary, so increasing the requested depth does
not guarantee a larger bounded snapshot. These were sequential runs, with prior
snapshots/cache retained just as in normal resync. Missing requested lists were
0, 129 and 107 respectively. Missing means unavailable from these responses,
not that an author follows nobody.

Dictionary encoding saved 55% at two hops and 56% at three; one-hop overhead
was about 4%. Encoding took 0.05 / 3.26 / 2.85 ms and decoding took
0.19 / 8.41 / 9.57 ms. Lookup timings include constructing a single traversal
index and evaluating 100 targets, but exclude storage reads and mute decryption.

Sync wall time includes relay waits, signature validation, graph construction and
storage. It must not be described as pure network time. Socket durations overlap;
the benchmark reports them cumulatively as a diagnostic, not an additive timing
breakdown. No assertion is made that every discovered profile or relay was reached.

Reproduce from the repository root:

```sh
WOT_BENCH_MAX_AUTHORS=300 node --import tsx --import ./tests/helpers/register-mocks.ts tests/wot-benchmark.ts npub19tv378w29hx4ljy7wgydreg9nu96czrs6clu8wkzr3af8z86rr7sujx4xe 3
```

This performs public relay reads; it does not modify the installed extension's
accounts or stored graphs. Live timings are observations, not CI thresholds.

## Unlimited total edges

Repeated with `maxEdges: null` (the new default), against the same public profile:

| Maximum hops | Sync wall time | People | Loaded lists | Edges | Plain JSON | Dictionary JSON | 100-target lookup |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2.64 s | 243 | 1 | 243 | 17,101 B | 17,773 B | 0.25 ms |
| 2 | 22.76 s | 10,104 | 99 | 34,916 | 2,390,837 B | 870,258 B | 7.96 ms |
| 3 | 29.74 s | 14,845 | 163 | 65,180 | 4,470,745 B | 1,374,793 B | 15.06 ms |

Two hops did not hit a graph limit, but 145 requested follow lists were unavailable.
Three hops reached the separate 300-author budget, with 137 unavailable lists.
Unlimited removes only the total relationship cap; it does not remove hop depth,
author count, per-author follows, or relay timeouts. Neither result proves complete
network coverage. Dictionary storage saved 64% and 69% at depths two and three.
Encoding took 0.04 / 3.98 / 7.25 ms; decoding took 0.13 / 10.00 / 17.98 ms.

The author cap was subsequently made configurable and defaults to Unlimited too.
The recorded three-hop results above used the former 300-author setting, explicitly
selected by the reproduction command. Omit that environment variable to test the
new default. The benchmark defaults to two hops; pass `3` to request three.

## Both user-configurable caps Unlimited — 2026-09-20

Completed against the same profile with `maxAuthors: null` and `maxEdges: null`:

| Hops | Sync wall time | People | Loaded lists | Relationships | Compact JSON | 100-target lookup |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 0.82 s | 243 | 1 | 243 | 17,773 B | 0.41 ms |
| 2 | 11.43 s | 19,223 | 237 | 98,723 | 1,887,702 B | 25.46 ms |
| 3 | 731.34 s (12m 11s) | 132,561 | 13,763 | 3,580,349 | 32,672,792 B | 1,130.62 ms |

Three-hop uncompressed JSON was 248,475,119 bytes; dictionary storage saved 87%.
Encoding took 772 ms; decoding took 1,485 ms. These are local process measurements,
not browser UI timings. 5,455 requested follow lists were unavailable, and the
remaining 1,000-follows-per-profile limit still flagged truncation. The graph is
not a complete uncapped view of the network. Cumulative incoming relay frames
across all three runs totalled 475 MB (raw message bytes, not full network overhead).

**Storage blocker found:** the benchmark mocks browser storage and therefore does
not enforce Chrome's local-storage quota. The current manifest does not request
`unlimitedStorage`, so this 32.7 MB graph exceeds Chrome's default 10 MB limit.
The actual extension cannot be claimed to persist this result successfully.
Large-graph persistence needs a different storage backend or explicit expanded
storage permission. Native long-running sync/worker-lifetime behavior also remains
unverified by this Node benchmark.

Reference: [Chrome storage.local quota](https://developer.chrome.com/docs/extensions/reference/api/storage).

The per-profile follow cap was subsequently made configurable with an Unlimited
default. The measurements above still used the former 1,000-follow setting and
must not be presented as timings for the fully unlimited current settings.
