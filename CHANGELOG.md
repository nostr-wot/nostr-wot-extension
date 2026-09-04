# Changelog

Notable changes per release. Store-facing copy for each version is in its
`### Store release notes` block; the rest is for us.

See `docs/deployment.md` for the store submission process and the rejections we
have had.

## Unreleased

No version bump yet. A structural pass over the frontend — five parallel audits covering component reuse, CSS strategy, module boundaries, the overlay system and the oversized components — plus two security fixes the audits surfaced on the way.

### Fixed — security

- **Two relay readers accepted events without verifying signatures.** `fetchKind0Read` and `fetchMuteList` open their own sockets and matched on `pubkey` and `kind` only — fields a relay merely asserts. Both feed a read-modify-write of a replaceable event that the user then re-signs and publishes, so a forgery was not just displayed: a `kind:0` carrying the attacker's `lud16` would have redirected the user's zaps, and a forged `kind:10000` replaces their NIP-44-encrypted private mutes with ciphertext the relay chose. `liveQuery` verified all along; these two bypassed it.
- **A relay that serves a forgery can no longer vouch for emptiness.** Rejecting the bad event was not enough on its own — these reads also report `reachable`, and `reachable: true` with nothing found means "safe to overwrite", so garbage followed by `EOSE` would still have wiped a profile. `reachable` now counts only sockets that answered *and* never served an invalid event. See `docs/security.md` §12.1.

### Fixed — the popup painting over its own consent surfaces

- **The lock screen and the approval sheet could be painted over by a deposit QR.** Five dialogs escaped to `#root` portals to get out of a containing block created by the menu's slide animation. That cause was fixed in `c01f087`; the portals outlived it, and because they landed outside `.card`'s stacking context they outranked every consent surface. All five now render in place.
- The in-popup unlock prompt sat at `z-index: 360` while wallet dialogs sat at 500 — the surface demanding an unlock outranked the one asking for it. There is now a stacking ladder in `theme.css`, and `--z-lock` beats every task surface by construction.
- Menu sections and the permissions list had no scroller anywhere in their chain, so anything taller than the card was clipped by `overflow: hidden` — not merely off-screen, unreachable.

### Fixed — other

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
- `src/wizard/` is now a peer of the three entry points. `onboarding` had been importing it from `../popup/components/Wizard` — the only cross-entry reach-in in the tree, and there are none left.
- Tests 606 → 1206.

### Changed — one component per pattern

- **Every clickable list row is `ListRow`.** `NavRow`, `NavItem` and the permissions screen's own `.permRow` were three implementations of `[leading] [title / subtitle] [chevron]`, which is why the chevron was brand coloured in two of them and muted in the third, and why only one ellipsised a long subtitle. Chrome is now the variant. Three row-shaped things are deliberately excluded and say why in the component's own comment: the menu's language trigger (a dropdown trigger, chevron pointing down), the top bar's account rows (a container of hover-revealed controls, not one control), and the wizard's follow suggestions (a multi-*select* list, and the only one — a variant with a single caller is a guess about the second caller, which is how `NavRow` and `NavItem` became two things).
- **`Tabs`, `Chip` and `SeedWord`** replace the copies of each. All three gained the semantics the hand-rolled markup lacked: `role="tablist"` with `aria-selected`, and `aria-pressed` on a chip. `Chip` takes `toggle={false}` for a chip that is a one-shot action — the recovery-phrase word bank consumes a word when tapped, and announcing every available word as "not pressed" describes a toggle nobody built.
- `Tabs` keeps two variants because the product has two tab designs — the wallet uses outlined segments, the NIP-46 step a track with a moving thumb. Converging them is a design decision, not a refactor, and is still worth making.
- Raw `<button>` outside `src/components/` is down to 24, and each remaining one is a documented mismatch rather than an omission — a semantic-scope colour set no variant covers, a control joined to an adjacent `Select`, a bordered-at-rest chip against `IconButton`'s chromeless contract.

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
