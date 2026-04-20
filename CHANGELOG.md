# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.3.81] - 2026-04-21

Hotfix on top of 0.3.8.

### Fixed
- **`package:firefox` left `dist/` in a Chrome-incompatible state** — the script mutated `dist/manifest.json` to Firefox's `background.scripts` format and never restored it. Loading the extension unpacked from `dist/` into Chrome MV3 after running `package:firefox` silently registered no service worker (Chrome needs `background.service_worker`), and every RPC failed with "Could not establish connection. Receiving end does not exist." `package:firefox` now re-runs `vite build` after zipping so `dist/` always ends Chrome-compatible.

### Changed
- **Removed diagnostic console logs** — temporary `[BG] Service worker started` and `[HomeTab] RPC failed` logs used during debugging were removed from background.ts and HomeTab.tsx.

## [0.3.8] - 2026-04-20

### Fixed
- **Chrome unpacked-load was broken after `package:firefox`** — `package:firefox` mutated `dist/manifest.json` to Firefox's `background.scripts` format but never restored it afterwards. If you ran `package:firefox` last and then loaded the extension unpacked from `dist/` into Chrome, Chrome MV3 didn't recognise the manifest (needs `background.service_worker`), silently registered no service worker, and every RPC rejected with "Could not establish connection. Receiving end does not exist." `package:firefox` now re-runs `vite build` after zipping so `dist/` is always left in a Chrome-compatible state. This was the actual root cause of the popup error card that replaced "Navigate to a website" on accepted sites.
- **Service worker wake-up hardening** — defense-in-depth around the above: (1) new post-build vite plugin `bundleServiceWorker` esbuild-bundles the SW into a single self-contained IIFE with zero runtime imports, so chunk imports can't race against `onMessage` registration on MV3 wake-up; (2) `runtime.onMessage` and `runtime.onConnect` listeners moved to the top of `background.ts`, before `loadConfig`, migrations, auto-unlock, and `setupTabListeners`, so they attach on the first synchronous tick even if any startup code is slow or throws.
- **RPC retry on transient transport errors** — `src/shared/rpc.ts` retries up to 3 times (100ms / 200ms backoff) on `Could not establish connection`, `Receiving end does not exist`, `The message port closed before a response was received`, and `Extension context invalidated`. Application-level errors returned as `{ error }` are never retried.
- **Popup misrepresented state on accepted sites** — `useSiteState` now uses `Promise.allSettled` and degrades each source to a safe default. The error card only shows when BOTH connection-determining calls (`getAllowedDomains` and `signer_getPermissionsForDomain`) fail. Accepted domains render the normal SiteControls even if supplemental state can't be loaded. Website signing via `window.nostr` was never affected by this bug — the popup misrepresented state but the content-script → background → signer path is independent.
- **Inline retry on error state** — the error card has a Retry button that re-runs the load.
- **Unpaid invoices no longer appear in transaction history** — the LNbits provider filters `pending` entries out of `listTransactions`; only settled and failed payments show up. NWC was unaffected (already passed `unpaid: false`).
- **Deposit modal auto-closes on payment** — creating an invoice now polls the provider every 2s (new `lookupInvoice` provider method + `wallet_checkInvoice` RPC); when the payment is detected the modal shows a "Payment received!" confirmation, refreshes balance/history, then auto-closes.

### Added
- **`home.siteInfoError` and `home.retry` locale keys** — en, es, pt, it, fr, de.
- **`wallet.paymentReceived` locale key** — en, es, pt, it, fr, de.

### Changed
- **Removed diagnostic console logs** — the temporary `[BG] Service worker started` and `[HomeTab] RPC failed` logs used to diagnose the wake-up / manifest issues were removed now that the root causes are fixed.

## [0.3.7] - 2026-04-15

### Added
- **Full-screen lock screen** -- when the vault auto-locks, a full-screen overlay with heavy blur and no cancel button forces password entry to continue; the padlock button is now lock-only (visible only when unlocked)
- **Forgot password / reset vault** -- "Forgot password?" link on the full-screen lock screen with confirmation step; destroys the vault, wipes all accounts, keys, and databases so the user can start fresh
- **Brute-force rate limiting** -- escalating lockout after failed unlock attempts: 5 failures = 1 min lockout, 10 = 5 min, 15 = 15 min, 20+ = 30 min; countdown displayed in real-time; applies to both popup and signing prompt unlock flows

### Changed
- **Lock button removed when locked** -- the padlock icon in the account bar is hidden when the vault is locked (the full-screen overlay handles unlock instead)
- **`onRequestUnlock` prop removed** -- simplified TopBar/AccountBar prop chain; unlock is now driven by vault state, not manual callbacks

## [0.3.6] - 2026-04-15

### Fixed
- **Wallet transaction dates broken** — LNbits API returns `time` as an ISO 8601 string, not a Unix timestamp; `listTransactions` now parses both formats correctly
- **Transaction dates invisible** — bumped date text from 10px/35% opacity to 11px/50% opacity
- **Wallet section not scrollable** — transactions overflowed the popup with no way to scroll; wallet section now scrolls independently without breaking menu hover effects
- **Generic memo on received payments** — transactions with LNbits default memo ("Lightning Address" / "Lightning wallet") now show "Received" or "Sent" instead

### Added
- **Safari support** — Xcode project generated via `safari-web-extension-converter`, with `storage.session` polyfill (falls back to `storage.local` with prefix), Safari-compatible manifest (`scripts` instead of `service_worker`, `host_permissions` instead of `optional_host_permissions`), and encryption compliance flag
- **Transaction filter modal** — filter icon next to the search input opens a centered modal with direction chips (All / Received / Sent) and a date range picker; smart batched fetching accumulates pages until enough filtered results are found
- **Permissions: add rule** — modal to manually add permission rules with preset or custom event kind selector
- **Permissions: compact detail view** — single colored chip per rule with inline dropdown to change decision
- **Continue button on language screen** — first-run wizard no longer requires opening the language picker to proceed
- **Improved date formatting** — transactions older than 7 days show locale-aware short dates (e.g. "Apr 10") instead of "30d ago"; different-year transactions include the year
- **Complete translations** — added 92 missing keys to es, pt, de, fr, it (wallet, permissions, seed export, filters)

### Changed
- **Transaction date display** — recent transactions use relative time (just now, 5m ago, 3h ago, 2d ago); older transactions use short date format
- **Transaction filtering** — direction and date filters now fetch pages from the API in batches of 50, filtering client-side, stopping early when past the date boundary (LNbits API only supports limit/offset)

## [0.3.5] - 2026-03-23

### Added
- **First-visit domain connect prompt** — when an unknown site makes a NIP-07 request, the extension popup opens automatically showing the existing "Connect this site" card; the request waits up to 2 minutes for the user to click Connect, replacing the previous silent rejection
- **Dismissed domains** — domains the user has previously declined are silently rejected on subsequent NIP-07 requests; manually connecting a dismissed domain via the GlobeButton clears the dismissal
- **`waitForDomainAllowed()`** — background utility that listens for `storage.onChanged` to detect when a domain is added to the allowlist
- **Tests** — `domain-handlers.test.ts` with 10 tests covering dismissed domain CRUD and interaction with allowed domains

### Changed
- **NIP-07 domain gate** — unknown domains now trigger the popup instead of silent rejection; dismissed domains are still silently blocked
- **NIP-65 relay discovery (outbox model)** — sync engine now fetches kind:10002 relay list events alongside kind:3 contact lists, storing per-pubkey read/write relay preferences in a new `relay_lists` IndexedDB store (DB v3) with in-memory cache and batched writes
- **Relay pool with dynamic connection expansion** — tracks which relays are endorsed by follows' write-relay declarations; after depth-0 sync completes, top-endorsed relays are connected automatically (up to 10 total connections)
- **Outbox-aware profile fetching** — `fetchProfileMetadata` and `fetchMuteList` now prepend the target pubkey's declared write-relays before falling back to configured relays
- **WoT API: `getRelayList(pubkey)`** — returns a pubkey's stored NIP-65 relay list (read/write preferences) via `window.nostr.wot`
- **WoT API: `getRelayPool()`** — returns the top 50 relays ranked by follow endorsement count via `window.nostr.wot`
- **Relay URL normalization** — `normalizeRelayUrl()` lowercases and strips trailing slashes for consistent deduplication
- **Relay list parsing** — `parseRelayListTags()` extracts read/write relay entries from kind:10002 event tags with deduplication, wss-only filtering, and a 20-entry cap
- **Relay discovery constants** — `RELAY_POOL_MAX_SIZE`, `RELAY_POOL_MIN_ENDORSEMENTS`, `MAX_RELAYS_PER_EVENT` in `lib/constants.ts`
- **Storage stats** — `relayListCount` added to `StorageStats` type and `getStats()` output
- **Tests** — `sync-relay-discovery.test.ts` (pure function tests for parsing, normalization, relay pool), `storage-relay-lists.test.ts` (IndexedDB relay list storage with fake-indexeddb)
- **Dev dependencies** — `fake-indexeddb`, `ws`, `@types/ws` for relay discovery testing

## [0.3.4] - 2026-03-14

### Fixed
- **WebLN zaps broken in Coracle and other clients** — `webln_getInfo` was missing the `supports: ['lightning']` field that clients check to verify Lightning capability; `webln_enable` now adds the requesting domain to the allowed domains list (the standard WebLN connection handshake)

## [0.3.3] - 2026-03-13

### Changed
- **Comprehensive code review (Round 2)** — 10 parallel Opus agents audited the full codebase covering security, performance, code quality, dead code, documentation accuracy, and future enhancements; 70 new findings documented in `docs/code-review.md`
- **Misc-handlers split** — `misc-handlers.ts` (507 lines) split into `activity-handlers.ts`, `profile-handlers.ts`, `publish-handlers.ts`; original file is now a re-export facade
- **Graph module hardened** — underscore-prefixed methods replaced with `private` modifier; all 11 internal call sites updated
- **NIP-07 input validation** — added `event.tags` validation (array of string arrays) and `event.created_at` validation (integer, not >1 hour in future)
- **signEvent zeroing contract** — comprehensive JSDoc documenting caller responsibility for key zeroing
- **LNbits HTTP warning** — console.warn added when admin key is sent over non-localhost HTTP

### Fixed
- **Permission cache test failures** — added `storage.onChanged` support to browser mock so in-memory caches invalidate correctly between tests
- **Wallet balance assertions** — fixed msats-to-sats conversion in NWC test mocks (values now in millisats, expected results in sats)
- **Import extensions** — standardized all 17 test files from `.js` to `.ts` import extensions
- **nostr-tools/pure removal** — replaced `generateSecretKey`/`getPublicKey` imports with own crypto; only `nostr-tools/nip46` remains
- **IDB upgrade deduplication** — extracted shared `upgradeDatabase()` helper from duplicate `onupgradeneeded` callbacks
- **NODE_ENV** — changed from `'development'` to `'production'` in vite.config.ts

### Added
- `lib/constants.ts` — centralized magic numbers (timeouts, rate limits, crypto parameters)
- `lib/utils/async-lock.ts` — shared async mutex (extracted from duplicated `withStorageLock` pattern)
- `lib/bg/activity-handlers.ts` — activity log handlers with write buffering
- `lib/bg/profile-handlers.ts` — profile metadata and mute list handlers
- `lib/bg/publish-handlers.ts` — event signing, broadcasting, and NIP-46 session handlers
- `docs/code-review.md` — comprehensive Round 2 audit with 70 findings and prioritized roadmap

## [0.3.2] - 2026-03-10

### Changed
- **Modularized background service worker** — split the monolithic `background.ts` (~2800 lines) into 8 focused handler modules under `lib/bg/`: state, wot-handlers, misc-handlers, domain-handlers, vault-handlers, wallet-handlers, nip07-handlers, onboarding-handlers; background.ts is now a ~300-line orchestrator with Map-based dispatch
- **Code quality improvements** — eliminated duplicate types (`DistanceInfo`, `LocalAccountEntry`), extracted shared helpers (`resetLocalGraph`, `buildStrategyCSS`, `withIdentityGuard`), converted key zeroing to try/finally pattern, removed dead code and unnecessary exports

### Fixed
- **Sats display shows whole numbers** — wallet balance, transaction amounts, invoice previews, and payment prompts no longer show decimal fractions
- **Wallet setup banner persists after setup** — the "Set up wallet" banner on the home screen now disappears immediately after configuring a wallet, instead of requiring a restart

## [0.3.1] - 2026-03-10

### Changed
- **Unminified builds** — all production builds (Chrome and Firefox) now output fully readable, unminified JavaScript including vendor dependencies (React, ReactDOM); required for store review compliance
- Vite config enforces `minify: false` and resolves development builds of all dependencies
- Removed redundant `--minify false` CLI flags from package scripts (now enforced at config level)

### Fixed
- Firefox and Chrome store submissions were rejected due to minified/obfuscated code in bundled output

## [0.3.0] - 2026-03-09

### Added
- **Lightning Wallet (WebLN)** — built-in Lightning wallet support with WebLN provider (`window.webln`) for sending and receiving zaps directly from Nostr clients
- **Quick Wallet Setup** — one-click wallet provisioning via zaps.nostr-wot.com with challenge-response authentication; no account registration needed
- **Lightning Address** — claim a `username@zaps.nostr-wot.com` address to receive payments; view, copy, add to profile, and unlink from wallet settings
- **BOLT11 invoice decoder** — lightweight payment request parser for previewing invoice details (amount, description, expiry) before sending
- **LNbits manual connect** — connect your own LNbits instance with admin key
- **NWC connect** — connect any Nostr Wallet Connect compatible wallet
- **NWC auto-provisioning** — provisioned wallets automatically get an NWC connection URI for use in other apps
- **Wallet UI** — balance display, deposit invoices with QR codes, send modal with invoice preview, auto-approve threshold for zaps
- **Wallet balance card** — home screen shows current wallet balance with quick access to wallet settings
- **WebLN permission system** — per-domain approval for `sendPayment` with remember option
- **Payment approval overlay** — pending zap requests shown in popup with approve/deny actions
- **Unlock modal improvements** — shows pending signing requests with per-request cancel and cancel-all options

### Changed
- **Port-based messaging** — NIP-07 and WebLN requests use persistent port connections to keep the service worker alive during long operations (vault unlock, NIP-46 remote signing)
- **WebLN `enable()` always succeeds** — apps that call `enable()` on page load (like Primal) no longer get permanently locked out when the vault is locked
- **Version moved to single source of truth** — extension version is read from the manifest at runtime instead of being duplicated across locale files
- Manifest description updated to "Nostr identity provider, NIP-07 signer, and Web of Trust provider"

### Fixed
- **Auto-unlock removed** — popup no longer forces vault unlock on every open; unlock only triggered by explicit user action or pending signing requests
- **Service worker lifetime** — NIP-07 and WebLN operations no longer fail when Chrome suspends the service worker mid-request
- **WebLN payment approval was invisible** — `webln_sendPayment` requests were missing `needsPermission: true`, making them appear in the badge count but not in the approval overlay
- Removed stale debug `console.log` statements from NIP-07 and WebLN handlers

## [0.2.0] - 2025-02-24

### Added
- **NIP-07 Identity Provider** — full `window.nostr` signer (getPublicKey, signEvent, getRelays, nip04, nip44)
- **Encrypted Key Vault** — AES-256-GCM with PBKDF2 (210,000 iterations), auto-lock timer
- **Multi-account support** — generated (BIP-39/NIP-06), imported nsec, watch-only npub, NIP-46 bunker, external signer
- **Per-account IndexedDB** — each identity gets its own `nostr-wot-{accountId}` database
- **Onboarding wizard** — first-run setup flow for account creation and import
- **Signing prompt system** — popup window for approving/denying NIP-07 requests with remember option
- **Permission system** — per-domain, per-method, per-event-kind permission storage and cascade
- **NIP-46 Nostr Connect** — remote signing via bunker:// URLs
- **WoT trust badges** — visual hop-distance badges injected into Nostr web clients (Primal, Snort, Nostrudel, Coracle, Iris, generic fallback)
- **Activity logging** — tracks signing operations per domain (capped at 200 entries)
- **Pure JS crypto library** — secp256k1, Schnorr (BIP-340), NIP-01, NIP-04, NIP-44, BIP-32, BIP-39, bech32
- **Internationalization** — i18n support with English and Spanish locales
- **Test suite** — node:test based tests for crypto, vault, signer, permissions, accounts
- **CI pipeline** — GitHub Actions workflow for automated testing
- **CONTRIBUTING.md** — contributor guide with project structure and guidelines
- **docs/architecture.md** — full technical architecture reference
- **docs/add_badge.md** — guide for adding badge support to new Nostr clients
- **SECURITY.md** — security model documentation

### Changed
- **API: `isConfigured()` → `getStatus()`** — returns `{ configured, mode, hasLocalGraph }` instead of a boolean
- **API: removed `getDistanceBetween()`** — third-party distance queries removed for privacy (surveillance vector)
- Precomputed BFS cache with O(1) lookups via typed arrays (Uint8Array hops, Uint32Array paths)
- Delta-encoded follow storage format (sorted Uint32Array deltas)
- Background rate limiter: 10 req/sec per method (sliding window)
- Privileged method gating via sender ID verification
- Version bump to 0.2.0

### Fixed
- Sync crash when triggered without a valid pubkey
- Graph syncing reliability improvements

## [0.1.1] - 2025-02-17

### Added
- Firefox support (requires Firefox 128+)
- Cross-browser compatibility layer (`browser.*` API)
- npub format support for pubkey input (in addition to hex)
- `DEPLOY.md` with deployment instructions for Chrome and Firefox stores
- `data_collection_permissions` declaration for Firefox

### Changed
- Replaced unsafe `innerHTML` usage with safe DOM methods
- Updated minimum Firefox version to 128.0 for full MV3 support
- Improved pubkey validation to accept both hex and npub formats

### Fixed
- Firefox extension URL detection (added `moz-extension://` support)

## [0.1.0] - 2025-02-15

### Added
- Initial release
- Chrome Web Store publication
- Web of Trust distance queries
- Local graph sync from Nostr relays
- Remote oracle support
- Trust score calculation
- Per-domain permission system
- `window.nostr.wot` API for web pages
