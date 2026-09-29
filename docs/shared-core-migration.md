# Migrating the extension onto the shared `@nostr-wot/*` signer packages

Branch `feat/shared-core-migration`, from `main` at `ab415c8`. The six packages come from
`nostr-wot-sdk` on `feat/shared-signer-core`, vendored as `file:` tarballs; see
`vendor/README.md`. First vendored at `2867008` and repacked at `c2969df`, which matters:
most of what this document records as blocking the vault was assessed against `2867008` and
has since been answered upstream. See the note under that heading before acting on it.

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
| Every private-key call site on the scoped accessor | `vault-handlers.ts`, `publish-handlers.ts`, `pqc-handlers.ts`, `wallet-handlers.ts`, `signer.ts` | `19209c3`, `6e7f804`, `178b783` |

Each extension module keeps its name, its module-function shape and its signatures, and
delegates. The storage keys and the on-disk shapes are untouched, because they are wire
format: renaming `signerPermissions` resets every decision a user ever made.

### `getPrivkey` to `withPrivkey`, at every call site

Nine production call sites across five modules took a `getPrivkey()` copy and were trusted
to zero it. All nine now run inside `vault.withPrivkey`, which zeroes on every path. This is
the one part of the shared core's contract the extension can adopt before the vault itself
moves, because its own vault already grew the scoped accessor.

What each site was holding, and for how long:

| Site | The old copy was live across |
| --- | --- |
| `publishRelayList`, `publishMuteList`, `signAndPublishEvent` | the signing AND the relay broadcast |
| `pqc_publishAttestation` (already scoped, now also account-checked) | the same, and it is the site the in-code note describes |
| `handleSignEvent` | the signing and two storage writes that follow it |
| `handleCryptoRequest` | the whole NIP-04 / NIP-44 callback |
| `createNip98SignFn` | the signing and a session assertion |
| `vault_exportNsec`, `vault_exportNcryptsec` | the encoding, plus a hex string nothing can zero |

Three things came out of the conversion beyond the zeroing:

1. **Side effects moved downstream of the scope.** Signing happens inside, broadcasting and
   storage writes happen outside, on the value the scope returns. That is not style. The
   package's `withPrivkey` voids the result of a callback whose session was revoked
   mid-flight, and voiding cannot unsend: a callback that published would already have put
   the event on the wire. The extension's own `withPrivkey` does not void yet, so today the
   split buys the shorter key lifetime, which is the whole point; what it buys later is that
   these handlers need no second rewrite when the vault moves.
2. **Two export paths stopped building a hex string.** `bytesToHex(privkey)` was a second
   copy of the key that no `fill(0)` can reach. `nsecEncode` already took bytes;
   `ncryptsecEncode` now does too, keeping its hex overload for the callers and tests that
   pass one.
3. **`pqc_publishAttestation` now names and checks its account.** `pqc_getStatus` builds the
   attestation for whatever account was active then, and `writeRelays()` awaits before the
   signing, so a switch in between would have published one identity's post-quantum keys
   under another's name. `publish-handlers.ts` already guarded its own publishes that way.

`getPrivkey` itself stays exported. It is called 41 times across five test files, and the
acceptance gate forbids editing tests, so removing it is a change for whoever moves the
vault. No production code outside `src/services/vault/` reaches a private key any other way:
`grep -rn 'privkeyBytes' src/` outside that directory finds only `nip49.ts` and
`creation.ts`, both operating on a key the caller already owns.

## What did not land, and why

### `src/services/vault/*` onto `@nostr-wot/vault`: blocked at `2867008`, mostly answered at `c2969df`

**Read this note first.** The three breaks below were measured against the packages as
first vendored, at `2867008`. The repack in `e4fb95d` brought `c2969df`, whose message is
"give the class the surface and the shape its consumer actually needs", and reading
`packages/vault/src/vault.ts` there shows most of break 1 and break 3 gone:
`listAccounts`, `getAccountById`, `getActiveAccountId`, `getActiveAccount`,
`getActivePubkey`, `getActiveAccountWithWallet`, `getDecryptedPayload`,
`getAccountForRemoteSigning`, `hasMnemonic` and `hasImportedPqKeys` are all synchronous
now, so the 208 un-awaited test call sites stop being a problem. `updateAccountWalletConfig`,
`updateAccountNip46Keys`, `reEncrypt(next)`, a synchronous `setAutoLockTimeout`,
`beginStartupUnlock` / `whenStartupUnlockSettled`, `getSessionRevision` and all four
listeners (`onLock`, `onUnlock`, `onDestroy`, `onSessionInvalidated`) exist. `d711d7a`
separately turned `SignerCoreDeps.vault` into a port rather than the class, which removes
the `#private` nominal-type wall that blocked `signer-core`.

What is left of the distance, from reading the package rather than from attempting it:

- **No `clearActiveAccount`.** The package has `setActiveAccountId(id: string)` and nothing
  that returns the vault to "no account active", which is the state after removing the last
  account.
- **No `getPrivkey`.** Correct by design, and the production call sites are converted
  (above), but 41 test references remain and the gate forbids editing tests.
- **`withCacheKey` hands a `Uint8Array`; the extension's hands a WebCrypto `CryptoKey`.**
  Bridgeable by importing the bytes inside the callback, at an `importKey` per call, which
  is an honest adapter rather than a workaround, but it is a real shape difference and the
  extension's non-extractable-key property is not preserved by it.

None of this was attempted here. The conversion above is the whole of this changeset.

The original assessment, against `2867008`, follows. Not a matter of adapter work at that
commit. Three independent breaks:

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

**The gate is met, with the tests untouched.** Six groups, 1834 assertions:

| Group | Result |
| --- | --- |
| `tests/vendor.test.ts` | 6 tests, 6 pass |
| crypto | 216 tests, 216 pass |
| wallet protocol | 285 tests, 285 pass |
| pure popup/decision logic | 269 tests, 269 pass |
| shared-core adapters | 24 tests, 24 pass |
| browser-mocked modules | 1034 tests, 1032 pass, 2 fail |

The two failures are `Nostr Connect qr: resolve shared user identity before saving` and
`… resolve distinct user identity before saving`, both `RangeError: Maximum call stack
size exceeded` raised inside undici's WebSocket teardown when a real relay connection
fails, from `nostr-tools/lib/esm/pool.js`. They have nothing to do with this branch and
fail identically on an unmodified `ab415c8`: extract that tree, point it at the same
`node_modules`, run `tests/nostr-connect-integration.test.ts`, and it is 36 tests, 34 pass,
the same 2 fail. `./tests/run.sh` therefore exits 1 on `main` in this environment too.

The ten assertions recorded below as failing were the state at `2867008`. `e4fb95d` brought
the two package methods that answer them, `checkBlanketSignEvent` and `saveRetiredKey`, and
all ten pass. The record stays because the shape of the two gaps is worth keeping: both were
the package deliberately refusing something the extension's own API allowed, neither was
worked around in the adapter, and no test was edited to accommodate either.

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

### On the hang

An earlier run of this suite recorded the module group hanging after its tests finished,
which is the behaviour `AGENTS.md` warns about, and counted that group without
`tests/nostr-connect-integration.test.ts` for that reason. It did not hang in any of the
three runs behind the table above: the group printed its summary and `./tests/run.sh`
returned, exiting 1 on the two failures. The counts in the table are the whole group,
integration file included. Treat the hang as intermittent rather than as gone.

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

Items 1 and 3 of the original order are done: `c2969df` gave `@nostr-wot/vault` the
synchronous surface, and `e4fb95d` closed the two permission gaps. What is left:

1. `src/services/vault/*` onto `@nostr-wot/vault`, as a module facade over one instance.
   The three things to settle first are listed under that heading: no `clearActiveAccount`,
   no `getPrivkey` for the 41 test references, and `withCacheKey` handing bytes where the
   extension hands a `CryptoKey`.
2. Then `@nostr-wot/signer-core`. `d711d7a` made its vault and permission dependencies
   ports rather than classes, so the `#private` nominal-type wall is gone and this is
   adapter work once the vault moves.
3. Nothing on the private-key path. Every production call site is on the scoped accessor
   already, and the handlers are shaped so that the package's stricter contract, which
   voids a result computed under a revoked session, needs no further rewrite of them.
