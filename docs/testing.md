# Test Suite

Tests use **Node.js built-in test runner** (`node:test`, Node 22+) with the `tsx` loader for TypeScript. The full runner builds first because CSS regression tests inspect generated assets. Most targeted non-CSS tests run directly without a build. `inject-webln.test.ts` also executes the packaged MAIN-world script, so build before running it directly.

## 1. Running Tests

```bash
# All tests
./tests/run.sh

# Crypto tests only (no browser mock needed)
node --import tsx --test tests/crypto/*.test.ts

# Wizard state machine + popup-gating tests (pure functions, no browser mock needed)
node --import tsx --test tests/wizardMachine.test.ts tests/openPopupForActiveTab.test.ts

# Module tests (need browser mock)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts

# Wallet tests (mix of pure functions and browser-mocked tests)
node --import tsx --test tests/wallet/bolt11.test.ts tests/inject-webln.test.ts
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/nwc.test.ts tests/wallet/lnbits.test.ts tests/wallet/lnbits-provision.test.ts tests/wallet/background-handlers.test.ts tests/wallet/permissions.test.ts tests/wallet/approval.test.ts tests/wallet/types.test.ts tests/wallet/index.test.ts
```

`tests/run.sh` runs crypto, wallet protocol, pure/UI helper and browser-mocked
module groups. Every test file is registered locally and in CI; registration
checks fail if a new suite is omitted. The mocked signer timeout cases can keep
the last group running for about two minutes even after most tests finish.

---

## 2. Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/crypto/secp256k1.test.ts` | Elliptic curve math, scalar multiplication, public key derivation |
| `tests/crypto/schnorr.test.ts` | BIP-340 Schnorr signature create/verify |
| `tests/crypto/nip01.test.ts` | Event ID computation, event signing |
| `tests/crypto/nip04.test.ts` | NIP-04 encrypt/decrypt, error normalization |
| `tests/crypto/nip44.test.ts` | NIP-44 v2 encrypt/decrypt |
| `tests/crypto/bip32.test.ts` | HD key derivation, hardened/non-hardened children |
| `tests/crypto/bip39.test.ts` | Mnemonic generation, seed derivation |
| `tests/crypto/bech32.test.ts` | Bech32 encoding/decoding, npub/nsec |
| `tests/crypto/utils.test.ts` | Hex/bytes conversion |
| `tests/crypto/security.test.ts` | Security-focused crypto tests |
| `tests/crypto/nip49.test.ts` | NIP-49 `ncryptsec` encode/decode, scrypt parameters |
| `tests/crypto/pq.test.ts` | Post-quantum key derivation vectors, domain separation, sibling-not-child property |
| `tests/crypto/pq-envelope.test.ts` | Post-quantum envelope encrypt/decrypt, self-describing routing, hybrid key |
| `tests/crypto/pq-import.test.ts` | Key-file parsing, length rules, and pair-proving round trips (a public key paired with the wrong secret must be rejected) |
| `tests/crypto/pqc-keygen.test.ts` | The offline `pqc:keygen` CLI |
| `tests/pqc-handlers.test.ts` | `pqc_getStatus` / `pqc_importKeys` / `pqc_removeImportedKeys`, attestation provenance tags, `SafeAccount` leak check, end-to-end decrypt with imported keys |
| `tests/vault.test.ts` | Vault create/unlock/lock, encryption integrity, account management, private key security |
| `tests/permissions.test.ts` | Permission cascade, isolation, save/clear, NIP-07 methods |
| `tests/accounts.test.ts` | Account creation (mnemonic, nsec, npub, nip46), type coverage |
| `tests/signer.test.ts` | NIP-07 signing flow, permission checks, pending request lifecycle, cold-start auto-unlock (the popup must not open for an already-approved request) |
| `tests/security-hardening.test.ts` | NIP-49 zeroing, NIP-04 error normalization, vault reEncrypt, lock zeroing, batch 1-2 regression, KDF work factor + transparent 210k→600k migration, `changePassword` empty-password guard, `withPrivkey` zeroing, and the onboarding no-plaintext-secret rules |
| `tests/communication.test.ts` | Full communication test suite (see below) |
| `tests/wizardMachine.test.ts` | Onboarding wizard state machine transitions |
| `tests/openPopupForActiveTab.test.ts` | Popup-opening gating (opens only for the active tab) |
| `tests/inject-webln.test.ts` | Injected `window.webln` provider surface |
| `tests/domain-handlers.test.ts` | Domain allowlist / identity-disable handlers |
| `tests/relay.test.ts` | Relay utilities, liveQuery streaming, inbound event signature verification (forged events rejected), exhaustion when relays close without EOSE |
| `tests/rpc.test.ts` | Popup `rpc()` transport: envelope unwrapping, Chrome wakeup-rejection retry, Safari undefined-response retry (throws `RpcError` instead of resolving `undefined`) |
| `tests/delete-recreate.test.ts` | Delete last account / destroy vault → re-run onboarding (`onboarding_generateAccount` + `onboarding_createVault`), incl. simulated service-worker restart |
| `tests/publish-handlers.test.ts` | `checkRelayHealth` SSRF hardening (scheme allowlist, private-host rejection) |
| `tests/safeUrl.test.ts` | `safeImageUrl` sanitizer for untrusted profile image URLs |
| `tests/site-state.test.ts` | Per-site state helpers |
| `tests/wallet/nwc.test.ts` | NWC provider: connection, balance, pay, make invoice (msats), response verification/DoS hardening |
| `tests/wallet/lnbits.test.ts` | LNbits provider: REST API calls, error handling, HTTPS enforcement |
| `tests/wallet/lnbits-provision.test.ts` | Auto-provisioning: challenge-response flow |
| `tests/wallet/bolt11.test.ts` | BOLT11 decoder: amount parsing, descriptions, expiry, networks |
| `tests/wallet/background-handlers.test.ts` | Wallet background RPC handlers |
| `tests/wallet/permissions.test.ts` | Wallet permission checks |
| `tests/wallet/approval.test.ts` | Payment approval flow |
| `tests/wallet/lnurl.test.ts` | LNURL-pay / Lightning Address: address parsing, the URL safety guard, pay-param fetching |
| `tests/wallet/payment-intents.test.ts` | A payment happens at most once however many times the popup asks — `rpc()` retries three times when the port closes without a reply |
| `tests/vault-wallet.test.ts` | Wallet config inside the vault: storage, isolation per account, survival across lock |
| `tests/vault-lock-race.test.ts` | The popup must not be told "locked" while the unlock that will succeed is still running |
| `tests/vault-auto-unlock.test.ts` | `isVaultOpen` — never-lock auto-unlock kept behind its mode check, so a blind probe cannot spend the user's brute-force budget |
| `tests/profile-read.test.ts` | A kind:0 read must say whether anyone answered; merging into the result of a silent read publishes a profile with fields erased |
| `tests/profile-metadata.test.ts` | The kind:0 read-modify-write behind Edit Profile — publishing replaces the whole event |
| `tests/relay-cache.test.ts` | The background's cached-first relay reads; an unreachable read is never cached and never evicts a real answer |
| `tests/activity.test.ts` | The activity log's grouping and filtering, and the account/type filter option builders pulled out of `ActivityOverlay` |
| `tests/approval.test.ts` | The approval queue's decision logic — which pending requests a given site may be shown |
| `tests/permissions-ui.test.ts` | The permission-screen decision helpers |
| `tests/pqc-state.test.ts` | What the post-quantum surfaces say; an unreachable relay read is not "nothing is published" |
| `tests/signer-pq-refusal.test.ts` | Accounts that cannot do post-quantum must say so — `nip44.schemes` advertises what the signer accepts |
| `tests/inject-nip44-schemes.test.ts` | The capability marker on `window.nostr.nip44`, checked against the built bundle |
| `tests/tx-filter.test.ts` | The wallet transaction filter |
| `tests/tx-pager.test.ts` | The wallet's paged transaction accumulation |
| `tests/invoice-expiry.test.ts` | Invoice expiry and the transaction-row date, both taking `now` as an argument |
| `tests/send-target.test.ts` | The Send box pays what the field says, or nothing — the debounce window between edit and resolve |
| `tests/active-tab-domain.test.ts` | Naming the current site without permission to read its URL |
| `tests/password-pair.test.ts` | The "new password, twice" rule, which had eight hand-written copies |
| `tests/password-pair-fields.test.ts` | `PasswordPairFields`'s live checklist — both requirements at once, not just the first `validatePasswordPair` reports |
| `tests/crypto/key-backup.test.ts` | A backup file has to be readable again — the encryption that was inline in the seed-export modal |
| `tests/i18n-keys.test.ts` | Every string the UI asks for exists, in every locale, with the same placeholders |
| `tests/theme-tokens.test.ts` | Every `var(--x)` resolves, and no declaration is malformed by a stray bracket — both fail silently in CSS |
| `tests/paged-list.test.ts` | `paginate` — the client-side "load more" window shared by the contexts |
| `tests/format-time.test.ts` | `classifyDay` — the today/yesterday boundary behind the activity log's day headers |
| `tests/button.test.ts` | Shared input, select, dropdown, add/remove and publish control rendering, validation gates, label/error associations and stable field wrappers |
| `tests/mute-state.test.ts` | Missing, failed, empty, private-only and public mute-list states; public key and hashtag validation |
| `tests/status-notice.test.ts` | Server-rendered notice content, warning/error tones, wrapping structure and keyboard tooltip |
| `tests/cn.test.ts` | `cn()` — that a caller's utility overrides the component's, and that a font size and a colour are not mistaken for one conflict |
| `tests/tailwind-classes.test.ts` | Every static Tailwind utility the source names generates a rule — a misspelled utility is silent, and the compiler never sees these strings |
| `tests/css-selectors.test.ts` | No stylesheet selector names a class nothing puts on an element — the rule that survives an extraction and applies to nothing |
| `tests/test-registration.test.ts` | Test registration, documentation paths, release metadata and domain/service/library boundaries |
| `tests/wallet/types.test.ts` | WalletConfig type guards |
| `tests/wallet/index.test.ts` | Provider factory and caching |

---

## 3. Communication Test Suite (`tests/communication.test.ts`)

The most comprehensive test file, with 117 tests across 22 suites covering 6 layers:

| Layer | Suites | Tests | What it covers |
|-------|--------|-------|----------------|
| 1. Content Script Validation | 3 | 13 | NIP-07/WebLN allowlists, HTTPS enforcement, method prefixing, channel isolation |
| 2. Background Handler | 2 | 23 | Privilege gate, `validateNip07Params` (event shape, pubkey format) |
| 3. End-to-End Flow | 4 | 10 | getPublicKey + signEvent round-trips, error propagation, message shapes |
| 4. Account Switching | 3 | 13 | Vault state transitions, pending rejection, pubkey/key after switch |
| 5. Vault Locked | 3 | 21 | All vault APIs when locked, signer behavior, pending request lifecycle |
| 6. Permissions x Lock | 4 | 29 | Full permission/lock matrix, kind/domain isolation, wildcard deny, cascade |

---

## 4. Test Infrastructure

| File | Purpose |
|------|---------|
| `tests/helpers/browser-mock.ts` | In-memory mock for `browser.storage.{local,sync,session}`, `browser.runtime`, `browser.action`, `browser.tabs` |
| `tests/helpers/register-mocks.ts` | Registers the browser mock via Node.js module loader hooks |
| `tests/helpers/loader-hooks.ts` | Custom loader that intercepts `src/lib/browser.ts` imports and redirects to the mock |
| `tests/run.sh` | Shell script to run all test groups in sequence |

Activity review regressions live in `tests/activity-decrypt.test.ts` (recorded account, locked/missing keys, ciphertext-only logs, classic/PQ and gift-wrap decryption), `tests/activity-detail.test.ts` (safe content rendering, unavailable bodies, validated decryption controls, approval isolation), and `tests/favicon.test.ts` (in-flight/persistent cache reuse and network fallback). All run in the browser-mocked group locally and in CI.

`tests/profile-images.test.ts` covers avatar/cover upload reuse and partial retries, unsafe returned URLs, safe cover previews, backup-warning ordering, and the post-quantum status/key presentation. It runs in the browser-mocked group. Shared field-surface checks are in `tests/button.test.ts`.

`tests/relay-cache.test.ts` reproduces the relay-cache notification feedback loop and verifies that ten potential notification cycles stop after one network read. It also checks that twenty concurrent cold readers and two hundred subsequent fresh readers share one query, while stale-cache refresh and unreachable-answer preservation continue to work.

`tests/relay-list.test.ts` covers NIP-65 flags, newest verified event selection, socket closure, empty published lists, missing events and network failure. `tests/profile-images.test.ts` also covers multiline About, image dialogs and site-scoped permission scrolling.

Activity detail rendering tests cover one shared header, compact kind-specific rows, middle-shortened keys, and a selected-item dialog with JSON/decryption controls. Account UI tests in `profile-images.test.ts` cover the picker scrim, selected state, pinned Add account action, absent edit/copy row controls, and the top-bar npub/hex copy control.

Publication regression tests cover public relay discovery while locked, newest PQ event selection, exhaustion versus EOSE, verified evidence surviving empty/offline replies, and successful publishing racing an old negative read. State/UI tests cover failed PQ refreshes, changed accounts/keys, account-switch completion ordering and shared menu/icon colors.

Wallet history regressions are covered by `tx-pager.test.ts` (pending pages, offsets, errors), `wallet/lnbits.test.ts` (raw page preservation), `wallet/background-handlers.test.ts` (the actual startup-unlock/history handler), and `tests/wallet-ui.test.ts` (retry, filtered empty states, pagination and status presentation). `profile-read.test.ts` verifies that hundreds of missing/offline metadata reads share three relay connections, with a new read allowed after the cooldown expires.

Relay publication regressions in `tests/publish-handlers.test.ts` cover visible defaults versus missing storage, exact UI snapshots, empty/all-disabled rejection, and acknowledgement-only caching. `tests/relay-list.test.ts` covers first-account discovery, recoverable local configuration, and the disabled apply action for an empty publication. The wallet UI suite also converts a synthetic LNbits response matching the reported pending-record shape and verifies that it renders as a pending request, including when the provider supplies a preimage.

Wallet cache regressions run in `tests/wallet/background-handlers.test.ts` (startup presence, account isolation, display-field allowlist, revision invalidation, disconnect and account/vault erasure) and `tests/wallet-ui.test.ts` (hydrate before refresh, preserve data on failure, late-response suppression, inline balance loading). `tests/wallet/lnbits.test.ts` verifies the server-side pending exclusion and ordering query; `tests/tx-pager.test.ts` verifies paging past more than 500 pending invoices and cancellation of stale scans.

Wallet UI tests cover independent settings reads, partial failure, stale-response suppression, unknown address loading and payment-dialog labels/spacing. Wallet background tests cover the settings startup gate; provisioning tests assert HTTP failures do not become missing addresses.

Wallet UI regressions assert the bounded settings scroll region, explanatory action labels and SVG copy controls that do not render connection credentials.

HomeWalletLayout regression coverage keeps the wallet visible through loading/restricted/unconnected site notices and normal site controls.

Approval tests cover cross-origin account filtering, foreign authors, account-separated grouping, and snapshot batch decisions that exclude later arrivals and await partial failures. Signer tests cover foreign-author rejection under an existing allow rule and foreign-account single/batch rejection. Signer fixtures persist public account metadata like real onboarding so locked-vault requests retain a verifiable identity. ApprovalCard rendering is covered in wallet-ui.test.ts.

`communication.test.ts` executes the actual content script and background port listener in isolated VM contexts. Regressions cover simultaneous delivery before approval, out-of-order replies, request IDs on permission denial, channel isolation, disconnect cleanup and reconnection.

Approval group regressions verify live arrivals/removals stay within the selected account and that the detail view contains every pending event in collapsed rows with one shared decision footer.

Signer popup lifecycle tests cover reuse of an already-visible popup through runtime.getContexts and the extension.getViews fallback, plus normal automatic opening when no popup is present.

Release checks in `tests/test-registration.test.ts` enforce matching package/lockfile/manifest versions, Firefox desktop and Android consent minimums, and the audited required data categories.

## Nostr Connect integration

Run `npm run test:nostr-connect`. `tests/nostr-connect-integration.test.ts` runs a
loopback WebSocket relay and controlled remote signer with disposable test keys.
The production signer handlers, vault, permission checks and nostr-tools
BunkerSigner are real. The browser APIs are mocked. The remote test signer holds
requests until the test approves or rejects them; requests and responses are
signed kind:24133 events with real NIP-44 transport encryption.

Coverage includes bunker connection, QR secret validation/cancellation, remote
signing approval/rejection, concurrent out-of-order replies, NIP-04/NIP-44
operations and rejections, local deny and foreign-author gates, cancellation,
pending-state cleanup, persisted client identity on reconnect, vault unlock and
remote auth URLs. The suite runs locally and in CI with the mocked module group.
No public relay, real account, wallet, browser profile or external signer is used.

These are protocol/handler integration tests, not browser click tests. Existing
communication tests cover the content/background bridge; popup rendering tests
cover the approval surfaces. Actual QR scanning and third-party signer UI still
need a browser/device smoke test. The QR handshake here exercises BunkerSigner;
the onboarding session persistence handlers retain their separate existing tests.

## NWC wallet integration

Run `npm run test:nwc`. `tests/wallet/nwc-integration.test.ts` connects through
the production wallet factory to a loopback WebSocket wallet. The extension's
shared signing/encryption code communicates with an independent nostr-tools
peer using real kind:23194/23195 events and NIP-04 ciphertext.

Coverage includes response subscriptions, alias/balance, sats/msats conversion,
deposit invoices and settlement lookup, history offsets and settled-only queries,
payment success and errors without automatic retry, concurrent responses,
wrong-author/forged/undecryptable/unrelated replies, pending-request rejection on
disconnect and provider reconstruction. Tests use synthetic invoices and fixed
throwaway keys; no Lightning node or real payment is involved. Existing mocked
NWC unit tests retain timeout coverage. Both suites run locally and in CI.

## Website payment integration

Run `npm run test:payments`. `tests/wallet/payment-integration.test.ts` executes
actual `inject.ts` in a page VM and forwards its messages to real wallet/signer
handlers. An HTTP server emulates LNbits; controlled LNURL responses exercise
Lightning Address resolution, amount verification and payment-intent replay.
The suite covers WebLN discovery/consent, backend-aware capability reporting,
number/string/object invoice requests, invalid amounts, a signed kind:9734 zap
request followed by invoice payment, rejection and provider errors.

This harness replaces browser message transport (covered separately by
communication.test.ts) and external payment services. It does not send real
funds or verify a recipient's kind:9735 receipt publication.

CI and `tests/run.sh` build before any tests. `tests/test-registration.test.ts` guards this ordering; clean GitHub runners have no pre-existing `dist/assets`. Do not run a build concurrently with CSS tests.

LNURL tests cover checksum/case/UTF-8 validation, unsafe decoded endpoints,
non-payment tags and recipient changes. Payment integration runs the same
resolve/pay/deduplicate/amount-mismatch flow for Lightning Addresses and bech32 LNURLs.

The boundary checks in `tests/test-registration.test.ts` keep domain modules free of service, browser and React dependencies, keep `src/lib/` limited to crypto and the browser shim, and enforce canonical constant declarations and side-effect-free constant imports. Existing behavioral suites import the moved modules directly.

`tests/account-import.test.ts` covers import-format hints, exact hex lengths, supported mnemonic lengths, whitespace handling, and the distinction between detection and cryptographic validation.

Activity handler regressions in `tests/activity-decrypt.test.ts` verify canonical record storage, per-domain caps and that clearing with filters selects the same records as the domain/UI filter.

Source-boundary tests also reject forwarding re-exports in `src/`, keeping shared
constants, contracts, helpers and icons imported from their original modules.

UI decomposition is covered by server-rendered tests for payment previews, permission
rule lists, copy controls and key-action panels. Formatter tests cover time units,
expiry states and public-key fallback rendering. Utility boundary checks prevent
application services, domain modules and browser/crypto imports from returning to
generic utilities. Interactive hook lifecycles still require browser validation.

Entry-point regression checks verify source ownership and the manifest/Vite paths.
The CSS/build suite also verifies that all three packaged HTML documents reference
existing scripts and styles. Prompt and wizard tests cover the extracted views.

Profile-image tests cover shared image/profile rendering, object-URL disposal and initial hook state. Mute-state tests cover async scope invalidation, immutable unique merges and replaceable timeout cleanup. Hook render checks use SSR; mounted effect transitions still require browser verification.

Vault and signer suites exercise the composed vault account/PQ operations and import extracted signing queue/identity/decryption functions from their owners. Button tests cover named presets and registration checks require implementation entrypoints at `Component/index.tsx`.

Wallet background regressions exercise the real handler during a deferred startup unlock and after a genuine lock. Vault-state tests verify that retired successful and failed reads cannot overwrite a newer unlocked state.

Mounted React lifecycle and interaction regressions use jsdom in wallet-ui.test.ts. jsdom and its TypeScript declarations are development-only; they are not extension runtime dependencies. Coverage includes wizard continuity through account switching, nested deletion confirmation and approval callback selection.

Custom derivation tests cover path normalization and bounds, network-prefix recognition, standard-key compatibility, duplicate rejection, seed selection, persisted paths, removal/recovery, UI preview invalidation, and path-specific PQ status/export/decryption with pinned public-key vectors.

Mounted sub-account tests cover automatic npub/hex previews, collapsed Advanced,
manual name persistence, serialized path requests, stale responses, failure retry
suppression, and preventing saves while the current preview is unavailable.

The mounted wallet UI test switches accounts repeatedly and checks that selection
updates and the current tab is queried for refresh without remounting popup content.

Rejection regressions in signer.test.ts cover automatic rejection despite standing
permission, concurrent writes, bounded metadata retention, no content retention,
red badge priority, acknowledgement races, worker cleanup, RPC input validation
and malformed event authors. wallet-ui.test.ts covers summary rendering and failed/
successful acknowledgement. Native Chrome popup focus/closure still requires
manual verification; mocked tests do not prove browser-window behavior.

Home balance visibility tests cover connected, disconnected, loading, restricted
and error states; only confirmed connection renders the home wallet summary.

### Account-switch popup recovery

The account switch arms one background reopen attempt after 100 ms, immediately
before triggering the page reload. Module tests cover the delay, native refusal
without retry, successful opening, superseded timers and tab/window activity guards.
The mounted account-provider test covers recovery registration and page reload
routing/fallback. Chrome manual testing confirmed closing followed by reopening;
this is recovery, not prevention of the underlying native closure.
Temporary diagnostics UI, lifecycle listeners and trace collection are removed.

Wallet profile-address tests cover a matching cached lud16, a different or missing
address, publication cache updates, reopening and account isolation.

### September 2026 security audit regressions

`tests/security-hardening.test.ts` imports `tests/security-audit-regressions.ts`, so
both the local full suite and existing GitHub module-test step exercise the real
payment/signing handlers against mocked wallets. These are negative regression tests:
account switches (including A → B → A), lock and provider replacement must reject
stale work; account-specific deny overrides auto-approval and remembered decisions
stay in the correct account bucket. A normal authorized payment still succeeds.

`tests/vault.test.ts` exercises lock/destroy while unlock is suspended. Transport,
response-size, timeout and disposal cases live in the LNbits/provision/NWC suites;
redirect testing uses two loopback origins and synthetic API keys. Queue/ingress and
early-payload bounds are covered by signer, communication and crypto tests, including
capacity retained for canceled remote requests until actual settlement.

These tests never use live credentials or real payments. Node loopback tests are not
a substitute for native Chrome/Firefox integration verification.

### Additional privacy and payment hardening

- `tests/wallet/automatic-payment-budget.test.ts`: concurrent, persistent rolling automatic-payment reservations and conservative failure accounting.
- `tests/wallet/payment-hardening.test.ts`: exact milli-satoshi amount and metadata commitment checks.
- `tests/private-cache-regressions.ts` (imported by security-hardening.test.ts): encryption at rest, tampering/record swapping, locked access, password changes, legacy migration, deletion and encrypted payment retries.
- Existing account, communication and domain tests cover explicit safe metadata projections and full-origin permission boundaries.

PQ backup tests cover envelope detection and authenticated decryption. The mounted
profile-images suite covers encrypted file selection, password gating, wrong-password
retry, successful form clearing and unchanged plaintext imports.

Account import tests distinguish PQ-only JSON from mnemonic input. Mounted import
tests cover encrypted seed restoration, wrong-password retry, PQ-only rejection,
nested ncryptsec password separation and plain private-key file import.

Mounted approval tests in `tests/wallet-ui.test.ts` verify that one-time sheet approval resolves displayed IDs with `remember:false` and never saves a standing rule; the separate Always allow action saves the exact origin, permission and account. Detail tests verify one-time versus remembered callbacks and disabled actions.

### Remote signer compatibility matrix

See [remote signer compatibility](remote-signer-compatibility.md) for supported
connection alternatives and explicit gaps. The real-protocol suite now exercises
both production onboarding handlers, shared versus distinct transport/user keys,
QR relay fallback and selection, pairing-secret/client-key persistence, and signing
after saving to the vault. Identity resolution failure/timeout cannot create an
account. These fixtures do not certify native Amber or other provider applications.

`tests/wot.test.ts` covers the 0.8.0 opt-in WoT API, local/remote/hybrid queries,
consent, graph bounds, oracle validation/cancellation, signed relay sync and
actual MAIN-world injection. It is registered in the full suite and CI.


`tests/wot-sync.test.ts` covers automatic refresh additions/removals, empty lists,
stale versions, mute/unmute, account isolation, disabled alarms, busy/retry behavior,
interruption/progress throttling, storage inventory, compact snapshot roundtrips
and batch traversal reuse. Configurable edge/profile limits are tested through sync and mounted settings, including resetting to Unlimited. Mounted WoT tests cover information/progress panels,
scoring validation, automatic-sync settings and preservation of unsaved edits.

Run the opt-in live benchmark (public relay requests, isolated mock browser storage):

```sh
node --import tsx --import ./tests/helpers/register-mocks.ts tests/wot-benchmark.ts <npub>
```

It reports wall-clock sync time up to depth 2 by default (pass a third CLI argument of 3 for three hops), local encoding/decoding and 100-target
lookup time, graph sizes, truncation and relay traffic. Socket durations overlap
and are cumulative, so do not subtract them from wall time. Live results depend
on relay availability and limits; this is not a deterministic CI performance gate.

WoT regressions additionally verify >1,000-entry follow lists, a custom per-profile
cap and its removal, plus diamond/cyclic graphs queried once per author per relay.
A second sync intentionally checks again for edits. Mounted settings tests cover
validation, saving and clearing all three graph-size caps.

A held-open automatic sync regression verifies that repeated alarm ticks do not
queue more crawls. Page RPC instrumentation verifies only one graph storage read
across authorization, query execution and final identity validation.

### Optimized WoT storage and menu

- `tests/wot-numeric.test.ts`: numeric traversal caching, mute invalidation, large graphs and snapshot encoding.
- `tests/wot-relay-transport.test.ts`: pooled relay subscriptions, verification, cancellation and replaceable ordering.
- `tests/wot-storage.test.ts`: IndexedDB snapshots, atomic pointer publication, quota/abort recovery, legacy migration, orphan cleanup and metadata-only progress reads.
- `tests/wot.test.ts`: dedicated sync screen/scoring modal, Save-gated automatic-sync persistence and accessible settings icon, npub/hex score validation, muted zero scores, missing results, retries and stale-result suppression.

`node tests/wot-native-storage.mjs` runs an opt-in native Chrome IndexedDB
roundtrip with a disposable profile and a >40 MiB graph. It uses an isolated HTTP
origin and a small browser-storage shim, not the packaged extension worker.

Daily scheduler tests verify the 1,440-minute interval, migration of existing five-minute alarms, preservation of valid scheduled alarms, and no extra sync on account/settings changes.

WoT menu regressions cover automatic application/reset of valid scoring, invalid
values retaining saved scores, a single scoring-dialog title, and configuration
tooltips. `tests/button.test.ts` covers shared Input hint accessibility and label
association.

Shared tooltip interaction tests in `tests/button.test.ts` cover click/focus and
keyboard opening, Escape/outside/scroll dismissal, parent-event isolation and
viewport positioning. jsdom stubs only the native popover methods. A native
headless Chrome check of all six actual WoT sync-setting tooltips confirmed
`:popover-open`, viewport bounds and hit-test visibility outside the scrolling
container, using built CSS and fixture settings.

Score explanation regressions cover local shortest-path counts and points,
muted targets and intermediates, missing paths, oracle source attribution,
private diagnostic rejection for websites, and rendering of signed/color-coded score contributions and ready/unavailable/private-unavailable mute states. Mounted search
tests exercise the explanation RPC with stale responses, retries and zero scores.

Mounted WoT lookup tests also cover result-modal opening, Escape/close dismissal,
preserved input, profile name/image presentation, npub fallback on profile
failure, independent score loading, and stale profile responses after dismissal.

WoT sync UI regressions cover automatic-sync controls inside settings, one set
of main-card counts, status dots and bounded per-hop percentages. Database
integration tests resync a non-active account, preserve the active identity,
remove only the selected snapshot, and separate shared-cache deletion. Mounted
table tests exercise row targeting and cancel/confirm actions. Orphan snapshots
remain visible/deletable with resync disabled.

Account copy-menu interactions cover both exact clipboard encodings, initial and
arrow-key focus, Escape/outside/focus-away dismissal, successful closure,
clipboard failure feedback and reset on account change. WoT result tests assert
that confirmed empty mute lists produce no notice.

Approval sheet interaction tests cover the top action row and both compact arrow menus: one-time approval/rejection never saves permissions, while remembered allow/deny saves only the selected type’s website, permission and account scope, including when multiple types are pending. Shared action-menu keyboard, dismissal and clipboard failure behavior is covered by the account-copy menu tests.

Sync finalization regression: a delayed completion-status write must keep the single-flight guard held, rejecting another sync until persistence finishes.

Follow-list signing coverage in `tests/signer.test.ts` validates and signs 5,001 contact tags through saved-permission, one-time and grouped approval paths for Primal/Coracle origins, checks exact payload preservation and verifies signatures. It also verifies that intentional removals are not silently merged back. This is an extension signing regression test, not a live-client publication test.

Follow-list guard regressions also cover unique-contact counting, signed evidence,
relay discovery and outage fallback, identity isolation, old-event ordering,
saved-permission and remote-account rejection, and batch-bypass prevention.
The mounted approval-sheet test exercises cancellation and explicit confirmation
through both one-time and always-allow controls.

Follow replacement checks also consult the author’s versioned public follow list in the WoT sync database, respecting newer signed changes. Event details show detected dangerous reductions before approval and reuse the shared split buttons, with Always choices behind the arrows.

Empty kind:3 lists (including client-only tags) require confirmation when any previous follows are known. Warnings display both the previous and proposed counts, including zero. Tests cover local and remote accounts, ordinary/batch approval bypasses, and clearing the last follow.

Approval UI tests verify that grouped duplicate reductions render a single warning on the pending card and confirmation dialog, while confirmation still resolves each displayed request individually.

Appearance regressions live in `tests/theme-tokens.test.ts`: preference validation,
OS and cross-window updates, failed storage reads/writes, mounted theme selection,
AA text contrast for dark palettes, and QR foreground independence from theme text.


### NWC audit coverage

The [NWC audit](nwc-audit.md) maps each wallet flow to its regression coverage and
records compatibility limits. Provider tests cover handshake/request deadlines,
remote close, late replies, malformed result fields and tags, result-type binding,
lookup errors and pending/failed history. The shared loopback fixture exercises
real NIP-04/NIP-44 signatures/encryption; production payment handlers exercise NWC setup, balance,
deposit, lookup, history, consent, approval, deny, vault lock and reconstruction.
A dropped LNURL payment response retains the same intent and proves that replay
never fetches another invoice. Unknown markers do not expire into a second send.

Mounted wallet tests cover NWC setup errors/retry, send guards and close controls,
whole-sat receive validation, polling failure recovery, single paid callbacks,
automatic closure and late replies after unmount. Unknown payment outcomes use a
localized message and prevent another send within the same dialog. Real setup
handler regressions verify `get_info` authorization before replacing saved config,
preservation after failure/lock and persistence of a successful connection.


NWC protocol integration also covers all six methods with NIP-44-only,
dual-cipher, NIP-04 and missing-info peers. Discovery verifies signed kind-13194
advertisements, chooses the newest supported scheme before EOSE and refuses
explicit unsupported modes. Lifecycle tests bound silent discovery, discard late
info, cancel on disposal, and try a second URI relay after a refused connection
without replaying published payments. Provider fixtures normalize Alby nullable
alias/settlement fields and LNbits signed fees/nullable optional values.

Wallet issues #26/#27: `wallet/payment-integration.test.ts` verifies persisted
sender notes in provider history, receipt timing after real signed NWC responses,
no success receipt on denial/error, best-effort receipt persistence, encrypted
account isolation, reconnect/lock retention and disconnect erasure. Provider tests
cover LNbits/NWC comment metadata. `wallet-ui.test.ts` checks Deposit address,
QR/copy and invoice controls, missing/error/loading states, wrapped notes and
receipt site/amount rendering. Browser layout checks use isolated components with
production CSS at popup dimensions; they are not live-fund payment tests.

The website-zap regression in `wallet/payment-integration.test.ts` now signs a real
kind:9734 request, creates a description-hash invoice from the returned JSON, pays via
the injected WebLN API, and checks the message in provider history. It also verifies
mismatched commitments, account isolation, non-zap exclusion and invoice-less history.
LNbits tests cover historical `extra.nostr`, malformed/oversized data and comment priority.
