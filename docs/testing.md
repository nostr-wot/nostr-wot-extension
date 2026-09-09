# Test Suite

Tests use **Node.js built-in test runner** (`node:test`, Node 22+) with the `tsx` loader for TypeScript. No build step required for testing.

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

`tests/run.sh` runs these groups in sequence: crypto, wallet (no-mock),
wizardMachine + openPopupForActiveTab + safeUrl, then the browser-mocked module +
wallet group (vault, permissions, accounts, signer, security-hardening,
communication, wallet permissions/background-handlers, vault-wallet, relay,
publish-handlers). Some additional test files exist in the tree
(`domain-handlers`, `site-state`) that are not part of the default `run.sh`
sequence.

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
| `tests/domain-handlers.test.ts` | Domain allowlist / identity-disable handlers (not in default `run.sh`) |
| `tests/relay.test.ts` | Relay utilities, liveQuery streaming, inbound event signature verification (forged events rejected), exhaustion when relays close without EOSE |
| `tests/rpc.test.ts` | Popup `rpc()` transport: envelope unwrapping, Chrome wakeup-rejection retry, Safari undefined-response retry (throws `RpcError` instead of resolving `undefined`) |
| `tests/delete-recreate.test.ts` | Delete last account / destroy vault → re-run onboarding (`onboarding_generateAccount` + `onboarding_createVault`), incl. simulated service-worker restart |
| `tests/publish-handlers.test.ts` | `checkRelayHealth` SSRF hardening (scheme allowlist, private-host rejection) |
| `tests/safeUrl.test.ts` | `safeImageUrl` sanitizer for untrusted profile image URLs |
| `tests/site-state.test.ts` | Per-site state helpers (not in default `run.sh`) |
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
| `tests/test-registration.test.ts` | Every test file is actually run, locally and in CI |
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
