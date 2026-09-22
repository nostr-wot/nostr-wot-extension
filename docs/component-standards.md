# Component Standards

Guidelines for shared components, hooks, and utilities in the Nostr WoT Extension.

---

## 1. Shared Component Inventory

All shared components live in `src/components/`, each implemented in its own `Name/index.tsx` and imported from `@components/Name`. These entrypoints contain the implementation, not forwarding exports. There are **56**; the inventory below is checked against the component folders by the test suite.

**Layout and overlays** — `Modal` (centered dialog: Escape, focus-on-open, drag-safe backdrop), `OverlayPanel` (opaque full-screen navigation sheet), `ConfirmDialog` (are-you-sure, built on Modal), `EventDetailModal`, `Dropdown`, `InfoTooltip`, `Splash`, `Container` (a bare `flex` box — `column`, `row` or the padded card-like `box` — owning only its variant and `gap`).

**Content** — `FollowReplacementNotice` (shared danger notice for pending cards and event details), `ProfileSummary`, `TextBlock`, `DetailDisclosure`, `Card`, `Heading`, `Text` (body copy at one of four roles — `body` / `secondary` / `muted` / `hint` — plus a `mono` flag), `SectionLabel`, `EmptyState`, `StatusNotice`, `StatusDot`, `FieldDisplay`, `FormError`, `EventPreview` (+ `kinds/`), `PublishRow`, `QrCode`, `Avatar`, `SiteIcon`, `WalletBalance`.

**Controls** — `ApprovalActions` (shared approve/reject split buttons; remembered per-type choices open above detail footers and below sheet headers), `ActionMenu` (anchored action choices with keyboard navigation and outside dismissal), `ImageEditorButton`, `CopyButton`, `Button`, `IconButton`, `LinkButton`, `Input`, `Textarea`, `InputRow`, `Select`, `Toggle`, `Tabs`, `Chip`, `ChipGroup`, `ListRow`, `ActionTile`, `SeedWord`, `EditableList`, `RemoveButton`, `ScrollWheelPicker`, `LanguageWheel`, `PasswordPairFields`.

**Feedback** — `Spinner`, `ScreenReaderStatus`.

`ScreenReaderStatus` renders visually hidden status feedback. Keep it mounted even
when its children are empty, then update its content when an action completes.
`CopyButton` uses it for clipboard feedback; visible status messages retain their
own presentation.

**Decoration** — `TopoBg`, `PulseLogo`, `AnimatedWotLogo`.

Read the component's own file for its props; duplicating them here is what rotted last time.

### Reach for these before writing new chrome

The recurring failure is not that a primitive is missing, it is that a feature hand-rolls one it already has. `Modal`'s own docstring records that it exists because the popup had grown three separate dialog implementations — and four more were written afterwards. Before adding a backdrop, a close button, a chip row, or an are-you-sure, check this list.

**Every centered dialog is now a `Modal`** — the wallet's deposit, send and tx-filter, the permissions add-rule, `KeyActionModal`, and the wizard's encrypted backup all used to hand-roll a scrim, a card, a header and a close button, at five different scrim opacities, three dismissal behaviours and no Escape key between them. Migrating them deleted ~280 lines of CSS and gave each one Escape, focus-on-open, `role="dialog"`, a scrolling body with a pinned footer, and the drag-safe backdrop rule.

**Every clickable list row is a `ListRow`.** `NavRow`, `NavItem` and the permissions screen's `.permRow` were three implementations of `[leading] [title / subtitle] [chevron]`, which is why the chevron was brand coloured in two of them and muted in the third, and why only one ellipsised a long subtitle. Chrome is the variant: `grouped` is a bare row for a bordered container (a `Card`, or a rounded scroll list) to own the edge, siblings separated by a hairline; `standalone` carries its own card chrome.

Two row-shaped things are deliberately *not* `ListRow`: the top bar's account rows carry hover-revealed edit/copy/remove buttons, so the row is a container of controls rather than one control; and the wizard's follow suggestions are a multi-**select** list with a checkmark. That last one stays hand-rolled only until there is a second multi-select list — **a variant with a single caller is a guess about what the second caller will need**, and guessing is how `NavRow` and `NavItem` became two things.

**`Heading`, `SectionLabel` and `FieldDisplay` are the three pieces of a form or summary screen**, and each replaced a pattern that had been copied rather than shared. `text-3xl font-bold text-heading` was written out at fourteen call sites — every wizard step title — with four more sizes alongside it that had no name, so a new screen picked whichever one it was copied from. `Heading`'s level chooses the size **and** the element, because a title rendered as a `<span>` is invisible to anything navigating by heading; that was live in the wizard's own step header. `SectionLabel` had the same three declarations at a dozen sites with the spacing below varying between nothing, `mb-1` and `mb-3` — and it renders a real `<label>`, so **give it `htmlFor`** whenever there is a field to point at.

`FieldDisplay` is one labelled value, and there were four implementations: this component, the wizard's done step, the sub-account summary, and seven rows in the wallet's send dialog. They disagreed on every detail — the label muted in one and secondary in another, semibold in one and medium in another, the value right-aligned in two of the four. None of that was decided. The two differences that *are* real became variants: `divided` draws the hairline for a stack filling a `Card`, and `caps` is the wallet's dense block where a small uppercase label sits beside a value that matters more than it does.

**`FormError` is the line a form shows when it could not do what was asked**, and it is worth knowing why it exists: there were twenty-six of them across twenty-one files, and exactly one carried `role="alert"`. Everywhere else the error raised by a failed submit was never announced — a screen-reader user pressed the button and heard nothing at all. The visual duplication (two font sizes for the same thing, chosen by nobody) was the smaller half of the problem. It renders nothing for an empty message, so the `{error && ...}` guard goes away too. `Input` and `InputRow` keep their own field-level error: that belongs to the field's contract, not the form's.

**Overlay headers use `IconButton` for every close control**, including the uncentered Activity header, with the translated close label for assistive technology.

**Filled `Button` variants explicitly remove the browser border.** Preflight is off, so omitting a border utility leaves the native raised border visible; outline variants retain their explicit border.

**`StatusNotice` owns tinted callouts as well as compact status rows.** Use `variant="callout"` for paragraph warnings, with an optional `label` above the body. Both variants share 12px horizontal padding, 10px vertical padding, an 8px icon gap and 10px corners. Callouts top-align a non-shrinking icon and wrap their body at 12px; status rows keep their existing centered label and tooltip. Use `warn` for caution, `error` for the existing red secret-export warnings, and `ok` for positive status. Caller margins stay in `className`. Recovery, auto-lock, account removal, encrypted backup and unavailable post-quantum notices all use this component; `FormError` remains the live form-error line.

**A component can be a form rather than a screen.** `EncryptedBackupForm` exists because "export the key as an `ncryptsec`" had two implementations — the vault's key dialog, which explained the format, warned that nothing can recover the password, showed a live checklist of what the password still needed and offered both a download and a copy; and the wizard's, which had two bare password fields and a button that objected only once pressed. Same operation, same irreversible consequence, and the thinner one was what a new user met. It is deliberately **not** a `Modal`: the vault dialog is already inside one and switches between four actions, so a modal there would nest. Each caller brings the shell, the component brings the body and its own actions. Reach for this shape whenever the duplicated thing is a *flow* rather than a piece of chrome.

**`PasswordPairFields` is the primitive `EncryptedBackupForm` was reaching for underneath its own checklist.** "Choose a new password, twice" was written out by hand at six sites — every encrypted export, the vault's change-password form, and vault creation — and `@domain/vault/passwordPair.ts` already shared the *rule*; what stayed duplicated was the *form*: two password inputs, the live checklist, and whether the submit button waits for both. Only `EncryptedBackupForm` had the checklist; the other five refused only once pressed, leaving the user to guess which requirement failed. The component is deliberately thin — two `Input`s and an optional checklist, rendered as a fragment rather than a wrapped block, because every call site already lays its own form out as a column with its own gap, and a nested one here would double it or fight it depending on the site. It takes no submit button and no label of its own; a caller renders both, same as `EncryptedBackupForm` did, because the six sites disagreed on whether a label existed at all. `usePasswordPair()` is the state half — password, confirm, and the derived `longEnough` / `matches` / `ready` a submit button waits on — backed by a pure `derivePasswordPairState` in the same file, precisely so that derivation has a test, per [§2's rule](#extract-the-decision-not-just-the-markup) that only the pure half of a component buys one. A **third field that is not part of the pair** — the change-password screens' *current* password — stays outside the component entirely; swallowing it into the pair would have hidden a field this component has no business owning.

**`Text` and `Container` are the two patterns underneath everything above them** — a line of body copy, and a flex box with a gap — and they existed nowhere until `OnboardingApp` and `EditProfileOverlay` turned out to be near-identical copies of each other at the markup level. `text-xs text-muted` alone was written out at twenty-five sites; `flex flex-col gap-N` with N picked freely was worse. `Text` resists a size-and-colour prop for every combination on purpose: `body`, `secondary`, `muted` and `hint` are the four roles the tree actually used, `hint` earning its own variant only because it keeps `leading-loose` where `muted` does not — read as a sentence, not scanned as a label. There is no `size` prop; the handful of sites that want `secondary` at `text-sm` instead of the default `text-md` pass it through `className`, which wins the same way every other override in this codebase does. `Container`'s `row` defaults to `items-center`, matching every row that carried it by hand; its `box` variant is the card-like padded shape from the wallet's send dialog and the permissions screen's selected-rule row — deliberately not `Card`, because the padding, radius and margin all differ from it. `stickyFooter` is the wizard step's own pinned action bar, retyped character for character at the bottom of all ten steps before this existed.

**`Tabs`, `Chip` and `SeedWord`** cover the other patterns that had been copied rather than shared. `Tabs` has two variants because the product genuinely has two tab designs — the wallet uses outlined segments, the NIP-46 step a track with a moving thumb — and picking one is a design decision rather than a refactor; converging them is still worth doing. `Chip` carries a `tone`, because on the permissions screen the colour *is* the meaning: allow is not merely "selected", it is allow. It also takes `toggle={false}` for a chip that is a one-shot action rather than a switch, which suppresses `aria-pressed` — the recovery-phrase word bank consumes a word when tapped, and announcing every available word as "not pressed" describes a toggle nobody built.

**A component owns its own variants, including the tight ones.** The 24-word recovery grid used to shrink its words with a descendant selector written in the *grid's* stylesheet. That reaches a plain `div`; it does not reach a component with its own scoped class names, so extracting `SeedWord` would have silently dropped it. Hence `SeedWord`'s `compact` prop. Whenever you turn repeated markup into a component, **search the stylesheets for descendant selectors that were reaching into it** — they fail silently, with no build error and no runtime warning.

`Modal` props worth knowing: `maxWidth` (px, for dialogs that would look adrift at full width), `footerRow` (equal side-by-side actions instead of one full-width button), and `dismissOnBackdrop={false}` for anything that must be *answered*. **Use that last one whenever secret material is on screen** — `KeyActionModal` shows an nsec and a seed phrase, and its old shell dismissed on `click`, so selecting the value and releasing outside the card closed the dialog and wiped it mid-read.

---

## 2. When to Extract

Extract a component when:

- It is used (or will be used) in **2+ places**.
- It encapsulates a discrete UI pattern (e.g., an input row, a toggle, a card).
- It has clear props and no tight coupling to parent state.

Do **not** extract if:
- The component only makes sense in one context.
- Extracting would require passing many parent-specific callbacks through props.

### Extract the decision, not just the markup

Most tests use `node:test` over pure modules. `status-notice.test.ts` also uses React server rendering to check presentational markup; there is no mounted, interactive React test harness. So any rule that stays inside a component is, by construction, untestable, and the only extraction that buys a test is the *pure* half: the predicate, the grouping, the status derivation, the validation.

`siteState.ts`, `sendTarget.ts` and `approval.ts` isolate testable UI decisions. Approval is account-scoped: `requestMatchesAccount` rejects unknown/different accounts and conflicting author keys, while the extension popup lists all requesting websites explicitly. `filterPendingForDomain` remains available for origin-scoped surfaces; it is no longer the popup approval queue filter.

When a component holds a rule that would be embarrassing to get wrong, that rule wants its own module and its own test file — and the test file wants registering in `tests/run.sh` **and** `.github/workflows/tests.yml`, or it never runs.

### Say what it is

A file's name should survive someone opening it. Four did not: `FiltersModal` and
`ActivityModal` rendered `OverlayPanel`, `HomeTab` was the only screen and there were
no tabs, and `Profile/Mutes/RelaysCard` each rendered a `NavRow` inside one shared
`Card`. They are `FiltersOverlay`, `ActivityOverlay`, `Home` and `*Row` now.

The vocabulary the code is reaching for: **Overlay** = full-height `OverlayPanel` ·
**Modal**/**Dialog** = centered, via `Modal` · **Panel** = a sub-view of a section ·
**Section** = a destination `MenuOverlay` pushes · **Card** = a boxed container ·
**Row** = a tappable list row · **Step** = one wizard screen.

### Navigation is a context, not seven props

`PopupApp` used to hand `Home` seven navigation callbacks, which it drilled another level into the rows — a router API simulated with props, where every new destination touched three files. `NavigationProvider`/`useNavigate()` replaces it: a row asks for the destination it needs instead of being handed it. `PopupApp` still owns the `OverlayType` state machine; only the delivery changed. Data still travels as props — `SiteControls` takes a `domain`, because that is data rather than a destination.

### The tree

```
src/
  assets/      icons
  components/  shared UI primitives, one folder per component
  screens/     feature screens shared by browser documents
  context/     the eight React contexts
  constants/   configuration and protocol values, grouped by purpose
  domain/      feature logic, one folder per module, pure and tested
  services/    I/O and orchestration, grouped by feature
  utils/       no domain knowledge
  hooks/       every hook, feature or generic
  lib/         cryptographic primitives and the cross-browser compatibility shim
  entrypoints/ popup/, prompt/, onboarding/: HTML, mounting and app shells
```

Three rules behind that shape. **Entry points do not own feature screens.** Keep document setup and app shells in `entrypoints/`, feature UI in `screens/`, and reusable controls in `components/`. **Hooks live together**, not beside the one screen that happens to use them first, because that is how `useSiteState` ended up somewhere `useWalletBanner` had to reach for it. **A type lives with the logic that owns it**, not in a shared types folder — `domain/activity/activity.ts` defines `ActivityEntry` beside the filters that read it, `domain/profile/profileMetadata.ts` defines `ProfileMetadata` beside the merge that maintains it — so a shape has one definition and no call site learns a second import path for the same idea. A purely-UI type goes where it is used instead: `Option<T>` in `components/option.ts` for selection controls, `IconProps` beside the icons. A `models/` folder used to hold every shared type and competed with `domain/` for the same job — `domain/activity/activity.ts` opened by importing `ActivityEntry` from `models` and re-exporting it, so a reader visited two files to learn one thing. It is gone.

Aliases: `@constants`, `@components`, `@screens`, `@hooks`, `@domain`, `@services`, `@context`, `@utils`, `@styles`, `@lib`, `@assets`. Use them rather than climbing out of a folder with `../../`. Each one answers a question about the thing you are writing, so if two of them seem to fit, the file is probably doing two jobs — see §7 for what each one means.

### `src/domain`, `src/services`, `src/utils` — and `src/lib`

`src/shared/` was twenty-six files in one flat folder, and the name had stopped meaning anything: a Lightning invoice's expiry rule sat beside a clipboard helper beside the RPC transport. It is now split by what a thing *is*.

- **`src/constants`** — one source for configuration, limits, timeouts, storage keys, protocol values and fixed lookup data. Import purpose-specific files through `@constants`; constants never import runtime services or UI. Component styles, renderer maps, function dispatch tables and mutable state stay with their implementation.
- **`src/utils`** — no domain knowledge at all. Formatting, `downloadFile`, `paginate`, URL predicates. You could paste any of it into another product.
- **`src/domain`** — the decisions this product makes, one folder per module. Pure functions over plain data: no React, no `browser.*`, no network. That is what makes them testable, and every one of them has a test.
- **`src/services`** — I/O and orchestration, grouped into `background`, `browser`, `i18n`, `media`, `permissions`, `relays`, `signing`, `vault` and `wallet`. Browser state, network requests, persistence and translated permission labels belong here. Services must not import React or UI modules; the popup RPC client remains `src/services/rpc.ts`.
- **`src/lib`** — cryptographic primitives and the single cross-browser compatibility shim. No application orchestration or React. Reuse these implementations rather than copying them. Public icons and locales remain in `src/public/` so Vite copies them to the runtime paths the manifest expects.

That last rule was already being broken once. `src/shared/browser.ts` was a six-line copy of `src/lib/browser.ts` that omitted its Safari `storage.session` polyfill, and twenty-one UI files imported the copy — seven of which call `storage.session` directly. It is deleted; everything uses `@lib/browser.ts`.

### Where a feature lives

`src/screens/Wizard/` contains the account-creation flow shared by the popup and
onboarding entry points. Sharing a screen does not change its semantic category:
entry-point directories host browser documents; feature screens belong in
`screens/`; generic reusable controls belong in `components/`. Wizard decisions
remain in `domain/wizard/` and its flow hook remains in `hooks/`.


`MenuOverlay` importing the sections it pushes is not a boundary violation — that is a
router importing its routes. Note that `PermissionsSection` has two hosts (the menu
and `PopupApp` directly), so it is not purely a menu section.

### One shape, one definition

`PendingRequest` had five definitions: the canonical one in `src/domain/signing/types.ts` and four narrower restatements across ApprovalOverlay, ApprovalCard, EventDetailModal and PopupApp. They had already drifted into a type error that one of the copies documented in a comment rather than fixing. Import the canonical type; if it does not fit, widen it there.

---

## 3. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Folder | PascalCase | `src/components/ChipGroup/` |
| Component file | PascalCase `.tsx` | `ChipGroup.tsx` |
| CSS Module | Same name `.module.css` | `ChipGroup.module.css` |
| Hook file | camelCase `use` prefix `.ts` | `useVaultUnlock.ts` |
| Utility file | camelCase `.ts` | `activity.ts` |

---

## 4. CSS Patterns

- **Tailwind utilities first** — see §7. Only `TopoBg.module.css` remains, containing embedded SVG background art and its layering rules.
- **camelCase class names** in the few modules that survive — e.g. `chipGroup`, not `chip-group`.
- **No global styles** in a shared component. Tokens come from `src/styles/theme.css`.
- **Avoid `!important`** — and note that an unlayered CSS rule already outranks a Tailwind utility, so reaching for it usually means the override belongs in `cn()` instead.
- **Keyframes are NOT local.** They live in `src/styles/animations.css` and are registered as `animate-*` utilities. This reverses earlier advice, and the reason is in §7: Vite scopes a keyframe name to the file that declares it, so a component referencing one it does not itself define never animates, silently — which was live twice.

### Tokens

`theme.css` is the whole palette *and* the scales. Reach for a token before typing a literal; the families are spacing (`--sp-1`…`--sp-14`, a 2px grid), type (`--fs-2xs`… `--fs-display`, `--fw-*`, `--lh-*`), radii, motion (`--transition*` — `--transition` is the 0.15s house default), shadows, brand tints, status families, surfaces, and the z-ladder.

Each scale was derived from what the stylesheets already did, not invented: the type scale collapses 15 distinct sizes that had drifted as far as `13.5px` and `11.5px`, and the status families collapse four spellings of green, four of red and four of amber down to one each plus the `-strong` (AA-safe on tint) and `-bright` (status dots) variants that genuinely differ.

`tests/theme-tokens.test.ts` enforces that every `var()` resolves and that anything used by two stylesheets is defined in `theme.css`. **Never give a `var()` a fallback** — a `var(--danger, #ef4444)` sitting next to a `var(--danger, #dc2626)` is how the palette lost its say in the first place, and the fallback hides the failure the test exists to catch.

### Stacking

Overlays take their `z-index` from the ladder, never a fresh number:

| Token | Value | For |
|---|---|---|
| `--z-raised` | 10 | tooltips, inline dropdowns |
| `--z-topbar` | 200 | top bar and its popovers |
| `--z-panel` | 300 | full-screen navigation panels (`--overlay-z` aliases this) |
| `--z-sheet` | 500 | bottom sheets, wizard, full-page sub-overlays |
| `--modal-z` | 700 | centered dialogs |
| `--z-lock` | 900 | the unlock prompt |
| `--z-splash` | 1000 | boot splash |

### Scales, not literals

Spacing, type, weight, line-height, radius and motion all have tokens; ~1,200 declarations are on them. Reach for a token first. The scales were derived from what the stylesheets already did, so an exact value almost always has a name — and where one genuinely does not (`border-radius: 10px`, the most-used rounding in the product) the answer was to *name it* `--radius-panel`, not to snap the design to a neighbouring step. Adding a token beats bending the design; typing a literal beats neither.

Two rules behind it. **Nothing may outrank `--z-lock`**: the unlock prompt sat at 360 while wallet dialogs sat at 500, so the surface demanding the unlock could paint over the one asking for it. And **do not portal a dialog to `#root`**. Five of them used to, to escape a containing block created by the menu's slide animation; that cause was fixed in `c01f087`, but the portals outlived it, and because they landed outside `.card`'s stacking context they painted over the lock screen and the approval sheet — in a key-custody extension, a deposit QR could cover the consent surface. They now render in place.

### Scrolling

A panel whose content can exceed the card must have exactly one scroller in the chain, and every flex ancestor of it needs `min-height: 0`. Without that the ancestor's min-content height wins over `flex: 1`, the box grows to fit, the scroller never engages, and the overflow is clipped dead by `.card`'s `overflow: hidden` — content that is not merely off-screen but unreachable. This bit both the menu sections and the permissions list.

---

## 5. Hooks

All shared hooks live in `src/hooks/`, one hook per file — outside any feature folder, because a hook that sits beside one screen is a hook the next screen re-writes.

| Hook | Purpose |
|------|---------|
| `useRpc<T>(method, params, opts)` | Call background RPC on mount, with reload/loading/error (generic) |
| `useVaultUnlock({ onSuccess })` | Password state, unlock RPC, error handling, input ref, brute-force lockout (escalating: 1/5/15/30 min after every 5 failures) |
| `useAnimatedVisible(visible)` | Manages mount/unmount transitions for overlays |
| `useCopy(resetAfterMs?)` | `{ copy, copied, failed }` — clipboard write that reports its outcome |
| `useOutsideClick(ref, onOutside, enabled?)` | Dismiss an anchored surface on outside **mousedown** |
| `useTimedReveal(empty, ttlMs)` | Show a secret blurred, and take it off screen after `ttlMs` |
| `useRelayCache(name, onRefreshed)` | Re-read when the background refreshes a cached relay answer |
| `useBrowserStorage(key, default, area)` | A `browser.storage` value that follows `onChanged` in its own area |
| `useWizardFlow()` | State machine hook for onboarding wizard |
| `useAsyncResource<T>({ load, deps })` | `data` / `loading` / `error` for one async read, with the run-version guard |
| `useStorageWatch(matchers, onChange)` | Re-run on `storage.onChanged` for given (area, key) pairs |
| `usePagedList(items, pageSize)` | A growing rendered prefix of an already-loaded array |
| `usePasswordPair(minLength?)` | The "new password, twice" pair, with `ready` derived rather than stored |
| `useApprovalQueue()`, `useSiteState()`, `usePendingCount()`, `useWalletBanner()` | Feature reads, each extracted from a component that was doing it inline |

`useBrowserStorage(key, default, area)` was documented here for a long time before it existed, so two components each hand-rolled its exact body rather than finding it. It is written now. **Pass the area** — most keys are `local`, but `relays` is `sync`, and a listener that ignores the area reacts to writes it should not see.

**Use `useCopy` for every clipboard write.** `copied` is what you render; the promise resolves to whether the write actually landed, for the callers that must *decide* on it (the wizard only marks a seed phrase backed up if the copy succeeded). Copying a value the user cannot verify by eye — an nsec, an ncryptsec, a seed phrase — with a bare un-awaited `navigator.clipboard.writeText` makes a refused clipboard look exactly like a successful copy. That was live on all three of those values.

**`useAsyncResource` is where "a failed read means unknown" is enforced.** Every context in this popup reads something over RPC that can fail, and the rule that matters is that a failure must never collapse into a negative answer — "we could not reach a relay" is not "nothing is published", and acting on the second when the first is true overwrites a profile or a mute list. A thrown load sets `error` and leaves `data` alone, so the rule holds by construction instead of by each context remembering it. `VaultContext` deliberately overrides this: a vault it cannot read is treated as **locked**, because there the safe direction is the negative one.

**Related fields belong in one `data` object.** A consumer must never see one field from a new read paired with another from an old one — the post-quantum panel showing a fresh `status` beside a stale `published` is a wrong answer rather than a late one. One resource, one `patch()`, updated atomically.

### Hook guidelines

- Always return objects (not arrays) when returning 3+ values — allows destructuring by name.
- Keep hooks focused on one concern.
- Prefix with `use`.

---

## 6. Shared Utilities

Split by what a thing is (see §3 for the boundary): `src/utils/` has no domain knowledge, `src/domain/` holds the product's decisions one folder per module, `src/services/` holds the things that talk to something. One concern per file.

| File | Exports |
|------|---------|
| `@services/rpc.ts` | `rpc<T>()`, `rpcNotify()`, `RpcError` |
| `approval.ts` | `filterPendingForDomain`, `partitionPending`, `groupApprovals`, `groupNip46`, `liveIds`, `isRequestLive`, `isGroupLive`; imports the canonical `PendingRequest` from its signing-domain module |
| `profileMetadata.ts` | `mergeProfileMetadata`, `profileHasChanges`, `ProfileMetadata` — the kind:0 read-modify-write |
| `txFilter.ts` | `matchesTxFilter`, `matchesTxSearch`, `filterTransactions`, `dateRangeToTs`, `countActiveFilters`, `isPlaceholderMemo` |
| `invoiceExpiry.ts` | `describeInvoiceExpiry` — takes `now`, so it is testable |
| `pqcState.ts` | `derivePqcCardState`, `isAlreadyPublished`, `PqcStatus`, `PqcPublished` |
| `permissionRules.ts` | `countDecisions`, `filterKeysForAccountKind`, `availablePermKeys`, `buildRuleKey`, `DECISIONS` |
| `passwordPair.ts` | `validatePasswordPair` — the "new password, twice" rule |
| `vaultAutoUnlock.ts` | `isVaultOpen` — never-lock auto-unlock, behind its mode check |
| `activity.ts` | `groupActivityEntries`, `filterActivityEntries`, `buildDayGroups` |
| `pagedList.ts` | `paginate` — the render window behind `usePagedList`. Distinct from `txPager.ts`, which pages a *remote* API: the activity RPC already returns the whole log, so there is nothing left to fetch, only a prefix to grow |

`permissionRules.ts` is split from `permissions.ts` (the `@services` runtime permission cascade — `check`, `save`, `clear`, the migrations) on purpose: that module imports `t()`, which drags in the browser layer and makes it unloadable under plain `node --test`. The rules that *decide* something are the ones worth testing, and they need no i18n. Keep new decision logic on the i18n-free side of that line.
| `utils/format/` | Generic text, number, clock and byte formatting; no application I/O |
| `domain/nostr/display.ts`, `domain/wallet/display.ts` | Nostr public-key and sats formatting |
| `services/i18n/timeLabels.ts`, `services/i18n/paymentLabels.ts` | Translated relative time and payment messages |
| `permissionLabels.ts` | `formatPermissionLabel` — the wire method / permission key to its display string |
| `url.ts` | `getDomainFromUrl` |
| `activeTabDomain.ts` | `resolveActiveTabDomain` — which site the popup is looking at |
| `siteState.ts` | `resolveSiteState` — connected / notConnected / error |
| `sendTarget.ts` | `resolveSendTarget`, `canSend` — what the wallet's Send box may pay |
| `src/constants/relays.ts` | Canonical relay defaults, derived CSV and shared cache keys |
| `src/constants/nostr.ts` | `KIND_LABELS` |
| `src/constants/vault.ts` | Auto-lock, password and lockout policies |
| `blossom.ts` | Blossom media upload utilities |
| `wizardMachine.ts` | Onboarding wizard state machine |

---

## 7. Tailwind

Tailwind v4 is wired to the tokens in `src/styles/theme.css` rather than to its own defaults, in `src/styles/tailwind.css`. A utility and a stylesheet reaching for the same idea therefore get the same value: `p-6` **is** `--sp-6`, `bg-card` **is** `var(--card-bg)`.

**No new values in `tailwind.css`.** It maps existing tokens into Tailwind's namespaces and nothing else. A utility that needs a value theme.css does not have means the value goes in theme.css first. A palette split across two files is exactly what `tests/theme-tokens.test.ts` was written to prevent.

### What is mapped

The spacing scale needed no mapping: it was already exactly `n x 2px`, so one multiplier reproduces it and Tailwind fills in the steps the hand-written scale never named (there was no `--sp-9`). Type, weight, leading, radius and shadow are mapped by name, with **Tailwind's own scales cleared first** — its `text-xs` is 12px and ours is 11px, and leaving both in place means one class name means two things depending on whether the author knew this file existed. `--radius-panel` keeps its own name because collapsing 10px into `lg` (12px) would be a design change disguised as a rename.

### Preflight is off, and that changes how you write utilities

Preflight is Tailwind's global reset — every margin and padding zeroed, headings unsized, lists unmarked. The stylesheets here were written against browser defaults, so switching it on changes the spacing of every paragraph and heading at once: a change no test in this repo can see. It stays off until the CSS no longer leans on those defaults, and it goes on as its own change, verified by loading the extension and looking at it.

Two consequences when migrating, both of which produce a silently wrong result rather than an error:

- **A `<button>` or `<input>` keeps the UA's font.** `font-[inherit]` is required wherever the old rule said `font-family: inherit`, or the control will not match its own label.
- **A colour utility does not create a border.** `border-card-border` sets `border-color` only. The old `border: 1px solid var(--card-border)` needs `border border-card-border` — the bare `border` is what supplies the width, and the style comes from an `@property` whose initial value is `solid`.

### Keep defaults below utilities in the cascade

`theme.css` is imported into `@layer base`. Its universal margin/padding reset must remain below utilities, or every `p-*` and `m-*` silently loses even though its generated rule exists. `TopoBg`'s child-position defaults live in `@layer components` for the same reason: an unlayered `position: relative; z-index: 1` overrides overlay positioning and the consent stacking ladder. The built-CSS check in `tests/css-selectors.test.ts` covers both boundaries.

### Always compose class lists with `cn()`

`cn(OWN_CLASSES, className)` — own first, the caller's last. This is not tidiness; it is the difference between an override working and not.

Two utilities for the same property on one element are resolved by their order in the **generated stylesheet**, not by their order in `className`. `<Card className="p-0">` against a `Card` that sets `p-7` rendered with 14px of padding, because Tailwind emits `.p-0` before `.p-7`. Three of these were live at once when `cn()` was introduced: `p-0` on Home and SiteControls, `mb-0` on ApprovalCard, and a warning-tinted background on Home that never appeared. Each looked like a deliberate layout and was not one.

`cn()` resolves the conflict before the string reaches the DOM, so the last class written wins the way everyone already expects it to. **Its configuration is load-bearing**: tailwind-merge decides what conflicts from Tailwind's *default* scales, and ours differ — `text-md` is a font size here while `text-muted` is a colour, and a merger that cannot tell them apart silently deletes one. Every scale `tailwind.css` redefines is declared in `src/utils/cn.ts`, and `tests/cn.test.ts` pins both directions: the conflicts it must resolve, and the ones it must not invent.

### Animations live in `src/styles/animations.css`, never in a module

Every `@keyframes` is registered in Tailwind's theme, which makes each one a utility: `animate-card-in`, `animate-dropdown-in`, `animate-section-slide-in`. **Do not write `@keyframes` in a component's stylesheet.**

The reason is not tidiness. Vite scopes a keyframe name to the file that declares it, so a component that references a keyframe it does not itself define gets a name that resolves to nothing and simply never animates — silently. That was live twice: the approval card's spinner icon and the NIP-46 step's. It also meant the same fade was written out in `Modal` and again in `UnlockModal`, and the same dropdown entrance in `Dropdown` and again in `TopBar`, with no way to notice they had drifted.

As a utility the name is checked: a misspelled `animate-card-in` produces no class, and `tests/tailwind-classes.test.ts` fails on it.

**The shorthand carries the fill mode, and sometimes that is load-bearing.** `--animate-section-slide-in` ends in `backwards`, not `both`. `both` implies `forwards`, which would leave the element with a permanent `transform`, and a non-`none` transform makes an element a containing block for `position: fixed` descendants. Every fixed overlay inside a menu section would then be positioned against the section instead of the popup — which is exactly how five dialogs once ended up escaping to `#root` portals to get away from it.

An earlier `src/shared/animations.css` was deleted because every module defined its own keyframes and nothing referenced the shared file. This is the opposite arrangement, and that is what makes it work: nothing defines its own any more.

### What stays in a stylesheet

Utilities do not replace CSS; they replace the parts of it that were repeating a token. Far less qualifies than it first appears, and three things that look inexpressible are not:

- **Adjacent siblings and descendants** have arbitrary variants: `[&+&]:border-t`, `[&>*]:shrink-0`, `[&_label]:ml-1`. The last two replaced real `:global` descendant rules and emit exactly the selector they replaced — verified in the generated CSS, which is how you should confirm any of these.
- **A class accessed dynamically** (``styles[`tone${x}`]``) is better as an explicit `Record<string, string>` of utility strings. That also brings the file back under `tests/css-selectors.test.ts`, which has to skip any stylesheet with a computed key.
- **An override that has to beat a component's own class** used to need an unlayered CSS rule, because Tailwind's utilities sit in `@layer utilities` and an unlayered rule outranks a layered one whatever the specificity. `cn()` settled that — the override wins as an ordinary utility now. Several files survived a whole migration pass on this reasoning alone and were retired once `cn()` existed.

CSS modules are not required for perspective, masks, gradients, animation delays or
native disclosures. Static values can use utilities, including arbitrary properties;
verify their generated declarations and required browser prefixes. `TopoBg` currently
keeps its embedded SVG background artwork and layering rules in a module for readability.
Prefer shared components over distributing style strings among feature renderers.

Values that are computed at runtime stay inline styles. `Spinner`'s diameter is a caller-supplied number, and a utility class cannot be generated from a value that does not exist until render.

### Verifying a migration

The build passing proves nothing about appearance. For each component, read the **generated** CSS and check the utilities you used resolve to the declarations the old rule had — `grep` the built stylesheet in `dist/assets/`. Cascade order matters too: `border-t-brand` only wins over `border-card-border` because Tailwind emits it later, and that is worth confirming rather than assuming.

---

## 8. Import Aliases

Configured in `vite.config.ts`:

| Alias | Path |
|-------|------|
| `@components` | `src/components` — shared UI |
| `@screens` | `src/screens` — a screen per folder. Not split by entry point: every one of them is popup-only, and the prompt and onboarding documents are a single screen each, so the split would make two folders holding one thing |
| `@domain` | `src/domain` — feature logic, one folder per module (`wallet/`, `permissions/`, `vault/`, `site/`, `profile/`, `pqc/`, `activity/`, `wizard/`, `relays/`, `nostr/`). Pure decisions, no React, no I/O |
| `@services` | `src/services` — the things that talk to something: `rpc`, `blossom`, the relay-cache key names |
| `@context` | `src/context` — the React contexts, all eight |
| `@utils` | `src/utils` — React-side helpers that are neither a component nor a hook (`createRequiredContext`) |
| `@styles` | `src/styles` — global stylesheets (`theme.css`) |
| `@constants` | `src/constants` — configuration, protocol values and fixed lookup data |
| `@lib` | `src/lib` — cryptographic primitives and the cross-browser compatibility shim. Imported by the service worker, so never React |
| `@assets` | `src/assets` |

Always use aliases instead of relative paths when crossing module boundaries.

---

## 9. RPC Convention

**Never** use raw `browser.runtime.sendMessage` in UI code. Use the typed RPC layer:

| Function | Use case |
|----------|----------|
| `rpc(method, params)` | Request/response — returns result or throws `RpcError` |
| `rpcNotify(method, params)` | Fire-and-forget notifications (e.g., `configUpdated`) |
| `useRpc(method, params, opts)` | React hook for loading data on mount |

This ensures consistent error handling, type narrowing, and makes it easy to find all RPC call sites.

---

## 10. Effects in a Popup

The popup is a window that is destroyed on focus loss, talking to a service worker that is torn down after ~30s idle. Effects written for a long-lived web page misbehave here in ways that are easy to ship and hard to see. Four rules, each of which exists because breaking it produced a real bug.

**Key effects on stable identities, not on objects.** `AccountContext` recomputes `active` with `accounts.find(...)` on every render, so any storage write it watches — a profile resolving, for instance — hands consumers a brand-new object for the same account. An effect keyed on `[active]` re-runs on all of them. Depend on `active?.id`. `Home` (then HomeTab) keyed on the object re-ran its whole site detection, flipped back to "Loading…", and remounted every card below it, each of which re-fired its own fetches.

**Give every async effect a way to know it is obsolete.** Either a `cancelled` flag cleared in the effect's teardown, or — when the effect can re-run while an earlier pass is still in flight — a version ref, so the slower of two overlapping runs cannot win by finishing last:

```ts
const runRef = useRef(0);
const load = useCallback(async () => {
  const run = ++runRef.current;
  const current = () => run === runRef.current;
  const data = await rpc('...');
  if (!current()) return;
  setState(data);
}, []);
```

**A failed read is unknown, not a negative answer.** `catch → false` turns a service-worker wake-up failure into a confident "not connected", "no wallet", or "post-quantum not set up", each of which invites the user to redo something already done. Keep the state nullable and render the third case.

**`storage.onChanged` is how an open popup hears about a write; `runtime.sendMessage` is not.** Runtime messages are not delivered back to the document that sent them, so a popup cannot notify itself, and a background broadcast only reaches a popup that was already open. Storage changes reach every extension context including the writer. Filter on the area — most keys are `local`, but `relays` is `sync`:

```ts
const onChanged = (changes: Record<string, unknown>, area: string) => {
  if (area === 'local' && changes.allowedDomains) read();
};
browser.storage.onChanged.addListener(onChanged);
return () => browser.storage.onChanged.removeListener(onChanged);
```

**Colours and strings come from the palette and the catalogue, and both are enforced.** `tests/theme-tokens.test.ts` asserts every `var(--x)` in `src` resolves against a definition, because CSS fails silently here — a `var()` naming nothing, with no fallback, invalidates its whole declaration and the property is dropped (that is why the InfoTooltip bubble rendered transparent), and one *with* a fallback is quieter but no better: the fallback becomes the real value, the palette has no say, and two files reaching for the same idea drift apart. `tests/i18n-keys.test.ts` scans the **source** for what `t()` is actually asked for — including the dynamic families, enumerated from the unions that drive them — rather than comparing locales against `en`. Comparing against `en` is provably too weak: `wizard.type.nsec` was missing from *every* locale including `en`, so first-run importers read the raw key as their account type in all six languages and a locales-vs-en test passed the whole time.

**No mount effect may open a socket.** Relay and NWC round trips on popup open put the slowest relay on the path to first paint. Ask the background for a cached answer and let it refresh behind.


## Form controls and validation

`Input`, `Select`, and `Dropdown` share 40px default / 32px compact minimum heights,
8px corners, an opaque field surface, `--control-border`, and visible focus rings.
`Dropdown` adapts value callbacks to the native `Select`, so arrow keys, type-ahead,
and platform menus work without a floating panel being clipped by popup scrollers.
The chevron is an SVG; Select no longer has a CSS module or a data-URI icon.
Buttons use color feedback rather than movement or raised shadows. Disabled actions
have no hover treatment. `IconButton` and `RemoveButton` share keyboard focus styles.

Keep an input's wrapper stable when its error appears: changing its element path
remounts the field and loses focus while typing. Labels use `htmlFor`; error text is
linked through `aria-describedby` and the input exposes `aria-invalid`.

`EditableList` validates and normalizes before enabling its SVG plus button. Empty,
invalid and duplicate entries cannot be submitted, including with Enter. Pass the
same `validate` function for controlled inputs too. `InputRow` also guards its
submission callback, so disabling a button cannot be bypassed with the keyboard.
Icon-only actions retain an accessible label and a title. Permission custom kinds
must be integers from 0 through 65535 before Add is enabled.

The Mutes editor displays loading, failed read, missing event, published empty list,
and encrypted-private-only states separately. Its header information button explains
NIP-51 and the difference between public edits and preserved private entries. Opening
this editor explicitly requests a fresh background read before enabling editing;
the Home summary continues to use the cache. Failed reads never enable publishing.

### Activity details and site icons

Activity rows place `SiteIcon` first and their time followed by `StatusDot` last. `SiteIcon` also serves the site connection popover; it calls `getCachedFavicon`, which deduplicates requests, stores up to 128 raster icons for seven days, and falls back to the existing favicon URL and browser HTTP cache when CORS prevents reading image bytes. Icons never require new host permissions.

`ActivityEntryDetail` reuses `EventPreview`, `FieldDisplay`, and shared form controls. Tags and raw payloads are expandable; approval previews keep tags expanded. Encryption review is activity-only, with a validated peer key field when the event omits its recipient. Decrypted text is temporary component state, cleared on hide, unmount, entry change, and vault lock-state notifications; pending replies cannot restore it after those lifecycle changes.

### Profile media and key settings

Profile editing supports file selection or an HTTP(S) URL for both avatar and cover. Both file paths reuse `uploadProfileImages` / `uploadToBlossom`; successful uploads are cached per File during the edit session so revisiting the preview or retrying a partial failure does not upload the same file twice. The cover appears in the confirmation preview. Changing the URL discards its file selection. Invalid image URLs disable the preview action, and local object URLs are revoked when replaced or the editor is disposed.

All text inputs, selects, date controls and the key-import textarea use the opaque cool-gray `--input-bg` surface, distinct from cards. Focus retains the existing purple border and ring. The encrypted-backup recovery warning follows `PasswordPairFields` (including its validation checklist) and precedes the action buttons.

The post-quantum settings page leads with `PqcOverview`: account key source followed by three navigation rows: key viewing, export, and public key announcement. The announcement row has a green dot when confirmed current and red otherwise; its modal retains the publication/retry actions and explains an unreachable check. The imported-key backup warning sits immediately above the separate, confirmed removal action. Key cards use shared buttons with algorithm-specific accessible copy labels. Import retains both file selection and paste, with the generator instructions in a native disclosure.

Relay-cache notifications are passive reads: the background reuses answers younger than one minute so a storage-triggered popup refresh cannot restart its own network query. A stale answer is served immediately and refreshed once; opening a popup or receiving a notification never starts a polling timer.

### Profile, permissions, and relay editors

About uses `Textarea`, preserving line breaks and growing or shrinking with its content. The cover appears above the avatar; each image opens a draft dialog with URL and Blossom upload choices. Cancel leaves the profile unchanged. Permission details show the selected site above a scrolling rules region, with actions outside the scroll.

The relay editor distinguishes local configuration (including initial defaults) from the active account’s published NIP-65 event. It checks once on opening/account change and on explicit retry, displays read/write flags, and lets the user load a differing published configuration. Missing events are scoped to the relays checked; failed discovery is not reported as an unpublished list. Empty published lists are explained and cannot overwrite local configuration. Publication uses a snapshot of the visible list and flags, stays disabled until local data is loaded, and refuses empty/all-disabled lists. Local edits preserve the previous nonempty list and flags for restoration; an empty editor without a backup offers explicit restoration of the default relays.

Activity filters use the shared `Modal` with a dimmed backdrop, a content-sized card capped at 360px, a scrolling body and footer actions. Filters still apply immediately; closing keeps the selection. The post-quantum overview uses a text heading, retaining icons on its action rows without a repeated decorative key icon.

Activity type filters use plain operation categories without the protocol-details toggle. The pubkey tooltip explains matching the peer key and event `p` tags (including partial hexadecimal matches), distinct from selecting the signing account. Group detail keeps shared app, minute/time range, kind, account, recipient and status above a scrolling list of compact action/content/tag previews. It omits an account already selected outside and shortens displayed keys in the middle, with full values in tooltips. Differing accounts/recipients/statuses remain on their individual rows. Selecting a row opens a smaller shared Modal over a dimmed backdrop with exact time, kind-specific details and expandable JSON. Encrypted messages reuse the guarded “Reveal message” action inside that dialog; closing unmounts the plaintext.

The top-bar account selector opens a shared Modal as a sibling of the positioned top bar, so its dimmed backdrop covers the entire popup. Account rows show the selected state explicitly and preserve the removal confirmation; Add account stays in the footer. Editing is reached from Home. The copy icon sits immediately after the switching chevron and opens a small anchored Hex/npub action menu using shared `IconButton`, `ButtonSecondary`, `useOutsideClick` and `useCopy` feedback. It has no modal backdrop, supports keyboard navigation and returns focus after selection or Escape.

Menu subtitles share `--menu-subtitle`, the existing wizard purple at 55% opacity, through `text-menu-subtitle`. ListRow, ActionTile, account choices and the home PQ card reuse it; navigation icons use `text-brand` and `bg-brand-light`, including enabled/stale PQ states. Status dots retain semantic colors. PQ context watches only the selected account’s publication cache, retains verified evidence on failed refreshes, and clears it on account/key changes. Account switching waits for background completion before changing the UI identity.

Wallet surfaces hydrate account-scoped display snapshots before their live refresh. `WalletBalance` is shared by Home and Wallet: the existing amount stays visible beside a small loading indicator, and refresh failures identify it as the last known balance. History refresh displays its spinner beside the heading without replacing cached rows. Pending invoices are hidden by the shared transaction predicate. Cached provider presence survives failed checks; explicit disconnect resets it.

Wallet settings uses the existing account context for independent lazy reads, keeping drafts local. Deposit/Send bodies use Container gap=6 and labelled inputs within the shared Modal; settings sections reuse purple subtitles and separate disconnect from routine actions.

Wallet settings owns a flex-1/min-h-0 overflow-y-auto body inside OverlayPanel; its header and refresh icon remain outside that scroller. Address and connection copy actions reuse IconButton, IconCopy and useCopy, with accessible labels and clipboard feedback.

HomeWalletLayout displays the home wallet summary only when the current site is confirmed connected. Loading, errors, restricted pages and unconnected sites hide it. The account wallet remains accessible through Settings → Wallet.

The approval sheet always groups pending requests by account, website and permission, showing action, readable kind and request count. Clicking a group opens all its pending items as collapsed detail rows, with one shared approve/deny footer. The open group follows live arrivals/removals; approving snapshots the displayed IDs at click time. It uses a bounded scrolling list and the existing SiteIcon cache. “Approve shown” snapshots the visible IDs and waits for every decision; later arrivals are not included. Per-item details expand on click; group permission choices remain available. Grouping includes account identity as well as origin/permission.

Shared domain contracts must not be restated in handlers or UI. The activity writer accepts `ActivityLogInput = Omit<ActivityEntry, 'timestamp'>`; stored records and UI filters use `ActivityEntry`. Complete PQ panel status extends the card contract. Account and language display types use `Pick`/`Partial` projections. Runtime-only service state and component props stay local.

Import shared symbols directly from their defining modules. Do not forward constants,
types, helpers or icons through re-export barrels. For example, import relay cache
constants from `@constants/relays.ts` and activity records from
`@domain/activity/activity.ts`. Local exports of locally defined implementations
remain appropriate.

### Action-scoped panels and shared controls

`KeyActionModal` owns the dialog and unlock gate. `NsecExportPanel`,
`SeedExportPanel` and `ChangePasswordPanel` own only their action's state.
Switching action or closing unmounts that panel; reveal timers still use
`useTimedReveal`, and encrypted exports retain the shared crypto implementation.
`PaymentPreview` renders confirmation data without sending payments, while
`PermissionRulesList` owns its decision menu without choosing an account bucket.

Use `CopyButton` for ordinary labelled or icon-only copy actions; it composes
`useCopy`, `Button` and `IconButton` and announces clipboard feedback. Keep direct
`useCopy` where success drives a separate workflow, such as confirming seed backup.
Date/search fields use `Input`, duration selection uses `Select`, and the PQ file
paste field uses `Textarea`. Native file inputs and specialized reveal toggles
remain native elements because their interaction differs from a text control.
Favicon fetching and persistent caching live in `services/media/favicon.ts`.

`entrypoints/{popup,onboarding,prompt}` own HTML documents, React mounting and
app-level wiring. Feature modules must not import from them. `PromptScreen`, its
decision/unlock views, and the wizard's `WelcomeStep` live under `screens/`.
The manifest popup and Vite's additional document inputs name the entrypoint HTML
files explicitly; packaging tests verify those output pages and their assets.

`DecisionRow` remains a prompt-specific view because it emits permission decisions.
Its buttons and duration select compose shared `Button`/`Select` controls without
local color, border or hover recipes; disabling the row disables every control.

Selection controls import `Option<T>` directly from `components/option.ts`. Tabs
restrict values to strings; chip groups retain string/number types through their
change callback; native selects extend the base with optional `disabled`. Options
arrays are read-only inputs. Copy-button props are separate: their label names a
clipboard action rather than a choice, despite having similarly named fields.

`ActivityEntryDetail` composes `Container`, `Heading` and `Text` for layout and
content, including the shared box surface for encrypted messages. `DetailDisclosure`
owns collapsed raw text/JSON sections with a native keyboard-accessible summary
and a bounded, selectable preformatted body. It escapes content as text and is
also reused by the activity item dialog. `TextBlock` preserves full escaped content, line breaks and selectable scrolling.
Native `time` and the shared text block’s `pre` retain their semantics; decryption and vault-lock clearing remain in the detail view.

`ActivityGroupDetail` and every kind-specific event preview compose shared UI
primitives. Preview styling belongs to those components; there is no shared class
registry. Unknown kinds use the standard warning notice. All tags remain visible
in approval mode and collapsed in activity mode; raw JSON retains its explicit
show/hide button. Profile images retain URL validation and local image geometry.

`PulseLogo` uses two decorative, aria-hidden rings with utility styles and the
shared `animate-logo-pulse` keyframes. Its second ring starts 2.5 seconds later;
no component CSS module is needed for the gradient or delay.

`ScrollWheelPicker` keeps its perspective, fade mask (including the WebKit form)
and hidden backfaces in utility styles. Runtime row angles and dimensions stay
in inline styles; pointer, keyboard and snapping logic are unchanged.

### Button standards

`Button` has two sizes (default and `small`), three intents (primary, secondary,
danger), and an outline treatment. `IconButton` owns icon-only controls with three
hit-area sizes: small (24px), default (28px), large (36px), and muted/brand/danger
tones. Use it for add, cancel, copy and close icons. Caller classes may arrange
controls (width, flex, margins and alignment), but must not override their padding,
colors, font sizes, borders or corners. A source regression check enforces this
boundary. Approval-row navigation and cancellation are sibling controls, never
nested buttons. The welcome action uses the standard default button.

### Shared editor lifecycles

`ImageEditorButton` owns the cover/avatar editing affordance and standard shapes.
`ProfileSummary` is shared by profile confirmation and kind-0 event review.
`useObjectUrl` owns local preview allocation and revocation on file/scope changes
and unmount; remote image URLs still pass through URL validation.

`EditableList` owns row/list/hint styling; callers supply data, validators and
leading/trailing content rather than overriding its class map. Relay read/write
controls reuse `Chip`. Mute fields use the same list from a small field configuration.

`useMuteListEditor` owns read/import/publish state. Its view is keyed by account
and unmounted on close. Editing is disabled while importing or publishing; failed
reads cannot enable publishing, and encrypted `rawContent` is preserved unchanged.
`useAsyncScope` invalidates result tokens on replacement, dependency changes and
unmount (it does not cancel already-issued network operations). `useAsyncResource`
also uses this guard. `useTransientState` owns replaceable feedback timers and
cleanup, shared by mute and relay publication.

`Button` is available as a default or named export from `@components/Button`.
`ButtonSecondary` and `ButtonDanger` are named presets in the same implementation
module. They delegate to `Button`, preserve its size/outline/native props, and
fix the visual variant. Callers with genuinely dynamic variants can still use
`Button`; do not create a second style definition for a preset.

Wallet recovery follows the vault lock-state marker. Config, balance, requested
settings and visible transactions refresh when it changes, preserving the display
cache while retrying. A prior locked read must not leave a permanent error after
unlock. Wallet operations use `vault.requireUnlocked()` to await startup auto-unlock
before enforcing the real lock state. Retired vault status reads cannot overwrite
newer state, including on a failed read; current failures remain fail-closed.

Approval review always makes one-time approval primary: “Approve once” for one request and “Approve all” for multiple displayed requests. This snapshots only the displayed IDs and never saves permissions. The top of the sheet contains compact Approve and Reject split buttons. Each arrow menu matches its button’s width and lists a remembered action for each pending request type. Their arrows open shared `ActionMenu` menus for “Always allow {human-readable kind}” and “Always reject {human-readable kind}”; these save future permissions for that site and type. The main Reject action only rejects displayed requests. Each menu choice targets only its selected group; it never creates a blanket rule across mixed groups. Remembered rules retain the configured account/global scope. Remote in-flight groups have no local approval action.

Wallet account changes reset only a keyed, nonvisual resource controller. The context provider and popup children stay mounted so a saved sub-account can advance the wizard. Account snapshots are scoped by ID to prevent displaying the previous account’s wallet.

Account removal uses a later sibling ConfirmDialog at the shared modal layer, above the scrollable picker. Do not override it with a sheet-level z-index: that places confirmation behind the picker. Escape closes only the confirmation. The background owns removal and storage cleanup; failed removal keeps the dialog open with an error and never deletes the UI account optimistically.

Shared Modal bodies separate top-level sections with gap-6 inside the scroll area. Footers use gap-4 in both stacked and equal-width row layouts. ConfirmDialog uses the row layout and separates rich message blocks with gap-6. Keep related fields inside their own Container; avoid adding outer margins to compensate for missing dialog spacing.


Sub-account creation preselects the next standard derivation path and lets the user
edit it inside a collapsed Advanced disclosure. An optional editable account name
stays outside Advanced and survives preview updates; blank names use the generated
default. Both npub and hexadecimal public keys appear automatically. Valid path
edits refresh after 350 ms, serialize pending requests, and discard stale replies.
Path edits invalidate the public-key preview; Continue stays disabled until a
successful current preview. Previewing never saves an account. The selected seed account is named in the UI. Validation
is shared with the background, and errors leave the editor usable. Known hardened
network prefixes are identified as conventions, not wallet support; unknown valid
paths remain usable. Seed-derived removal warnings explain same-seed/same-path
recovery and that removing one identity leaves the other seed accounts intact.

Unread foreign-author rejections appear in a shared Modal on popup open, with
website, readable kind, shortened requested/selected public keys, time and an
explanation that nothing was signed. Close explicitly acknowledges the displayed
IDs; failed acknowledgement leaves the notice visible. New arrivals update the
notice via the shared storage watcher without opening a new browser popup.

Wallet settings uses ProfileAddressButton to compare the current Lightning
Address with the selected account's profile cache. The existing storage hook
updates it after publication, and the account public key scopes its lifetime.

WalletContext reads encrypted snapshots through the background RPC rather than importing vault/storage crypto into the UI. Lock notifications invalidate pending UI loads and clear balances, history and settings; activity/menu detail overlays close so selected records are not retained on screen. Unlocked refresh continues showing its previous snapshot next to loading indicators.

The top bar and account picker share `accountDisplay` for profile names (including
`display_name`), pictures and npub fallback. Remote accounts use profile identity
rather than their connection label and share a non-interactive `remote` badge
through `AccountLabel`; badge markup must not nest a button inside a selector.

Experimental WoT settings are menu-only and reuse Container, Toggle, Select,
Input, Button, FieldDisplay, StatusNotice and FormError. Account changes remount
only the settings form; useAsyncResource and useStorageWatch refresh its snapshot.

Experimental WoT settings reuse `Card`, icon-card `Tabs`, `ChipGroup` and `Modal`. The entry notice stores its optional dismissal separately from feature consent; dismissing a notice never enables the API.


Experimental WoT splits information, scoring, sync progress and database inventory
into focused settings panels using shared Modal, Card, Input, Toggle and button
components. Progress uses a polite status region. Draft settings reset only when
saved settings change, not when a background progress update returns a new object.

The WoT main screen keeps automatic syncing and progress in one card. Mode, hops,
limits, databases, explanations and sync/resync/clear actions live in a dedicated
`OverlayPanel` screen with a scrolling body and pinned Save action. Scoring has
an npub/hex lookup card with a shared settings `IconButton` at the top right,
opening a smaller `Modal`. Sync settings use a draft/save flow, including the automatic-sync switch; dismissal
discards unsaved edits. Scoring uses a single-title modal and applies valid edits
automatically, without a Save footer. Lookup uses shared
public-key validation, RPC scoring and `useAsyncResource` for loading, retry and
stale-response protection.

`Input` accepts an optional `hint` rendered by the existing focusable `InfoTooltip`
next to its associated label. WoT configuration uses these hints instead of
repeating explanatory paragraphs. The sync screen uses the existing page-gradient
background token, matching the other settings surfaces.

`InfoTooltip` owns its interaction and positioning everywhere it is reused. It
opens on hover, focus, click, Enter or Space; clicking again, Escape, blur,
outside clicks or container scrolling dismiss it. Its native manual-popover
bubble renders in the browser top layer, outside ancestor overflow clipping, and
clamps/flips within the viewport. It reuses `useOutsideClick` and `IconInfo`.
The trigger remains a span with button semantics because some callers place it
inside an existing row button; activation does not trigger that parent action.

Split actions use Button’s `segment="start"` / `segment="end"` presets for joined corners and a divider, with `ActionMenu` for the secondary choices. Callers keep only layout classes.

### Appearance

Settings → Appearance and language reuses Card and ChipGroup for Light, Dark, System and La Crypta.
The choice saves immediately in extension-local storage, independently of accounts
and vault state. Light remains the default. Dark follows nostr-wot.com’s gray-950
canvas, gray-900 cards, gray-800 raised surfaces, neutral text and indigo accents.
Small accent labels use indigo-400 to retain AA contrast on raised surfaces.
System follows OS changes; La Crypta
uses the near-black, lime and orange palette from lacrypta.ar. The shared appearance
service initializes before rendering popup, onboarding and approval windows and
updates open documents on storage changes. Palettes live in theme.css; use semantic
surface/text/status tokens, including for loading screens and decorative backgrounds.
The language row opens the shared LanguagePicker dialog from this screen; the menu footer only shows the extension version.
QR modules stay dark on a white background in every palette so they remain scannable.

Wallet setup and settings share `WalletConnectionHelp`, a flat Card composed of
Container, Text and IconInfo. It explains Quick Setup, NWC and direct LNbits
connections and links to the providers' official guides. Setup separates its
heading, tabs and form with explicit gaps; settings cards use p-8 and gap-6,
with gap-7 between cards inside the existing bounded scroll region. The LNbits
wallet Admin API key stays masked by the shared Input; its associated description
explains API info, spending authority and the distinction from a login password.
