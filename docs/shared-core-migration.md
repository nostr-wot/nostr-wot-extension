# Migrating the extension onto the shared `@nostr-wot/*` signer packages

## Integration status — 2026-09-28

The committed branch through `e4fb95d` is merged with the project themes and initial theme URL handoff.
That final commit repacked the packages at SDK `c2969df` and fixed the two permission
adapter gaps described in the original investigation below (`checkBlanketSignEvent`
and `saveRetiredKey`). The ten failures below describe the earlier snapshot, not the
final adapter. Uncommitted vault/signing experiments in the migration worktree are
not part of this merge; those two migrations remain incomplete.

Integration verification: `./tests/run.sh` completed with **1,842 passing tests,
zero failures and zero skips**. Build and TypeScript checks passed; lint has zero
errors and the ten existing warnings. The SDK source check now uses the main
clone's relative path and verifies `c2969df`. The Nostr Connect loopback tests use
`ws` to retain failed-relay coverage without Node/undici teardown recursion.
A fresh browser/store installation has not yet been exercised for this combined build.

## Original investigation

Branch `feat/shared-core-migration`, from `main` at `ab415c8`. The six packages come from
`nostr-wot-sdk` on `feat/shared-signer-core` at `2867008`, vendored as `file:` tarballs —
see `vendor/README.md`.

The packages were built by porting this extension's logic. Until the extension consumes
them there are two implementations of everything, so this branch is the test of whether
the extraction was sound. **Four of the six landed. Two did not, and the reason is
specific rather than a matter of effort.**

## What landed

| Area | Now | Commit |
| --- | --- | --- |
| Vendoring + drift checks | `vendor/`, `scripts/vendor-signer-packages.sh`, `tests/vendor.test.ts` | `6735ef5` |
| `browser.storage` → `KeyValueStore` | `src/services/storage/keyValueStore.ts` | `452a396` |
| Permissions | `src/services/permissions/permissions.ts` over `@nostr-wot/permissions` | `b525d10` |
| NIP-06 / NIP-19 / NIP-49 | `src/lib/crypto/nip49.ts`, `bech32.ts`, `bip39.ts`, `bip32.ts`, `secp256k1.ts`, `src/domain/accounts/*` over `@nostr-wot/accounts` | `350553f` |

Each extension module keeps its name, its module-function shape and its signatures, and
delegates. The storage keys and the on-disk shapes are untouched, because they are wire
format: renaming `signerPermissions` resets every decision a user ever made.

## What did not land, and why

### `src/services/vault/*` onto `@nostr-wot/vault` — blocked

Not a matter of adapter work. Three independent breaks:

1. **Every surviving accessor is asynchronous where the extension's is synchronous.**
   `listAccounts`, `getAccountById` and `getActiveAccountId` return promises;
   `Vault.isLocked()` is the only account-state read that is not. The extension's are
   synchronous and **the existing tests call them without `await` in 208 places** (31
   `getActiveAccountWithWallet`, 24 `getPrivkey`, 22 `getDecryptedPayload`, 18
   `listAccounts`, …). An adapter cannot make an asynchronous method synchronous, so this
   is a change to the tests, which the acceptance gate forbids.
2. **`getPrivkey` is gone on purpose.** `withPrivkey(accountId, fn)` replaces it, and the
   replacement is better — the copy is zeroed on every path and a lock mid-callback voids
   the result. It is also a different contract, and `src/services/background/publish-handlers.ts`
   and `wallet-handlers.ts` hold the returned bytes across awaits.
3. **A large part of the extension's vault surface has no counterpart.** Missing:
   `getDecryptedPayload` (absent by design — "nothing here ever returns the decrypted
   payload"), `getActiveAccount` / `getActivePubkey`, `getActiveAccountWithWallet` and
   `updateAccountWalletConfig` (the package's `Account` deliberately drops `walletConfig`
   until a wallet package exists), `getAccountForRemoteSigning` (there is
   `withRemoteSignerCredentials`, a different contract), `updateAccountNip46Keys`,
   `reEncrypt` (there is `changePassword(current, next)`, which re-verifies through
   `unlock` and therefore charges the brute-force guard — the extension re-seals an
   already-open vault with no current password at all), `setAutoLockTimeout` as a
   synchronous call, the startup auto-unlock gate (`beginStartupUnlock` /
   `whenStartupUnlockSettled`), and **any listener API at all**: `onLock`, `onUnlock`,
   `onDestroy`, `onSessionInvalidated` and `getSessionRevision`, which the private cache,
   the wallet and the WoT subsystems all subscribe to.

One thing that was feared and is not a problem: the package's serialization walks account
keys generically, so `walletConfig` and any other host field round trip losslessly, and
`pqKeys` keeps `undefined` and `null` apart. Risk 6 is absent from the record layer.

### `src/services/signing/signer.ts` and `approvalQueue.ts` onto `@nostr-wot/signer-core` — blocked behind the vault

`SignerCoreDeps.vault` is typed as the `Vault` **class**, which carries a `#private`
field. A `#private` field makes a class type nominal in TypeScript, so no host facade can
stand in for it. Verified:

```
error TS2740: Type '{ isLocked(): boolean; withPrivkey<T>(…): Promise<T>; now: () => number; }'
  is missing the following properties from type 'Vault': #private, exists, create, unlock, and 21 more.
```

So `SignerCore` can only be given a real `@nostr-wot/vault` instance, and adopting the
signing pipeline requires the vault migration first. The ports themselves line up well —
`ApprovalPort` ↔ `src/services/signing/approvalQueue.ts`, `ActivityPort` ↔ the activity
log, `IdentityPort` ↔ `src/services/signing/identity.ts`, `RemoteSignerPort` ↔
`runNip46Request` — so once the vault moves, this is adapter work rather than another
blocker.

## The eight enumerated risks

| # | Verdict |
| --- | --- |
| 1 | **Bit, and fixed.** The extension passed `maxmem = 128·r·(N+p)`. scrypt also allocates one scratch block; `@noble/hashes` 2.0.1 did not count it, 2.4.0 does. Reproduced against the 2.4.0 installed under the vendored packages: `"maxmem" limit was hit: memUsed(128*r*(N+p+1))=67110912, maxmem=67109888`. The suite stayed green only because `package-lock.json` still pinned 2.0.1 while `package.json` declared `^2.0.1`, so a fresh install today could neither write nor read an ncryptsec. `@nostr-wot/accounts` computes it from what the algorithm allocates, and `tests/vendor.test.ts` exercises it against whichever `@noble/hashes` is actually installed rather than against a pinned one. |
| 2 | **Bit, and fixed.** A remembered blanket `deny` now survives `migrateToPerKind`, however often it re-runs — and `background.ts` runs it on every startup. Pinned by `tests/permissions-shared-core.test.ts`. |
| 3 | **Bit, in the fail-closed direction.** The adapter passes `''` for a missing account id rather than restoring `accountId \|\| '_default'`. In global mode (the default) the package ignores it; in per-account mode a read answers `ask` and a write throws. Every production call site passes an id when one exists, so nothing a user relies on moves. Pinned. |
| 4 | **Not reached.** Session semantics and `withPrivkey(undefined)` are vault-side. |
| 5 | **Not reached.** The `changePassword` / `vault_setAutoLock` lockout surfaces only once the vault is the package's. Note for then: the package's `changePassword` verifies the current password through `unlock`, so a wrong one is charged to the brute-force guard, and `VaultLockedOutError` is a distinct throw the handlers have to expect. |
| 6 | **Absent.** See above — the record layer is lossless about `undefined` versus `null` and about host-only fields. |
| 7 | **Handled.** The adapter hands the package the un-namespaced `local` area, so `_permMigrationVersion` and the permission tree share one store. Only `signerPermissions` is written today because `background.ts` calls the four migrations individually rather than `Permissions.migrate()`; adopting `migrate()` is now safe, which it was not before risk 2 was fixed. |
| 8 | **Bit, and fixed.** `Permissions.check` reads the origin as given. The adapter canonicalises with the package's own `canonicalHttpOrigin` and `canonicalHostname` — the two functions the package documents for a direct caller — so `EXAMPLE.COM.` cannot dodge a deny stored for `example.com`. Pinned. |

### A ninth, not on the list

**A `signEvent` permission check that cannot name an integer kind now resolves from the
deny levels alone.** The package refuses to let a broad `allow` answer for a kind the
caller did not state, and its `KindFor` type makes a kind-less `signEvent` check
unexpressible in a package consumer. The extension's `check(domain, method, kind?)` keeps
`method: string`, so it compiles, and at runtime the package answers `ask` where the
extension answered from the blanket `signEvent` key.

Every production call site passes `event.kind`, and the data written is byte-identical
(`{"t.com":{"_default":{"signEvent":"allow"}}}`), so no user-visible behaviour changes.
Four existing assertions read without a kind and now see `ask`.

## Acceptance gate: `./tests/run.sh`

**The gate is not met.** Ten assertions fail, from two root causes, both of them the
package deliberately refusing something the extension's own API allowed. Neither was
worked around in the adapter and no test was edited.

### Cause A — the kind-less `signEvent` read (the ninth risk above), 4 assertions

- `tests/permissions.test.ts` → `permissions -- isolation` → `different domains are isolated`
- `tests/permissions.test.ts` → `permissions -- isolation` → `different methods are isolated`
- `tests/permissions.test.ts` → `permissions -- NIP-07 methods` → `signEvent: allow and deny work`
- `tests/signer.test.ts` → `signer -- signEvent approval flow` → `saves permission and batch-resolves on "remember" approve`

The `save and clear` → `clear specific domain` failure is the same read.

**What the package would need:** a way to resolve the blanket `signEvent` key on a read —
the counterpart of the `null` kind `permissionKey` already accepts on a write. Without it
"is this origin allowed to sign anything at all?" is a question the store can be told the
answer to and cannot be asked.

### Cause B — `saveDirect` refuses the retired DM keys, 5 assertions

All of `tests/permissions.test.ts` → `permissions -- migrateDmKindsToSendMessages`, which
seeds `signEvent:4`, `:13`, `:1059` through `saveDirect` and then migrates them. The
package throws: `signEvent:4 is never consulted: DM sign kinds resolve to "sendMessages".
Write that key instead.` The refusal is right for a UI — a rule under that key would never
fire — but it is the only write path the class exposes.

**What the package would need:** a way to write a legacy or retired key, so a migration can
be given the data it exists to migrate. As it stands `migrateDmKindsToSendMessages` cannot
be exercised from outside the class at all.

### The rest of the suite

Everything else passes. Group by group, as `tests/run.sh` orders them:

| Group | Result |
| --- | --- |
| `tests/vendor.test.ts` | 6 tests, 6 pass |
| crypto | 216 tests, 216 pass |
| wallet protocol | 285 tests, 285 pass |
| pure popup/decision logic | 269 tests, 269 pass |
| shared-core adapters (new) | 19 tests, 19 pass |
| browser-mocked modules | 998 tests, 988 pass, **10 fail** — the ten above |

The module group is counted without `tests/nostr-connect-integration.test.ts`, which leaves
WebSocket handles open and is what makes that group hang after its tests finish instead of
printing a summary — the behaviour `AGENTS.md` records as known. Run on its own it is
36 tests, 34 pass, 2 fail.

Those two failures are unrelated to this branch and fail identically on an unmodified
checkout of `main` at `ab415c8` in this environment:
`Nostr Connect qr: resolve shared user identity before saving` and
`… resolve distinct user identity before saving`, both `RangeError: Maximum call stack
size exceeded` inside undici's WebSocket teardown when a real relay connection fails.

`npm run lint` reports 0 errors and 10 warnings, all pre-existing
`react-hooks/exhaustive-deps` warnings in files this branch does not touch.

`npm run build` succeeds. `npx tsc --noEmit` is clean. As a side effect of the accounts
migration the background bundle dropped from 570 kB to 451 kB.

## What remains unverified

- Nothing was loaded in a browser. Per `AGENTS.md` that has to happen in the main clone,
  and this branch is verified by tests, typecheck and build only. The permission and
  ncryptsec paths are covered by tests; the popup surfaces that call them through RPC are
  not exercised end to end here.
- The vault and signing migrations were assessed and not attempted, so risks 4 and 5 are
  unverified in practice.
- `vendor/manifest.json` records a checkout path relative to the repo root, and "beside
  the repo" is one `..` deeper from a worktree than from the main clone. Both are tried
  and `VENDOR_SDK_PATH` overrides, but the recorded value is the worktree's.

## Order of work for the rest

1. Give `@nostr-wot/vault` the surface above, or agree that the extension's vault module
   stays and keeps a synchronous façade over an instance — which needs a synchronous
   snapshot read the package does not currently offer.
2. Then `@nostr-wot/signer-core`, which is adapter work once it can be handed a real
   `Vault`.
3. The two permission gaps are small and independent of either, and they are the whole
   distance between this branch and a green gate.
