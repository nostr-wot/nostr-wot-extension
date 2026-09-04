# Component Standards

Guidelines for shared components, hooks, and utilities in the Nostr WoT Extension.

---

## 1. Shared Component Inventory

All shared components live in `src/components/`, each in its own folder. There are **42**; the list below is generated from the folder, not maintained by hand, because the previous hand-maintained one had drifted badly enough to be misleading — it named a `ModeCard` that does not exist and omitted more components than it listed.

**Layout and overlays** — `Modal` (centered dialog: Escape, focus-on-open, drag-safe backdrop), `OverlayPanel` (opaque full-screen navigation sheet), `ConfirmDialog` (are-you-sure, built on Modal), `EventDetailModal`, `Dropdown`, `InfoTooltip`, `Splash`.

**Content** — `Card`, `Heading`, `SectionLabel`, `EmptyState`, `StatusNotice`, `StatusDot`, `FieldDisplay`, `FormError`, `EventPreview` (+ `kinds/`), `PublishRow`, `QrCode`, `Avatar`.

**Controls** — `Button`, `IconButton`, `LinkButton`, `Input`, `InputRow`, `Select`, `Toggle`, `Tabs`, `Chip`, `ChipGroup`, `ListRow`, `ActionTile`, `SeedWord`, `EditableList`, `RemoveButton`, `ScrollWheelPicker`, `LanguageWheel`, `PasswordPairFields`.

**Feedback** — `Spinner`.

**Decoration** — `TopoBg`, `PulseLogo`, `AnimatedWotLogo`.

Read the component's own file for its props; duplicating them here is what rotted last time.

### Reach for these before writing new chrome

The recurring failure is not that a primitive is missing, it is that a feature hand-rolls one it already has. `Modal`'s own docstring records that it exists because the popup had grown three separate dialog implementations — and four more were written afterwards. Before adding a backdrop, a close button, a chip row, or an are-you-sure, check this list.

**Every centered dialog is now a `Modal`** — the wallet's deposit, send and tx-filter, the permissions add-rule, `KeyActionModal`, and the wizard's encrypted backup all used to hand-roll a scrim, a card, a header and a close button, at five different scrim opacities, three dismissal behaviours and no Escape key between them. Migrating them deleted ~280 lines of CSS and gave each one Escape, focus-on-open, `role="dialog"`, a scrolling body with a pinned footer, and the drag-safe backdrop rule.

**Every clickable list row is a `ListRow`.** `NavRow`, `NavItem` and the permissions screen's `.permRow` were three implementations of `[leading] [title / subtitle] [chevron]`, which is why the chevron was brand coloured in two of them and muted in the third, and why only one ellipsised a long subtitle. Chrome is the variant: `grouped` is a bare row for a bordered container (a `Card`, or a rounded scroll list) to own the edge, siblings separated by a hairline; `standalone` carries its own card chrome.

Three row-shaped things are deliberately *not* `ListRow`, and the reasoning is worth keeping because each looks like a candidate: the menu footer's language trigger is an auto-width pill with a chevron pointing **down**, so it is a dropdown trigger; the top bar's account rows carry hover-revealed edit/copy/remove buttons, so the row is a container of controls rather than one control; and the wizard's follow suggestions are a multi-**select** list with a checkmark. That last one stays hand-rolled only until there is a second multi-select list — **a variant with a single caller is a guess about what the second caller will need**, and guessing is how `NavRow` and `NavItem` became two things.

**`Heading`, `SectionLabel` and `FieldDisplay` are the three pieces of a form or summary screen**, and each replaced a pattern that had been copied rather than shared. `text-3xl font-bold text-heading` was written out at fourteen call sites — every wizard step title — with four more sizes alongside it that had no name, so a new screen picked whichever one it was copied from. `Heading`'s level chooses the size **and** the element, because a title rendered as a `<span>` is invisible to anything navigating by heading; that was live in the wizard's own step header. `SectionLabel` had the same three declarations at a dozen sites with the spacing below varying between nothing, `mb-1` and `mb-3` — and it renders a real `<label>`, so **give it `htmlFor`** whenever there is a field to point at.

`FieldDisplay` is one labelled value, and there were four implementations: this component, the wizard's done step, the sub-account summary, and seven rows in the wallet's send dialog. They disagreed on every detail — the label muted in one and secondary in another, semibold in one and medium in another, the value right-aligned in two of the four. None of that was decided. The two differences that *are* real became variants: `divided` draws the hairline for a stack filling a `Card`, and `caps` is the wallet's dense block where a small uppercase label sits beside a value that matters more than it does.

**`FormError` is the line a form shows when it could not do what was asked**, and it is worth knowing why it exists: there were twenty-six of them across twenty-one files, and exactly one carried `role="alert"`. Everywhere else the error raised by a failed submit was never announced — a screen-reader user pressed the button and heard nothing at all. The visual duplication (two font sizes for the same thing, chosen by nobody) was the smaller half of the problem. It renders nothing for an empty message, so the `{error && ...}` guard goes away too. `Input` and `InputRow` keep their own field-level error: that belongs to the field's contract, not the form's.

**A component can be a form rather than a screen.** `EncryptedBackupForm` exists because "export the key as an `ncryptsec`" had two implementations — the vault's key dialog, which explained the format, warned that nothing can recover the password, showed a live checklist of what the password still needed and offered both a download and a copy; and the wizard's, which had two bare password fields and a button that objected only once pressed. Same operation, same irreversible consequence, and the thinner one was what a new user met. It is deliberately **not** a `Modal`: the vault dialog is already inside one and switches between four actions, so a modal there would nest. Each caller brings the shell, the component brings the body and its own actions. Reach for this shape whenever the duplicated thing is a *flow* rather than a piece of chrome.

**`PasswordPairFields` is the primitive `EncryptedBackupForm` was reaching for underneath its own checklist.** "Choose a new password, twice" was written out by hand at six sites — every encrypted export, the vault's change-password form, and vault creation — and `@domain/vault/passwordPair.ts` already shared the *rule*; what stayed duplicated was the *form*: two password inputs, the live checklist, and whether the submit button waits for both. Only `EncryptedBackupForm` had the checklist; the other five refused only once pressed, leaving the user to guess which requirement failed. The component is deliberately thin — two `Input`s and an optional checklist, rendered as a fragment rather than a wrapped block, because every call site already lays its own form out as a column with its own gap, and a nested one here would double it or fight it depending on the site. It takes no submit button and no label of its own; a caller renders both, same as `EncryptedBackupForm` did, because the six sites disagreed on whether a label existed at all. `usePasswordPair()` is the state half — password, confirm, and the derived `longEnough` / `matches` / `ready` a submit button waits on — backed by a pure `derivePasswordPairState` in the same file, precisely so that derivation has a test, per [§2's rule](#extract-the-decision-not-just-the-markup) that only the pure half of a component buys one. A **third field that is not part of the pair** — the change-password screens' *current* password — stays outside the component entirely; swallowing it into the pair would have hidden a field this component has no business owning.

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

There is no test harness that renders React here — `tests/` is `node:test` over pure modules. So any rule that stays inside a component is, by construction, untestable, and the only extraction that buys a test is the *pure* half: the predicate, the grouping, the status derivation, the validation.

`siteState.ts`, `sendTarget.ts` and `approval.ts` are the pattern. The last one is the argument for it: `filterPendingForDomain` is a cross-site isolation boundary — it must return nothing when the current origin is unknown, or one site's popup lists another site's pending signing requests, content included. It sat inline in a 400-line component with a comment explaining why, and nothing asserted it. A refactor that "simplified" the empty-domain branch back to returning everything would have been green. It now has a test that fails loudly.

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
  components/  shared UI primitives
  hooks/       every hook, feature or generic
  models/      every shared type
  shared/      pure logic and utilities, unit-tested
  popup/  prompt/  onboarding/  wizard/   the four documents' screens
```

Three rules behind that shape. **No module nests its own `components/`** — inside
`src/popup/` the folders are the screens, and a second level named after a file type
said nothing. **Hooks live together**, not beside the one screen that happens to use
them first, because that is how `useSiteState` ended up somewhere `useWalletBanner`
had to reach for it. **Types live in `models/`** so a shape has one definition; the
module that owns the behaviour re-exports its own shape, so no call site learns a
second import path for the same idea.

Aliases: `@components`, `@hooks`, `@models`, `@domain`, `@services`, `@context`,
`@utils`, `@styles`, `@lib`, `@assets`, `@popup`, `@wizard`. Use them rather than climbing out of a folder with
`../../`. Each one answers a question about the thing you are writing, so if two of them
seem to fit, the file is probably doing two jobs — see §7 for what each one means.

### `src/domain`, `src/services`, `src/utils` — and the root `lib/`

`src/shared/` was twenty-six files in one flat folder, and the name had stopped meaning anything: a Lightning invoice's expiry rule sat beside a clipboard helper beside the RPC transport. It is now split by what a thing *is*.

- **`src/utils`** — no domain knowledge at all. Formatting, `downloadFile`, `paginate`, URL predicates. You could paste any of it into another product.
- **`src/domain`** — the decisions this product makes, one folder per module. Pure functions over plain data: no React, no `browser.*`, no network. That is what makes them testable, and every one of them has a test.
- **`src/services`** — the things that talk to something. `rpc` to the background, `blossom` to a media host.
- **`lib/` (repo root)** — the extension core: background handlers, crypto, the vault, the cross-browser shim. Imported by the service worker, so **nothing here may import React**, and nothing in `src/` should reimplement it.

That last rule was already being broken. `src/shared/browser.ts` was a six-line copy of `lib/browser.ts` that omitted its Safari `storage.session` polyfill, and twenty-one UI files imported the copy — seven of which call `storage.session` directly. It is deleted; everything uses `@lib/browser.ts`.

### Where a feature lives

`src/wizard/` is a peer of `popup/`, `prompt/` and `onboarding/`, not a folder inside
one of them, because two entries use it — onboarding used to reach into
`../popup/components/Wizard`, which was the only cross-entry import in the tree.
A feature more than one entry renders belongs beside them, not inside whichever one
happened to build it first.

`MenuOverlay` importing the sections it pushes is not a boundary violation — that is a
router importing its routes. Note that `PermissionsSection` has two hosts (the menu
and `PopupApp` directly), so it is not purely a menu section.

### One shape, one definition

`PendingRequest` had five definitions: the canonical one in `lib/types.ts` and four narrower restatements across ApprovalOverlay, ApprovalCard, EventDetailModal and PopupApp. They had already drifted into a type error that one of the copies documented in a comment rather than fixing. Import the canonical type; if it does not fit, widen it there.

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

- **Tailwind utilities first** — see §7. Five `.module.css` files remain in the whole tree, each for something utilities genuinely cannot express.
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
| `approval.ts` | `filterPendingForDomain`, `partitionPending`, `groupApprovals`, `groupNip46`, `liveIds`, `isRequestLive`, `isGroupLive`; re-exports the canonical `PendingRequest` |
| `profileMetadata.ts` | `mergeProfileMetadata`, `profileHasChanges`, `ProfileMetadata` — the kind:0 read-modify-write |
| `txFilter.ts` | `matchesTxFilter`, `matchesTxSearch`, `filterTransactions`, `dateRangeToTs`, `countActiveFilters`, `isPlaceholderMemo` |
| `invoiceExpiry.ts` | `describeInvoiceExpiry` — takes `now`, so it is testable |
| `pqcState.ts` | `derivePqcCardState`, `isAlreadyPublished`, `PqcStatus`, `PqcPublished` |
| `permissionRules.ts` | `countDecisions`, `filterKeysForAccountKind`, `availablePermKeys`, `buildRuleKey`, `DECISIONS` |
| `passwordPair.ts` | `validatePasswordPair` — the "new password, twice" rule |
| `vaultAutoUnlock.ts` | `isVaultOpen` — never-lock auto-unlock, behind its mode check |
| `activity.ts` | `groupActivityEntries`, `filterActivityEntries`, `buildDayGroups`, `TYPE_METHODS` |
| `pagedList.ts` | `paginate` — the render window behind `usePagedList`. Distinct from `txPager.ts`, which pages a *remote* API: the activity RPC already returns the whole log, so there is nothing left to fetch, only a prefix to grow |

`permissionRules.ts` is split from `permissions.ts` on purpose: that module imports
`t()`, which drags in the browser layer and makes it unloadable under plain
`node --test`. The rules that *decide* something are the ones worth testing, and they
need no i18n. Keep new decision logic on the i18n-free side of that line.
| `format/` | `truncateNpub`, `getInitial`, `formatTimeAgo`, `formatBytes`, `toPercent`, `toFraction` |
| `permissions.ts` | `formatPermMethod` |
| `url.ts` | `getDomainFromUrl` |
| `activeTabDomain.ts` | `resolveActiveTabDomain` — which site the popup is looking at |
| `siteState.ts` | `resolveSiteState` — connected / notConnected / empty / error |
| `sendTarget.ts` | `resolveSendTarget`, `canSend` — what the wallet's Send box may pay |
| `activity.ts` | `groupActivityEntries` |
| `constants.ts` | `AUTO_LOCK_OPTIONS`, `DEFAULT_RELAYS`, `KIND_LABELS`, etc. |
| `browser.ts` | Browser detection and API utilities for UI code |
| `clientIcons.ts` | Known Nostr client icon mappings |
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

What genuinely stays: 3D transforms and `perspective`, `mask-image`, data-URI background art, `::-webkit-` pseudo-elements, and `<details>`/`<summary>` disclosure. The post-quantum panel's disclosure is the clearest example — it *can* be written as six stacked arbitrary variants with escaped `content` strings, and the CSS is plainly easier to read. **A file left with two honest rules beats ten utilities nobody can parse.** Delete the module only once it is actually empty.

Values that are computed at runtime stay inline styles. `Spinner`'s diameter is a caller-supplied number, and a utility class cannot be generated from a value that does not exist until render.

### Verifying a migration

The build passing proves nothing about appearance. For each component, read the **generated** CSS and check the utilities you used resolve to the declarations the old rule had — `grep` the built stylesheet in `dist/assets/`. Cascade order matters too: `border-t-brand` only wins over `border-card-border` because Tailwind emits it later, and that is worth confirming rather than assuming.

---

## 8. Import Aliases

Configured in `vite.config.ts`:

| Alias | Path |
|-------|------|
| `@components` | `src/components` |
| `@domain` | `src/domain` — feature logic, one folder per module (`wallet/`, `permissions/`, `vault/`, `site/`, `profile/`, `pqc/`, `activity/`, `wizard/`, `relays/`, `nostr/`). Pure decisions, no React, no I/O |
| `@services` | `src/services` — the things that talk to something: `rpc`, `blossom`, the relay-cache key names |
| `@context` | `src/context` — the React contexts, all eight |
| `@utils` | `src/utils` — React-side helpers that are neither a component nor a hook (`createRequiredContext`) |
| `@styles` | `src/styles` — global stylesheets (`theme.css`) |
| `@lib` | `lib` |
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
