# Changelog

Notable changes per release. Store-facing copy for each version is in its
`### Store release notes` block; the rest is for us.

See `docs/deployment.md` for the store submission process and the rejections we
have had.

## 0.8.2 — 2026-09-23

### Improved

- Align dark mode with nostr-wot.com, using near-black popup surfaces, distinct lighter hovers and readable permissions menus; keep La Crypta secondary-button hovers lime.
- Add subtle 4px backdrop blur to dialogs and approval overlays.
- Improve wallet spacing and localized connection guidance with official setup links and wallet API-key explanations.
- Negotiate signed NWC wallet capabilities, prefer NIP-44, retain legacy NIP-04, and try alternative relay connections before publication without replaying payments.

### Fixed

- Validate candidate wallets before persisting their credentials; preserve existing connections on failed validation.
- Validate NWC response provenance, methods and fields, accepting documented Alby/LNbits nullable fields and signed fees.
- Preserve transaction state, propagate lookup failures, and prevent ambiguous payment intents from creating another invoice or replaying a payment.
- Reject fractional receive amounts and prevent send-dialog closure during payments.

### Verification

- 1,783 tests pass, including signed local NWC wallets, production handlers and mounted UI flows. See `docs/nwc-audit.md` and `docs/nwc-compatibility.md` for coverage and live-provider limitations.
- Popup-width component previews cover light/dark setup, expanded settings, permission menus, hover colors and dialog blur. No live-wallet payment certification is claimed.

### Store release notes

- Improved dark-mode menus, permissions, popup backgrounds and hover contrast; corrected La Crypta button hovers.
- Added subtle background blur behind dialogs and approval popups.
- Improved wallet setup spacing and translated guidance, with links to connection guides and a clearer LNbits API-key explanation.
- Added modern NWC encryption negotiation while retaining legacy wallet support, plus compatibility fixes for wallet responses.
- Validate wallet connections before saving them and handle connection failures more reliably.
- Show uncertain payment outcomes clearly and prevent automatic replay of the same payment intent.
- Improved invoice amount validation, payment-dialog behavior and transaction status handling.

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
- See [release audit](docs/audits/2026-09-20.md) for verification scope and remaining native/provider limitations.

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
