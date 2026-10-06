# Changelog

Notable changes per release. Store-facing copy appears under **Store release notes**.
See [deployment](docs/deployment.md) for packaging and submission requirements.

## 0.8.11 — 2026-10-06

### Store release notes

- Add Account Archive in Settings: manual or scheduled sync across all selected relays, encrypted local storage, relay groups and resumable checkpoints.
- Sync relays concurrently with shared deduplicated storage. Show event counts, archive size, progress, error details and independent per-relay retries.
- Export and import password-encrypted archives. Migrate eligible original signed events to a verified destination after confirmation, retry failures once after the first pass, and inspect remaining failed events.
- Authenticate archive queries when relays request it, including responses prefixed with `ERROR:`. Retry recoverable failures up to three times and report relay configuration failures accurately.
- Prevent stalled language or theme initialization from leaving the popup blank by rendering bundled defaults after a bounded wait.

### Archive

- Configure hourly, daily or weekly automatic sync, or sync manually. Archive settings use profile relays by default, reusable relay groups and validated custom relay URLs. Archive does not add an onboarding step.
- Preserve existing records and per-relay checkpoints during retries. Event counts include verified events already stored; the archive total stays deduplicated. Continue active work between bounded slices without waiting for another alarm.
- Keep migration progress, results and pause controls inside Migrate archive. Start migration checks the destination with a normal bounded query and opens a confirmation before publishing. Migration preserves local data and original signatures, and skips ineligible events.
- Resume the failed-event retry pass after worker interruption. Show remaining event IDs, kinds, dates, relay responses and attempt counts in Failed events.

### Popup startup

- Render bundled English and theme defaults after 1.5 seconds if preference initialization stalls, then apply saved preferences when available. Preserve the existing splash and fade timing.

### Maintenance

- Pin the test-only DOM dependency to a working version and make the remote-signer refusal fixture use an unlocked test vault, preventing stalled compatibility tests without weakening production unlock checks.
- Document Archive storage, authentication, import/export and migration boundaries, and update source-build and Mozilla reviewer instructions.

## 0.8.10 — 2026-10-02

### Store release notes

- Keep login available for explicitly supported clients that use a nonstandard authentication format. Show a prominent risk warning explaining that the client uses the wrong authentication standard, and ask users to contact its developers about NIP-98. Require separate one-time approval for every request; preserve frame, origin, account and timestamp checks. Backend automation and saved relay grants never authorize this format.

- Open an optional feedback form after uninstalling the extension in supported browsers. No account identifiers, wallet data or tracking parameters are added to the URL.

## 0.8.9 — 2026-10-01

### Store release notes

- Show zap amounts in sats, including fractional sats, alongside the recipient and comment. Clearly distinguish signing a zap request from paying its invoice.
- Show Lightning invoice amounts in individual and grouped payment approvals, and explain wallet connection access. Missing or ambiguous amounts are never presented as zero.
- Require separate detail review for zap and wallet requests instead of including them in the queue’s Approve all action.
- Automatically supersede older store reviews and recognize Mozilla’s formatted release notes, with duplicate-submission and downgrade protection.

### Approval clarity

- Reuse the verified public-profile cache for zap recipients. Keep raw event inspection available and escape comments as text.
- Keep amounts visible on single-request queue cards and on every grouped payment, without expanding a section. Preserve the existing signing, wallet-access and payment permission boundaries.
- Translate the new review copy into all six extension languages.

### Publishing automation

- Verify Mozilla-rendered changelog lists by their text and item boundaries, so successful submissions are not reported as failures merely because Markdown became HTML.

- Automatically supersede older store reviews when publishing a newer stable release, skip duplicate submissions and reject stale downgrades. Remove release-specific Chrome replacement variables.
- Add a recovery entry point for existing published releases, preserving their verified packages, source and exact-commit CI checks while using corrected publishing tooling.

## 0.8.8 — 2026-10-01

### Store release notes

- Correct the confirmation shown after a successful vault password change.

- Manage shared Global rules and the current website's overrides in dedicated screens. Existing shared rules migrate automatically; resets ask for confirmation and stay on the current screen.
- Optional Default backend auth starts off for each account. It supports exact same-origin HTTPS backends and verified NIP-98 registry pairs, with saved denials taking priority. The backend screen shows its status and policy link.
- Manage relay authentication by relay and selected connected apps, or explicitly all connected sites. Deselecting an app switches to specific-site approval; clearing all selections revokes allows.
- Clearer signing previews, compact approval menus, consistent Deny labels and group-creation event support.
- Improved account setup with cached public profiles, copyable keys, clearer Advanced controls and a compact completion summary. Profile image edit controls remain readable over light and dark photos.

### Permissions and authentication

- Replace the All accounts switch and saved-site list with Global rules and current-tab Site rules. Gray rows inherit the visible global defaults; colored rows show account/site overrides. Editing an inherited rule creates an override, and Use inherited default removes it.
- Migrate legacy shared defaults once into the global bucket, preserving conflicting site choices as explicit overrides and removing hidden account-wide layers. New-account setup uses globals or copies site overrides. Connection consent and authentication grants remain separate.
- Confirm Reset site overrides and Reset all account overrides. Site resets refresh in place and leave only global inheritance; authentication grants are preserved. Declined current sites have a duration editor for one week, one month, one year or forever.
- Place Add rule beside the site name, with a Global rules footer link and a Go to current site rules button in the global editor. Use distinct icons and aligned navigation rows.
- Add an off-by-default, account-specific NIP-98 policy for connected websites at exact same-origin HTTPS destinations or registry pairs explicitly verified for NIP-98. The policy covers valid paths and methods, preserves denial precedence and never creates individual saved grants. Disabling it leaves explicit grants intact.
- Show enabled policy status and the rules/registry link above the backend grants table. Refresh saved grants and policy status after background changes, scoped to the active account.
- Give backend and relay authentication separate menu screens with back navigation and information controls. Group relay grants by destination with site counts, all-sites scope and denial exceptions.
- Allow removing individual apps from an all-sites relay grant, switching to a specific-site set. Empty selections revoke allows while preserving denials. Saves work with a locked vault and reject stale account sessions.

### Request review and account setup

- Read the vault password-change response correctly, showing success after a completed change and retaining retryable errors for failures.

- Keep split-button menus visible above clipped approval sheets with viewport-bounded popovers; use compact labels and consistent Deny wording.
- Show note content and supported event-specific previews in single and grouped signing review, including repost text. Keep raw metadata in the code-icon popup. Recognize NIP-29 kind 9007 with a create-group intent and preview.
- Remove the redundant seed-account row in sub-account creation. Display shortened npub and hex keys below their labels with full-value copy buttons. Move the accent-colored, marker-free Advanced control beneath the keys with clear spacing before the path editor.
- Load follow suggestions through the shared verified purplepag.es profile reader and bounded cache (30 minutes, up to 500 profiles). Display avatar/name when available without blocking selection or skipping.
- Add spacing below both Nostr Connect tabs. Bottom-align the completion summary and Get Started action, with a copyable public key and seed-derivation wording only for derived sub-accounts.
- Use high-contrast image-edit captions independent of theme accent foreground colors, with light and dark outlines for visibility over cover photos.

### Documentation and publishing

- Update account, permission, cache, UI and reviewer documentation, and the website's localized authentication, permissions and account-setup guides. Remove obsolete site-list and all-sites-popup instructions and stale UI screenshots from the affected guides.
- Ship separately generated and verified Chrome and Firefox packages with matching source, build instructions and checksums. Stable GitHub releases trigger the existing serialized Chrome and Mozilla submission workflows only after successful CI on the release commit.

## 0.8.7

Community guides: [backend authentication](https://nostr-wot.com/en/guides/backend-authentication)
and [relay authentication](https://nostr-wot.com/en/guides/relay-authentication).

### Authentication and security

- Require destination-specific consent for all NIP-98 HTTP authentication, including same-origin requests. Remembered permissions bind the account, requesting origin, exact signed URL (including query text), and HTTP method. Older broad allows require fresh consent; older denials remain effective.
- Keep NIP-42 relay permissions account-bound and separate from HTTP permissions. Allow once, remember for one site, or explicitly allow a relay across connected sites. Site-specific denials override shared relay allows.
- Require browser-derived, verified top-level request identity for authentication. Reject embedded-frame, opaque, inconsistent or insecure origins outside explicit loopback development exceptions. Recheck site access and account-session validity after approval/unlock waits.
- Validate optional authentication origin metadata against the requesting origin. Registry entries remain informational and cannot grant permissions.
- Verify returned NIP-46 signatures and compare the complete signed event with the approved snapshot and expected account. Reject substituted content, destinations, challenges and other signed fields.
- Use body-bound wallet authentication v2 for provisioning and address mutations, with a separate transaction token and one-use backend challenge. The companion proxy verifies exact request bytes, unique tags, audience and client scope, rejects queries on fixed auth endpoints, and atomically consumes nonces across processes sharing its database.
- Restrict sensitive native wallet authentication to the internal wallet flow. Generic website signing cannot mint those tokens. Deploy the compatible backend first; retired endpoints return HTTP 426 and the client does not downgrade.
- Preserve scoped private-key cleanup and account-switch protection in signing, export, wallet and publication flows. Already transmitted requests cannot be recalled.

### Reliability and contributor guidance

- Keep PQ publication reads on the home popup entirely local, including empty and stale caches. Refresh relay evidence when the PQ settings panel is opened; preserve account isolation and unknown status.
- Clarify the extension description and reorganize the README around installation, first use, features and support. Keep release details in this changelog and technical guides in the documentation index.

- Verify NWC payment preimages against the requested invoice payment hash. Treat mismatched success responses as unknown outcomes and preserve replay protection.
- Resolve equal-timestamp replaceable events using the lower event ID consistently across relay arrivals and cached published lists.
- Cancel obsolete unlock and dialog callbacks, clean up wheel timers, and guard abandoned wizard steps while preserving profile drafts and activity pagination.
- Align build requirements with the locked dependencies: Node 22.22.2+, Node 24.15.0+, or Node 26+, within the supported major-version ranges declared in `package.json`. Update vulnerable development-only brace-expansion versions.
- Add contributor issue forms, a pull request template and the Contributor Covenant. Refresh security reporting, architecture, build, testing and deployment documentation; replace obsolete audit snapshots with current protocol documentation.

### Request review and settings

- Open a single pending request directly. Group multiple requests by site with bounded scrolling; grouped ordinary requests use checkboxes and approve only the selected IDs. New arrivals remain unchecked, and ordinary bulk approval excludes authentication.
- Describe authentication destinations and other event intent in plain language. Use theme accents for important values and show complete raw events in a dismissible code-button popup instead of duplicate tables or expand arrows on signing cards.
- Use compact Approve/Reject controls with remembered choices in arrow menus. Keep detail sheets bottom-aligned, with a scrolling body when content exceeds the popup height.
- Group private-message requests by sender and show available sent dates, small profile images and names. Fetch missing verified metadata from purplepag.es with the existing message-identity privacy guards.
- Reveal message content locally on click, without approving or returning it to the website. Automatically conceal it after 30 seconds; hide the centered hint during reveal and show a shrinking countdown at the bottom-right. Display preview errors once and reject stale preview results.
- Move site-specific authentication grants to the bottom of Permissions. A link below opens all-sites relay grants in their own table popup. Both follow the active account without redundant account selectors. Open the published relay list in a separate popup in Relays settings.
- Reuse raw-event dialogs, profile selectors and compact profile presentation. Maintain a shared profile cache limited to 30 minutes and 500 entries through an index rather than repeated full-storage scans.

### Packaging and publishing

- Automate Mozilla Add-ons submissions from stable GitHub releases with matching source, reviewer/build instructions and version changelog. Verify the source tree and Firefox rebuild before using credentials; serialize runs and resume matching submissions without duplicate version uploads.

- Integrate Chrome-specific manifest packaging, ZIP validation and actual Chrome worker/popup/connection-status smoke checks. Generate Chrome and Firefox archives independently with matching reproducible source and checksums.
- Submit Chrome packages only when a stable GitHub release is published, after successful CI and archive verification. Serialize submissions, skip versions already submitted/published and refuse unrelated pending-review replacement.
- Document the coordinated backend rollout, manual acceptance, OAuth setup and publishing recovery. Preparing a draft does not submit to stores or deploy the backend.

### Store release notes

More precise backend and relay authentication permissions, clearer approval dialogs,
local timed message previews, and account-switch protections. Includes verified
browser-specific packaging and automated release checks. See the linked guides
for permission scopes and compatibility requirements.

## 0.8.6 — 2026-09-29

### Added
- Require destination-specific consent for cross-origin NIP-98 HTTP authentication and NIP-42 relay authentication, with per-account saved permissions and revocation in settings. Relay consent can optionally cover all connected sites.
- Show the requesting site, account, exact destination and method in authentication review, with an informational registry of 20 Nostr clients and contribution instructions for backend mappings.
- Open only the themed toolbar popup on first install. If the browser refuses automatic opening, retain the theme for manual opening from the extension icon; never open a setup tab.
- Accept built-in `theme` URL parameters on the popup and onboarding entrypoints before first render, persist the initial choice, and preserve an existing saved theme.
- On first install, recover a unique theme from an open official HTTPS download tab and open the welcome popup. Add host access limited to `https://nostr-wot.com/*` for that lookup; no browsing-history or referral data is stored.

### Improved
- Defer the shared-core migration until the required packages are released on npm. Restore the extension’s existing account utilities, permission handling and storage implementation; preserve the migration on a separate branch.

### Fixed
- Keep private-key copies inside zeroing scopes and reject stale signing, key-export and publication results after account changes; check revocation again when relay sockets open.
- Recheck site identity access after authentication waits for unlock, including remote signer delegation.
- Remove the previous generic upload ZIP when packaging starts so a failed rebuild cannot leave an old artifact masquerading as its output.
- Prevent generic signing grants, batch approval and remote signer delegation from bypassing authentication destination consent. Reject malformed auth events and authentication requests from embedded, opaque or insecure non-loopback frames.
- Set the packaged extension name to `Nostr WoT Extension` so the Chrome Web Store title uses the requested name.
- Use `nostr-wot-extension@nostr-wot.com` for the new Firefox listing after AMO rejected the previous ID as a duplicate. This is a separate add-on identity, not an automatic update to the old listing.
- Restore NIP-49 `ncryptsec` key backup export and import for builds resolved from the declared dependency ranges rather than the committed lockfile. The scrypt memory bound sat exactly on one `@noble/hashes` version's internal accounting, so a newer release within the range refused every backup. Store builds and ordinary `npm install` builds were unaffected.
- Report a readable error when a backup's scrypt parameters cannot be used, instead of passing the cryptography library's internal message through to the import screen.
- Exclude `nostr-tools` 2.25.2, whose WebSocket error handler calls itself until the stack is exhausted. A single unreachable relay in a remote-signer relay list could raise an uncaught error in the background service worker.
- Use the existing `ws` transport for local Nostr Connect integration tests, preserving refused-relay coverage without Node's recursive WebSocket teardown.

### Internal

- Give the scrypt memory bound a few blocks of headroom above the current `@noble/hashes` requirement, with tests against newly resolved dependency versions to detect future accounting changes.
- Verify NIP-49 backups against an independent implementation in both directions, across every defined key-security byte and a range of cost factors.
- Add a CI job that installs the newest dependencies each declared range admits, then typechecks, builds and re-runs the crypto, vault, signer and transport suites. It also runs weekly, so a library changing behaviour under a range is found before a contributor trips over it.

### Release packaging
- Correct Chrome release packaging so the background service worker starts and the popup can read site connection status.
- Build browser packages in isolated directories and validate each final ZIP against its target browser and release version.
- Require a disposable Chromium smoke test of the Chrome ZIP: worker startup, popup rendering and the connection-status RPC.

### Store release notes
Restores the background service required for site connections and signing in Chrome. Adds explicit permissions for backend and relay authentication, protection against authentication from embedded frames, and release checks for browser packages.

## 0.8.4 — 2026-09-27

### Added
- Add project palettes for Coracle, noStrudel, YakiHonne and Nostrich alongside the existing Light, Dark, System and La Crypta themes.
- Add a custom theme editor with manual color pickers and a JSON import path covering the extension's semantic color tokens.
- Persist custom themes locally and apply them across popup, onboarding and approval documents.

### Improved
- Select themes through the existing shared Dropdown component, with an associated label, keyboard navigation and a retained Custom selection.
- Align Coracle, noStrudel, YakiHonne and Nostrich with their supplied client palettes. Keep noStrudel's lime actions and blue controls distinct, and preserve Nostrich's neutral interface and separate Lightning accent.
- Make animated logo colors follow the active theme. Render the shared built-in SVG logo with the theme color in loading, welcome and settings views.
- Document mandatory reuse of shared UI components in AGENTS.md.

### Fixed
- Restore the missing default logo on the welcome screen and prevent the settings footer logo from retaining its standalone purple color.
- Correct selector-list handling in theme contrast checks and preserve selection when saving a theme fails.

### Verification
- 1,808 automated tests pass, including shared controls, custom palettes, theme persistence and logo rendering. TypeScript passes; ESLint reports no errors and 10 existing warnings.
- Verify the actual unpacked Chrome extension with the existing account and connected Lightning wallet; capture each project theme's account, settings, wallet and welcome views.

### Security and reliability
- Custom JSON accepts only the documented color keys and validated hex/RGB(A) values. Unknown keys and CSS values such as URLs are rejected instead of being injected.

### Store release notes
- Match Nostr WoT to Coracle, noStrudel, YakiHonne or Nostrich, or build your own palette manually or from JSON.
- Choose themes from a dropdown and enjoy matching logo colors throughout the extension.

## 0.8.3 — 2026-09-23

### Added
- Manage multiple NWC app connections for Nostr WoT LNbits wallets from Wallet Settings.
- Create a separate connection for each app, with a name, daily spending limit and expiry.
- View active connections and their budget usage, copy connection strings, display QR codes and revoke access.
- Use existing Nostr WoT LNbits wallets with compatible NWC apps such as Primal.
- Localized connection management in all six extension languages.

### Security and reliability
- Generate connection secrets locally and store them encrypted; secrets are never sent to the proxy.
- Recover connection registration after interrupted requests without creating duplicate grants.
- Enforce wallet ownership, spending limits and expiry on the server. Connections remain active until revoked or expired, even when the extension is disconnected.

### Verification
- 1,804 automated tests pass, including connection lifecycle, wallet isolation and mounted UI tests.
- Live creation, listing and revocation verified with an empty LNbits wallet, plus a signed NWC get_info exchange over a relay. No real payment was sent.

### Store release notes
- Connect your Nostr WoT LNbits wallet to NWC-compatible apps using individual connection strings.
- Set daily spending limits and expiry dates, review active connections, copy or scan their details, and revoke access from Wallet Settings.

## 0.8.2 — 2026-09-23

### Improved

- Align dark mode with nostr-wot.com, using near-black popup surfaces, distinct lighter hovers and readable permissions menus; keep La Crypta secondary-button hovers lime.
- Add subtle 4px backdrop blur to dialogs and approval overlays, contain keyboard focus in the topmost dialog and show toggle focus clearly.
- Improve wallet spacing and first-use connection help with a persistent opt-out, localized nostr-wot.com guides in background tabs and wallet API-key explanations.
- Negotiate signed NWC wallet capabilities, prefer NIP-44, retain legacy NIP-04, and try alternative relay connections before publication without replaying payments.

### Fixed

- Keep first-use wallet help inside the popup during the menu slide-in animation.
- Preserve outgoing payment notes and signed website-zap messages in encrypted local history; show LNbits/NWC comments and historical LNbits zap metadata with wrapping (#26).
- Show confirmed WebLN payment receipts and the connected wallet's reusable Lightning Address with QR/copy in Deposit (#27).
- Validate candidate wallets before persisting their credentials; preserve existing connections on failed validation.
- Validate NWC response provenance, methods and fields, accepting documented Alby/LNbits nullable fields and signed fees.
- Preserve transaction state, propagate lookup failures, and prevent ambiguous payment intents from creating another invoice or replaying a payment.
- Treat LNbits pending HTTP 200 payment responses as unknown outcomes, never confirmed success.
- Reject fractional receive amounts and prevent send-dialog closure during payments.

### Verification

- 1,799 tests pass, including signed local NWC wallets, production handlers and mounted UI flows. See [NWC protocol](docs/nwc-protocol.md) and [compatibility](docs/nwc-compatibility.md) for current coverage and live-provider limitations.
- Popup-width component previews cover light/dark setup, expanded settings, permission menus, hover colors and dialog blur. No live-wallet payment certification is claimed.

### Store release notes

- Improved dark-mode menus, permissions, popup backgrounds and hover contrast; corrected La Crypta button hovers.
- Added subtle background blur behind dialogs and approval popups.
- Improved wallet setup spacing and first-use help with a Do not show again option, localized website guides that open in background tabs, and a clearer LNbits API-key explanation.
- Added modern NWC encryption negotiation while retaining legacy wallet support, plus compatibility fixes for wallet responses.
- Validate wallet connections before saving them and handle connection failures more reliably.
- Show uncertain payment outcomes clearly and prevent automatic replay of the same payment intent.
- Improved invoice amount validation, payment-dialog behavior and transaction status handling.
- Fixed the first-use wallet help dialog appearing outside the popup.
- Display payment notes in history, show a success receipt after confirmed WebLN payments, and add receiving-address QR/copy controls to Deposit.

## 0.8.1 — 2026-09-23

### Added

- Add Appearance and language settings with Light, Dark, System and La Crypta themes.
- Save appearance locally and apply it across popup, onboarding and approval windows; System mode follows operating-system changes.

### Improved

- Move the language selector into Appearance and language, reusing the existing language picker.
- Apply shared dark surfaces and readable text/status colors to cards, menus, inputs, loading screens and wizard panels.
- Add a La Crypta palette inspired by lacrypta.ar: near-black surfaces, lime green and orange accents.

### Fixed

- Remove hard-coded white surfaces that prevented consistent dark mode.
- Keep QR codes dark on white regardless of the selected theme.

### Store release notes

- New Appearance and language settings with Light, Dark, System and La Crypta themes.
- Your theme saves immediately and applies across extension windows. System mode follows your device's appearance.
- Find the language selector inside Appearance and language instead of the menu footer.
- Improved dark-mode colors for forms, cards, menus, loading screens and approval interfaces.
- QR codes remain readable in every theme.

## 0.8.0 — 2026-09-20

### Added

- Restore experimental `window.nostr.wot` through menu-only opt-in, disabled by default, behind existing website connection and identity permissions.
- Support local, remote and hybrid queries with the MappingBitcoin oracle as the configurable default endpoint.
- Add manual and opt-in daily graph sync, configurable hops and unlimited-by-default relationship, author and follows-per-profile limits.
- Apply account mutes to paths and scores, with explicit private-mute availability states and configurable distance weights/path bonuses.
- Add npub/hex score lookup with profile information and a popup explaining only the calculation, including signed color-coded contributions.
- Add account database and shared-cache inventory, storage estimates, status dots, per-hop progress and confirmed delete/resync actions.

### Improved

- Store graphs with numeric identity references in IndexedDB; reuse traversal indexes, verified public lists and pooled relay connections.
- Deduplicate repeated profiles and prevent overlapping automatic or manual syncs, including the final progress-write phase.
- Keep pending approval buttons at the top with compact per-type Always allow/reject menus; one-time actions do not save permissions.
- Replace the account-copy dialog with an anchored Hex/npub menu and repair shared settings tooltips in scrolling panels.
- Consolidate sync settings in their own screen, apply valid scoring edits immediately, and remove repeated or irrelevant result information.
- Organize protocol documentation into `nips/pqc/` and `nips/wot/`, with browser API and scoring proposals and updated feature/security/build guidance.

### Fixed

- Reuse shared approval/rejection split buttons in event details, with remembered choices behind the arrows. Show follow-list danger notices on pending cards and in details before approval and include synced WoT follow history in the check.
- Warn before signing a follow-list update that would replace known follows with zero or one contact. Require explicit confirmation even with saved approval or a remote signer; preserve intentional changes after confirmation.

### Verification

- Regression coverage includes site/account isolation, permission revocation, mute handling, follow additions/removals, cancellation, storage, oracle validation and approval-menu scoping.
- See [testing](docs/testing.md) and [NWC compatibility](docs/nwc-compatibility.md) for current verification scope and native/provider limitations.

### Store release notes

- Restore experimental Web of Trust as an optional menu feature, disabled by default. Connected sites with identity access can query window.nostr.wot.
- Choose local, remote or hybrid queries, with configurable hops and limits, optional daily sync, and account-specific database management.
- Apply account mutes to trust paths and scores. Look up an npub or hex key and see the calculation with available profile information.
- Reduce graph storage and repeated relay work with numeric references, shared public-list caching and pooled connections.
- Improve sync progress, settings tooltips, account-copy menus and per-type Always allow/reject choices in pending approvals.
- Add WoT API/scoring proposals and reorganize protocol documentation into PQC and WoT sections.
- Protect known follow lists against accidental replacement with zero or one contact, with visible warnings and a separate confirmation. Reuse compact approval menus in event details and show identical warnings once.

Experimental scores describe follow/mute relationships, not safety or endorsement. Live oracle-provider interoperability has not been exhaustively verified.

## 0.7.2 — 2026-09-19

- Show Nostr Connect accounts with their profile name and image, or a shortened npub fallback, in the top bar and account selector.
- Add a non-interactive `remote` badge using shared account presentation.
- Support profile `display_name` consistently and add regression tests.

## 0.7.1 — 2026-09-19


### Fixed

- Resolve the Nostr user identity with `get_public_key` during QR and bunker-link onboarding instead of assuming it is the remote signer's connection key. This supports signers using separate per-connection keys, including Amber-style sessions.
- Retain the signer's current relay list, pairing credentials and client identity for subsequent signing and reconnection.
- Bound identity resolution and close temporary signer subscriptions on success or failure; reject invalid identities before saving an account.

### Tests and compatibility

- Add production onboarding integration coverage for shared/separate identities, QR relay fallback, relay selection, vault persistence, subsequent signing, authentication challenges, rejection and timeouts.
- Document supported paths and remaining native/provider coverage in `docs/remote-signer-compatibility.md`.
- Native delivery of signing requests in Amber remains unverified; the reported missing-request issue is not claimed resolved. Previously misidentified accounts need reconnection.

### Store release notes

- Fix remote-signer linking when connection keys differ from the user's Nostr identity.
- Preserve relay and pairing information for signing after linking.
- Improve connection failure handling and expand remote-signing compatibility tests.

## 0.7.0 — GitHub release 2026-09-10

- Consolidate the latest security, account recovery, PQ backup and approval fixes into refreshed Chrome/Firefox upload packages, with a clean-source rebuild comparison.

- Restore encrypted seed backups through the account-import wizard using a file or pasted JSON; explain where to restore PQ-only files.

- Restore password-encrypted PQ key exports directly through key import, with password retry and existing key-pair validation.

- Encrypt wallet display data, activity history and payment replay results with a vault-protected cache key; migrate old records on unlock and hide private UI data on lock.
- Use explicit public account metadata allowlists, exact-origin permissions for new website grants while preserving existing connections and approval rules, a shared 24-hour automatic-payment budget, and stricter LNURL invoice validation.
- Pin CI actions to verified commits and restrict workflow permissions.

- Addressed security audit A1–A7: bind payment/signing authorization to account and vault session; honor account-specific payment denials; cancel stale operations after lock, switch or wallet replacement; reject credential-bearing redirects and insecure provisioning; enforce request and payload limits.
- Dispose LNbits/NWC providers on lock or disconnect, prevent late connections from reviving them, and serialize vault lifecycle writes so a pending unlock cannot undo a newer lock.
- Added adversarial regression tests using synthetic accounts and local wallet/relay servers.

- Hide the home wallet balance on unconnected sites and while site connection status is loading or unavailable; the wallet remains accessible in Settings.

- Restore website refresh on account switch for clients that cache identities. Foreign-author signing requests are rejected automatically and retained as unread summaries, with a red toolbar counter until acknowledged.


- Sub-account previews show npub and hex automatically. Names are editable, and custom derivation paths live under Advanced. Stale or failed previews cannot enable Continue.

- Seed-derived account removal explains seed/path recovery. Sub-account creation supports validated custom paths, public-key previews and recognized network-prefix hints. Existing standard keys remain unchanged.
- Standardized popup body and action spacing, including deletion confirmations and post-quantum dialogs.
- Make “Approve once” / “Approve all” approve only displayed requests; offer a separate “Always allow” action with an explicit explanation of future site permissions.
- Preserve the add-account wizard when a newly derived account becomes active.
- Show account deletion in a separate confirmation dialog; display failures without hiding accounts.

- Fixed premature wallet lock errors during startup, refreshed wallet data after unlock, and discarded stale vault-status responses.

- Split vault/signing services by responsibility, share the HTTP transport type, and use component directory entrypoints with named button presets.

- Reuse profile image controls and summaries, standardize editable lists, and isolate mute-editor state with stale-response guards and shared lifecycle helpers.

- Standardized button sizing and appearance, removed call-site visual overrides, and separated approval navigation from cancellation to avoid nested buttons.

- Reused shared controls throughout activity details and kind previews; added shared status announcements, text blocks and disclosures, and removed the event preview class registry.
- Migrated pulse-logo and scroll-wheel styles to utilities while retaining shared animations and wheel geometry.
- Wired NIP-07 and WebLN page timeouts to canonical build-time constants, with packaged-script coverage for both channels.

- Consolidated tab, chip, dropdown and select options into `Option<T>`, preserving typed chip callbacks and read-only option lists.
- Grouped browser documents under `src/entrypoints/`; moved prompt and welcome content to feature screens and updated packaging paths. Prompt decisions now reuse shared buttons and selects.

- Split key actions, payment previews and permission rules into focused UI modules; reused copy/form controls and moved feature formatting and favicon caching to their semantic owners.

- Removed forwarding exports and icon/format barrels; consumers import shared symbols directly from their defining modules.

- Centralized configuration and protocol constants in `src/constants/`, removing duplicate relay defaults, cache names and lockout/password policies.
- Shared account-import helpers and activity/mute/PQ/account/language domain contracts replace repeated UI/background definitions; activity clearing reuses the display filter.

- Updated vulnerable dependencies; npm audit reports zero known vulnerabilities.
- Reorganized application code into feature domains, services and generic utilities; retained crypto and browser compatibility in lib.

- Send now accepts pasted bech32 LNURL-pay strings and `lightning:LNURL…` links, with endpoint-domain preview and the existing amount, approval and duplicate-payment safeguards.
- LNURL checksums, mixed case, malformed UTF-8, unsafe URLs and non-payment endpoints are rejected.
- Refreshed Chrome/Firefox packages, reviewer notes and reproducible source archive.

- Fixed clean-checkout CI failures by building before CSS regression tests in GitHub Actions and the local test runner.

- WebLN reports the connected wallet's available methods and accepts number/string/object invoice amounts with validation. Added website-payment integration coverage for LNbits, Lightning Addresses and Nostr zap signing/payment.

- Added local-relay NWC wallet integration tests using real signatures and encryption.
- Fixed NWC connection and cold startup: the wallet factory now constructs the provider with shared crypto instead of referring callers to a nonexistent factory function.

- Fixed repeated relay traffic caused by cache-change notifications starting another refresh. Recent mute/PQ answers are reused for one minute; stale reads still refresh in the background.

- Profile covers now support Blossom upload or a typed URL and appear in the publish preview. Form fields have a distinct cool-gray surface. Post-quantum settings have a clearer status/publication layout, and the encrypted-backup recovery warning follows password validation.

- Activity rows now show cached site favicons and trailing time/status. Event details have expandable payloads and local decryption for saved NIP-04/NIP-44/PQ content, including verified gift wraps. Future crypto logs retain ciphertext only; older entries without saved bodies explain their limitation.

### Store release notes

- Fixed intermittent wallet lock messages and improved shared controls, profile previews and activity details.

- Updated vulnerable dependencies.
- Pay pasted LNURL strings and lightning:LNURL links directly from the wallet’s Send screen.
- Fixed NWC wallet connection and startup.
- Improved website payment compatibility and detection of supported WebLN methods.
- Expanded automated payment and connection tests.

- Redesigned wallet, profile, post-quantum keys, activity details and form controls.
- Wallet information appears from cache while refreshing; settled transaction history loads past pending invoices.
- Fixed repeated relay requests, relay-list discovery and unstable key publication status.
- Concurrent approval requests appear in groups with expandable details, website origins and readable event types. Requests for another account are rejected.
- Improved account switching, scrolling, copy controls and keyboard accessibility.
- Corrected Firefox data disclosures and required consent-compatible Firefox versions.

### Fixed — consent and release packaging

- Firefox requires desktop 140+ and Android 142+ for its built-in consent experience.
- Disclosures now include wallet authentication, remote-signing communications and site domains sent for favicons, alongside payment and identity data. Firefox requests consent for newly required categories on upgrade.

### Fixed — wallet and approvals

- Account-scoped wallet display caches survive popup reopening and refresh in the background without hiding existing data. Alias and address reads update independently.
- Transaction history excludes pending invoices at the LNbits API and in the shared filter, and continues paging when a provider still returns pending entries.
- Deposit, send and settings dialogs use consistent spacing, bounded scrolling, reusable copy controls and clearer action descriptions.
- Content-script requests share a multiplexed port with request IDs, out-of-order response matching and disconnect cleanup.
- Pending approvals remain grouped with live details and batch decisions scoped to the selected account. A client that serializes requests still sends its next request only after the previous response; unseen requests cannot be grouped.
- Automatic approval opening reuses an already-visible popup, including during account switching.


### Fixed — security

- **Two relay readers accepted events without verifying signatures.** `fetchKind0Read` and `fetchMuteList` open their own sockets and matched on `pubkey` and `kind` only — fields a relay merely asserts. Both feed a read-modify-write of a replaceable event that the user then re-signs and publishes, so a forgery was not just displayed: a `kind:0` carrying the attacker's `lud16` would have redirected the user's zaps, and a forged `kind:10000` replaces their NIP-44-encrypted private mutes with ciphertext the relay chose. `liveQuery` verified all along; these two bypassed it.
- **A relay that serves a forgery can no longer vouch for emptiness.** Rejecting the bad event was not enough on its own — these reads also report `reachable`, and `reachable: true` with nothing found means "safe to overwrite", so garbage followed by `EOSE` would still have wiped a profile. `reachable` now counts only sockets that answered *and* never served an invalid event. See `docs/security.md` §12.1.

### Fixed — the popup painting over its own consent surfaces

- **The lock screen and the approval sheet could be painted over by a deposit QR.** Five dialogs escaped to `#root` portals to get out of a containing block created by the menu's slide animation. That cause was fixed in `c01f087`; the portals outlived it, and because they landed outside `.card`'s stacking context they outranked every consent surface. All five now render in place.
- The in-popup unlock prompt sat at `z-index: 360` while wallet dialogs sat at 500 — the surface demanding an unlock outranked the one asking for it. There is now a stacking ladder in `theme.css`, and `--z-lock` beats every task surface by construction.
- Menu sections and the permissions list had no scroller anywhere in their chain, so anything taller than the card was clipped by `overflow: hidden` — not merely off-screen, unreachable.

### Changed — form controls and mute lists

- Inputs, selects and dropdowns share consistent heights, stronger borders, SVG chevrons and keyboard focus. Buttons have quieter hover and disabled states; list Add actions use accessible SVG plus buttons.
- Empty, invalid and duplicate list entries cannot be submitted by click or Enter. Custom permission kinds are validated before Add is enabled, and validation errors no longer interrupt typing.
- Mutes reads the latest verified NIP-51 kind:10000 before editing, waits for Never-lock startup and distinguishes missing, empty, private-only and failed reads. The header information button explains public edits and preserved private entries.

### Changed — notice consistency

- Warning and error callouts now share `StatusNotice` spacing, corners and icon alignment across recovery, key export, account removal, security settings and post-quantum availability. Paragraph warnings use a wrapping body; compact status rows retain their label and tooltip.

### Fixed — other

- Post-quantum keys in Security no longer report "Vault is locked" while a Never-lock vault is still completing startup decryption. Status and key operations wait for the same startup check as the main vault status.
- The Activity overlay’s close control now uses the shared icon button and has an accessible name.
- Filled shared buttons now suppress the browser’s native raised border; outlined buttons retain their explicit border.
- Fixed two CSS cascade regressions found in the visual pass: the global reset overrode Tailwind spacing, and decorative background rules forced overlays into normal flow and erased their stacking order. Defaults now sit below utilities in explicit cascade layers.

- Copying an **nsec, ncryptsec or seed phrase** used an un-awaited `navigator.clipboard.writeText` with no error path, so a clipboard the browser refused looked exactly like a successful copy — on the three values a user cannot check by eye. Nine of eleven raw call sites now use `useCopy`, which reports the outcome, and the wizard only marks a seed backed up if the write actually landed.
- **Clearing your display name left the old one published.** `display_name` was set alongside `name` but never deleted with it, so emptying the field deleted `name` and left the previous value in the field many clients prefer.
- The wallet's transaction filter existed as two hand-written copies of one predicate — one deciding when to stop fetching pages, one deciding what to render. They agreed, but nothing made them; a drift would have made the list quietly come up short.
- `EditableList` passed a value-taking `onAdd` to a zero-argument `onSubmit`, so controlled callers reading that argument got `undefined`.

### Changed — popup startup

- The mute list and the post-quantum published check are served from the background's last real answer and refreshed behind, instead of putting a relay round trip on the popup's first paint — the rule in `docs/component-standards.md` §9 that these two were breaking. The open popup hears the refreshed answer through `storage.onChanged`. **An unreachable read is never cached and never evicts a real answer**, so a cached value is always something the relays genuinely said: stale at worst, never invented.
- `wss://nos.lol` is now the first default relay. Reads try relays in order, and the previous first entry was the one that stalls most often.

### Changed — structure

- `Wallet.tsx` 1089 → 202 lines, split into `DepositDialog`, `SendDialog`, `TransactionList`, `TxFilterDialog` and `WalletSettings`. Each dialog owns its own state, so closing one *is* its reset — the parent had been clearing eight fields by hand per dialog. Wallet settings no longer fires three RPCs on every wallet open for a panel most sessions never touch.
- `HomeTab.tsx` 440 → 263 lines; its three in-file hooks now have their own files.
- Every centered dialog is the shared `Modal`: the wallet's deposit, send and tx-filter, the permissions add-rule, `KeyActionModal`, and the wizard's encrypted backup. They had five scrim opacities, three dismissal behaviours and no Escape key between them. `KeyActionModal` is deliberately non-dismissable — its old shell closed on `click`, so selecting an nsec and releasing outside the card wiped it mid-read.
- **New tested decision modules** in `src/shared/`, following the `siteState.ts` precedent: `approval.ts` (including the cross-site isolation filter, which was a security boundary with no test), `profileMetadata.ts`, `txFilter.ts`, `pqcState.ts`, `permissionRules.ts` and `invoiceExpiry.ts`.
- One canonical `PendingRequest` (was five definitions) and one `ProfileMetadata` (was three). The copies had already drifted into a type error that one of them documented in a comment rather than fixing.
- `theme.css` gained spacing, type, weight, line-height, radius, motion, shadow, brand-tint, status and z-index scales, all derived from values already in use. Roughly 1,950 token references; colour literals 279 → 106; `var()` fallbacks 18 → 0.
- Dead CSS removed, `PqcSection` no longer imports a sibling section's stylesheet, and `SiteControls`, `PqcCard` and `ApprovalCard` have their own modules.
- `src/shared/animations.css` deleted — every module already defined the keyframes it used, so the shared file was loaded by the popup and referenced by nothing.
- `ApprovalOverlay` 408 → 217, `PqcSection` 553 → 324, `PermissionsSection` 484 → 319, `MenuOverlay` 296 → 258, `KeyActionModal` 23 `useState` → 17. Extracted alongside them: `useApprovalQueue`, `LanguagePicker`, `DeclinedSites`, `AddRuleModal`, `ProfilePreviewCard`, `PqcExportModal`, `PqcImportPanel`, `PqcHowItWorks`, `PqcKeyRow`.
- **Two security-adjacent fixes in the wizard.** Both `PasswordStep` and `SubAccountStep` called `vault_unlock` directly, so the add-account path was an unthrottled password oracle while every other unlock carried the escalating lockout. Worse, `PasswordStep` offered the empty password to *any* locked vault rather than only never-lock ones — and the background charges failed unlocks to a persisted guard, so an abandoned wizard re-running that probe on each popup open could lock a user out of their own vault in five opens without them typing anything.
- Shared what was duplicated: `useOutsideClick` (4 copies), `useTimedReveal` (2, both guarding secret material), `Spinner` (4 CSS definitions and 4 keyframes), `IconButton` (17 rule blocks), `validatePasswordPair` (8 hand-written copies), `asGroup` (which collapsed four single-request approval handlers that were repeating the group handlers' `permKey || type` fallback by hand).
- Renamed four files that said one thing and rendered another: `FiltersModal`/`ActivityModal` → `*Overlay` (they render `OverlayPanel`), `HomeTab` → `Home` (there are no tabs), `Profile/Mutes/RelaysCard` → `*Row` (they render a list row).
- Account-creation screens live in `src/screens/Wizard/`, shared by popup and onboarding through the existing screens alias.
- Expanded regression coverage for the refactor and subsequent wallet, relay, approval and release fixes.

### Changed — one component per pattern

- **Every clickable list row is `ListRow`.** `NavRow`, `NavItem` and the permissions screen's own `.permRow` were three implementations of `[leading] [title / subtitle] [chevron]`, which is why the chevron was brand coloured in two of them and muted in the third, and why only one ellipsised a long subtitle. Chrome is now the variant. Three row-shaped things are deliberately excluded and say why in the component's own comment: the menu's language trigger (a dropdown trigger, chevron pointing down), the top bar's account rows (a container of hover-revealed controls, not one control), and the wizard's follow suggestions (a multi-*select* list, and the only one — a variant with a single caller is a guess about the second caller, which is how `NavRow` and `NavItem` became two things).
- **`Tabs`, `Chip` and `SeedWord`** replace the copies of each. All three gained the semantics the hand-rolled markup lacked: `role="tablist"` with `aria-selected`, and `aria-pressed` on a chip. `Chip` takes `toggle={false}` for a chip that is a one-shot action — the recovery-phrase word bank consumes a word when tapped, and announcing every available word as "not pressed" describes a toggle nobody built.
- `Tabs` keeps two variants because the product has two tab designs — the wallet uses outlined segments, the NIP-46 step a track with a moving thumb. Converging them is a design decision, not a refactor, and is still worth making.
- Raw `<button>` outside `src/components/` is down to 24, and each remaining one is a documented mismatch rather than an omission — a semantic-scope colour set no variant covers, a control joined to an adjacent `Select`, a bordered-at-rest chip against `IconButton`'s chromeless contract.

### Changed — Tailwind

- **Tailwind v4, wired to the tokens that already existed** rather than to its own defaults, so a utility and a stylesheet reaching for the same idea get the same value. The spacing scale needed no mapping at all: it was already exactly `n x 2px`, so `p-6` **is** `--sp-6` by construction. Tailwind's own type, weight, leading, radius and shadow scales are cleared first — its `text-xs` is 12px and ours is 11px, and leaving both in place means one class name means two things depending on whether the author knew the config existed.
- **58 stylesheets became 24; 6,280 lines of CSS became 1,115.** What remains is what utilities genuinely cannot express: custom `@keyframes`, adjacent-sibling rules, `:global`, 3D transforms, and the handful of properties a caller sets through an inline custom property.
- **Preflight is deliberately off.** It is a global reset — every margin and padding zeroed, headings unsized, lists unmarked — and the stylesheets here were written against browser defaults. Switching it on changes the spacing of every paragraph and heading at once, which no test in this repo can see. It goes on as its own change, verified with the extension loaded.

### Fixed — four ways Tailwind fails silently

Each of these compiles, breaks no test, and shows up only as something that looks slightly wrong on screen.

- **A gradient mapped into the colour namespace.** `--bg-page` is a `linear-gradient`, and a colour utility only ever emits `background-color` — so `bg-page` produced an invalid declaration that browsers drop, leaving the surface with no background at all. It is unmapped now, with a test that walks every `--color-*` mapping down its `var()` chain and fails if what it ends at is not a colour.
- **A mapping in a namespace Tailwind does not read.** `--duration-fast` looks obviously right and generates nothing; Tailwind takes `duration-*` from `--transition-duration-*`. Now checked against the namespaces Tailwind actually reads.
- **A misspelled utility.** `text-secondry` is a string the compiler never sees. `tests/tailwind-classes.test.ts` checks every static class name against the generated stylesheet — verified against typos planted in four positions, after two earlier versions of the scan passed while a planted typo sat in the source.
- **A caller's override losing to the component's own class.** Two utilities for the same property are resolved by their order in the *generated stylesheet*, not in `className`: `<Card className="p-0">` rendered with 14px of padding because Tailwind emits `.p-0` before `.p-7`. Three were live at once — `p-0`, `mb-0`, and a warning tint that never appeared. Every component now composes through `cn()`, whose configuration is itself load-bearing: `text-md` is a font size here and `text-muted` is a colour, and an unconfigured merger deletes one of them.

### Changed — the contexts share their machinery

- Seven contexts each hand-wrote the same read: `data`/`loading`/`error`, a run-version ref so a slow refresh cannot win by finishing last, a `storage.onChanged` subscription filtered by area, and the `createContext` + `useContext`-or-throw boilerplate. That is now `useAsyncResource`, `useStorageWatch` and `createRequiredContext` — three composable pieces rather than one factory, because the contexts' mutations and failure semantics differ too much for a single shape to hold them without flattening what each one knows.
- **"A failed read means unknown" is structural now.** A thrown load sets `error` and leaves `data` alone, so a relay that could not be reached can no longer collapse into "nothing is published" — the direction that overwrites a profile or a mute list. `VaultContext` overrides it deliberately: a vault it cannot read is treated as *locked*, because there the safe direction is the negative one.
- Related fields live in one object updated by one `patch()`, so a consumer cannot see a fresh `status` beside a stale `published`.
- **Activity has a context**, with the pagination. The log is fetched only while its overlay is open, and the render window resets on a filter change rather than on the entries' identity — a background refresh under the same filters must not yank the list out from under someone scrolled down. The wallet keeps its own pager: it pages a remote API with no server-side filter, while the activity RPC already returns the whole log, so one has more to *fetch* and the other only more to *render*.
- The hooks documentation named a `src/shared/hooks/` directory that has never existed, which is how `useBrowserStorage` came to be hand-rolled twice by components that could not find it.

### Fixed — one dialog was more careful than the other

- **Exporting an encrypted backup had two implementations.** The vault's key dialog explained the format, warned that nothing can recover the password, showed a live checklist of what the password still needed, kept the button disabled until it was met, and offered both a download and a copy. The wizard's had two bare password fields, a button that objected only once pressed, and download as the only way out — and that is the one a new user meets. Both now render one `EncryptedBackupForm`.
- The wizard marked a seed **backed up when the export was generated**, not when it was received. A file the user never got is not a backup; it now marks on download or on a clipboard write the browser actually accepted.
- Marking the backup taken no longer closes the dialog. With both a download and a copy on offer, dismissing on the first made the second unreachable.

### Fixed — five forms that refused only once pressed

- **"Choose a new password, twice" was written out at six sites** — every encrypted export, the vault's change-password form and vault creation. `passwordPair.ts` already shared the *rule*; what stayed duplicated was the *form*, and only one of the six showed a live checklist of what the password still needed or disabled its button until it was met. The other five refused on submit and left the user to guess which requirement had failed. All six are `PasswordPairFields` now, and all six wait. A third field that is not part of the pair — the change-password screens' *current* password — deliberately stays outside the component.

### Changed — folders that mean what they say

- `createRequiredContext` was in `src/popup/context/` but is not a context; it is the factory that makes one. It could not move to `src/shared/` either, because that is React-free on purpose — `lib/bg/` and `lib/wallet/` import from it, and anything React there would pull React into the service worker's import graph. `src/utils/` now holds React-side helpers that are neither a component nor a hook, and `src/styles/` holds `theme.css`, which had been the only non-TypeScript file in a folder of logic modules.
- The rest of the tree was audited against the same question rather than only the part that was pointed at: every file in `src/hooks/` is a hook, every file in `src/models/` is types with no runtime code, and every folder in `src/components/` holds a component of its own name.

### Fixed — inventories that were read as the list

- Three hand-maintained lists were checked by nothing and had each gone stale: the component inventory in `docs/component-standards.md` (which claimed in its own text to be generated from the folder, and was not), the test table in `docs/testing.md` (25 files behind), and the import aliases (documented in two places and configured in two more, which must agree — an alias in `tsconfig.json` but not `vite.config.ts` passes typecheck and fails the build). All three are now asserted by `tests/test-registration.test.ts`, each verified by breaking it on purpose.

### Fixed — errors nobody heard

- **Twenty-six form-error lines, one of which announced itself.** Each screen had its own `.error` rule — the same two declarations at two different font sizes, some with a top margin compensating for a parent without a gap — and only `ConfirmDialog` carried `role="alert"`. Everywhere else, an error raised by a failed submit was never read out: a screen-reader user pressed the button and heard nothing, with the only evidence on screen. They are one `FormError` now, and the fix that was already understood in one place is carried everywhere.

### Fixed — things that only worked with a mouse

- **Revealing your own key material required a mouse.** The nsec display and the recovery-phrase grid both reveal on click and were divs with an `onClick`: no tab stop, no Enter key. Same for the deposit dialog's invoice, where clicking is the only way to copy it, the wizard's follow-suggestion rows, the verify step's placed words, and the avatar picker in Edit Profile. All are buttons now, and the two reveals report `aria-pressed`.

### Fixed — failures that leave no trace

- **A stylesheet rule that applies to nothing.** Extracting repeated markup into a component moves it into a new CSS Module scope, so a descendant selector left behind in the old stylesheet silently stops matching — valid CSS, no build error, no warning. It happened twice during this pass. `tests/css-selectors.test.ts` now asserts every class named in a selector is one the code puts on an element; on its first run it found four more, three of them left by the wallet's own migration to the shared `Tabs`.
- **A test file that nothing runs.** Both runners name their suites in one long line each, and the two drift. `tests/wallet/approval.test.ts` was in neither, so four passing assertions about payment approval were running nowhere; two further suites ran locally but were never gated in CI. `tests/test-registration.test.ts` now asserts every test file is run by both, and listed in `docs/testing.md` — which had gone 25 files stale.
- The theme-token test stripped comments one line at a time, so it flagged prose that spanned lines while quoting `var(--card-bg))`. It had already caused a valid comment to be reworded to satisfy it. It now blanks comments across the whole file, and is verified in both directions.

## 0.6.0

Pay to a Lightning Address, and a long list of fixes to things that only went
wrong sometimes — which is why they lasted. Three audits went over the frontend
and the wallet; most of what follows was found by the second and third.

### Added

- **Pay to a Lightning Address** from the Send box, alongside BOLT11 invoices
  (LUD-16 → LUD-06). The address is resolved in the background, the amount the
  user approves is checked against the invoice that comes back, and the endpoint
  that was shown is the endpoint that gets paid. Thanks to **@Fabricio333**
  ([#21](https://github.com/nostr-wot/nostr-wot-extension/pull/21)).
- Firefox's built-in data collection consent, declaring what the extension
  actually transmits. See below.

### Fixed — money

- **The Send box could pay the previous recipient.** Editing one resolved
  address into another left the old resolution live for the 400ms debounce while
  the Pay button gated on the text on screen, so both guards passed — for
  different addresses. The decision now lives in one tested place.
- **A retried payment could be sent twice.** `rpc()` retries when the message
  port closes without a reply, and paying a Lightning Address asks the endpoint
  for a *fresh invoice* each time — a second payment hash the node cannot
  recognise as a duplicate. Payments are now at most once per click.
- A typed amount and comment carried over to the *next* recipient, payable at a
  figure chosen for someone else, with a note meant for someone else attached.
- Releasing a Lightning Address now asks first. It is irreversible, and anywhere
  the address was already published, zaps start reaching whoever claims it next.
- Three holes in the LNURL guard: redirects were followed (defeating the check
  entirely), the 64 KB response cap was applied *after* the body had been
  buffered, and there was no request timeout. Also fixed a hostname test that
  rejected real domains — `fdn.fr`, `fc2.com`, `fdroid.org`.

### Fixed — data loss

- **Adding a Lightning Address to your profile could erase the rest of it.**
  `kind:0` is replaceable, and a profile read that reached no relay was
  indistinguishable from "this user has no profile", so the merge published a
  document containing only the address. Name, picture, about and nip05 gone.
- **Editing your mute list could erase your private mutes.** The same shape: a
  read no relay answered resolved as an empty list, and publishing it replaced
  the real one — including the NIP-44 encrypted entries that survive only by
  being round-tripped.
- **The onboarding wizard could overwrite an existing vault.** Creating a vault
  replaces it outright, and the wizard's check for an existing one turned any
  failure — a cold worker, or an active lockout — into "there is no vault". It
  now refuses.

### Fixed — the popup "failing sometimes"

- **The wallet vanished from the menu after the extension had been idle.** On a
  "Never lock" vault the background re-unlocks on every service-worker cold
  start, and the popup asked whether the vault was locked without waiting for
  that to finish — then never heard the correction. Every locked-gated action
  stayed hidden for the life of that popup.
- The popup now notices when the vault locks *or* unlocks underneath it. An
  auto-lock with the popup open used to leave it rendering unlocked UI, and an
  incoming request got no unlock prompt at all — it just timed out.
- The approval sheet could show requests that had already been resolved, and act
  as though it had signed them. Its refresh had no protection against overlapping
  runs, and the one background path that empties the queue never announced it.
- None of the approval actions had error handling. A failure left the queue
  half-resolved with nothing said, on the surface whose whole job is releasing
  the signing key.
- The popup re-did its own work on every open — a runaway refresh loop, and a
  home view that reloaded whenever any profile resolved.
- Connect, "Not now"/"Never", and the identity toggle all failed silently. The
  toggle was the worst: it displayed a privacy setting that had never been saved.
- The globe and the home card no longer contradict each other, and "Never" can
  no longer permanently dismiss a site you just connected.
- A failed read is no longer reported as a definite answer. The wallet setup
  flow could render over a working wallet; "set up post-quantum keys" could be
  shown to someone whose attestation was live; activity showed "No activity yet"
  for a log it had failed to load.
- The unlock screen shows that it is working. Deriving the key takes seconds and
  nothing on screen changed, so the most-used gate in the product read as dead.
- The post-quantum panel's "How it works" button now appears. It never had.
- Wallet settings and the permissions add-rule dialog now cover the popup instead
  of being clipped to their section.

### Fixed — text and colour

- `wizard.type.nsec` and friends rendered as raw key names on the last screen of
  first-run onboarding, in **all six languages**, for anyone importing an nsec or
  an npub.
- Two strings dropped their placeholders in five languages, including the one
  asking you to publish a Lightning Address without showing which one.
- Eleven CSS custom properties were used and defined nowhere. Four rules were
  being dropped entirely; the info tooltip's background was one of them, which is
  why it was transparent.
- Body and secondary text now meet WCAG AA contrast, and `prefers-reduced-motion`
  is respected.

### Internal

- Two new CI gates: one that scans the source for every string the UI asks for
  (comparing locales against English does **not** catch the bug above, because
  English was missing the keys too), and one that checks every `var(--token)`
  resolves.
- Test suite 1089 passing, up from 1045.
- `docs/deployment.md` is new. `docs/ui-ux-audit.md`,
  `docs/frontend-remediation-plan.md` and `-round-2.md` record the audits.

### Store release notes

> **Pay to a Lightning Address**
>
> You can now send to a Lightning Address (`name@domain`) from the Send box, not
> just a BOLT11 invoice.
>
> This release also fixes a long list of problems that only appeared some of the
> time — the wallet disappearing from the menu after the extension had been idle,
> the unlock screen looking frozen while it worked, buttons that failed without
> saying so, and several cases where a network hiccup could cost you data:
> adding a Lightning Address to your profile could wipe the rest of it, and
> editing your mute list could erase your private mutes. Both are fixed.
>
> Payment safety: the Send box can no longer pay a previous recipient while you
> are still typing a new one, and a payment that is retried after a connection
> drop can no longer be sent twice.
>
> Firefox users will see a data consent screen on update. It lists what the
> extension sends and where — your wallet's payment details to your wallet
> backend, and your profile, mute list and avatar to your own relays. Nothing
> else leaves your device, and your keys never do.

---

## 0.5.2 and earlier

Not recorded here; this file starts at 0.6.0. See the git history and the
release notes on each store listing.

**0.5.2 was disabled on addons.mozilla.org** on 2026-09-02 for declaring
`"data_collection_permissions": { "required": ["none"] }` while the wallet was
transmitting payment data. `0.6.0` is the fix. See `docs/deployment.md`.
