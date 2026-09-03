# Component Standards

Guidelines for shared components, hooks, and utilities in the Nostr WoT Extension.

---

## 1. Shared Component Inventory

All shared components live in `src/components/`, each in its own folder. There are **31**; the list below is generated from the folder, not maintained by hand, because the previous hand-maintained one had drifted badly enough to be misleading — it named a `ModeCard` that does not exist and omitted more components than it listed.

**Layout and overlays** — `Modal` (centered dialog: Escape, focus-on-open, drag-safe backdrop), `OverlayPanel` (opaque full-screen navigation sheet), `ConfirmDialog` (are-you-sure, built on Modal), `EventDetailModal`, `Dropdown`, `InfoTooltip`, `Splash`.

**Content** — `Card`, `SectionLabel`, `EmptyState`, `StatusNotice`, `StatusDot`, `FieldDisplay`, `EventPreview` (+ `kinds/`), `PublishRow`, `QrCode`, `Avatar`.

**Controls** — `Button`, `Input`, `InputRow`, `Select`, `Toggle`, `ChipGroup`, `EditableList`, `RemoveButton`, `NavRow`, `NavItem`, `ScrollWheelPicker`.

**Decoration** — `TopoBg`, `PulseLogo`, `AnimatedWotLogo`.

Read the component's own file for its props; duplicating them here is what rotted last time.

### Reach for these before writing new chrome

The recurring failure is not that a primitive is missing, it is that a feature hand-rolls one it already has. `Modal`'s own docstring records that it exists because the popup had grown three separate dialog implementations — and four more were written afterwards. Before adding a backdrop, a close button, a chip row, or an are-you-sure, check this list.

**Every centered dialog is now a `Modal`** — the wallet's deposit, send and tx-filter, the permissions add-rule, `KeyActionModal`, and the wizard's encrypted backup all used to hand-roll a scrim, a card, a header and a close button, at five different scrim opacities, three dismissal behaviours and no Escape key between them. Migrating them deleted ~280 lines of CSS and gave each one Escape, focus-on-open, `role="dialog"`, a scrolling body with a pinned footer, and the drag-safe backdrop rule.

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

- **CSS Modules only** — every component co-locates a `.module.css` file.
- **camelCase class names** — e.g., `chipGroup`, `chipActive` (not `chip-group`).
- **No global styles** in shared components. Use tokens from `src/shared/theme.css`.
- **Avoid `!important`** — specificity via module scoping is sufficient.
- **Keyframes stay local.** A `@keyframes` inside a `.module.css` is scoped to that module, which is what makes a shared component work in any of the three documents (popup, prompt, onboarding) without depending on load order. There used to be a `src/shared/animations.css` collecting them centrally; every module defined its own copy anyway, so the shared file was loaded by the popup and referenced by nothing. It is gone. Duplicating six lines of keyframes is the cheaper mistake.

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

All shared hooks live in `src/shared/hooks/`, one hook per file.

| Hook | Purpose |
|------|---------|
| `useRpc<T>(method, params, opts)` | Call background RPC on mount, with reload/loading/error (generic) |
| `useVaultUnlock({ onSuccess })` | Password state, unlock RPC, error handling, input ref, brute-force lockout (escalating: 1/5/15/30 min after every 5 failures) |
| `useAnimatedVisible(visible)` | Manages mount/unmount transitions for overlays |
| `useCopy(resetAfterMs?)` | `{ copy, copied, failed }` — clipboard write that reports its outcome |
| `useWizardFlow()` | State machine hook for onboarding wizard |

There is no `useBrowserStorage`. This table used to claim one; two components had each hand-rolled its exact body instead of finding it, because it was never written.

**Use `useCopy` for every clipboard write.** `copied` is what you render; the promise resolves to whether the write actually landed, for the callers that must *decide* on it (the wizard only marks a seed phrase backed up if the copy succeeded). Copying a value the user cannot verify by eye — an nsec, an ncryptsec, a seed phrase — with a bare un-awaited `navigator.clipboard.writeText` makes a refused clipboard look exactly like a successful copy. That was live on all three of those values.

### Hook guidelines

- Always return objects (not arrays) when returning 3+ values — allows destructuring by name.
- Keep hooks focused on one concern.
- Prefix with `use`.

---

## 6. Shared Utilities

All shared utilities live in `src/shared/`, one concern per file.

| File | Exports |
|------|---------|
| `rpc.ts` | `rpc<T>()`, `rpcNotify()`, `RpcError` |
| `approval.ts` | `filterPendingForDomain`, `partitionPending`, `groupApprovals`, `groupNip46`, `liveIds`, `isRequestLive`, `isGroupLive`; re-exports the canonical `PendingRequest` |
| `profileMetadata.ts` | `mergeProfileMetadata`, `profileHasChanges`, `ProfileMetadata` — the kind:0 read-modify-write |
| `txFilter.ts` | `matchesTxFilter`, `matchesTxSearch`, `filterTransactions`, `dateRangeToTs`, `countActiveFilters`, `isPlaceholderMemo` |
| `invoiceExpiry.ts` | `describeInvoiceExpiry` — takes `now`, so it is testable |
| `pqcState.ts` | `derivePqcCardState`, `isAlreadyPublished`, `PqcStatus`, `PqcPublished` |
| `permissionRules.ts` | `countDecisions`, `filterKeysForAccountKind`, `availablePermKeys`, `buildRuleKey` |

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

## 7. Import Aliases

Configured in `vite.config.ts`:

| Alias | Path |
|-------|------|
| `@components` | `src/components` |
| `@shared` | `src/shared` |
| `@lib` | `lib` |
| `@assets` | `src/assets` |

Always use aliases instead of relative paths when crossing module boundaries.

---

## 8. RPC Convention

**Never** use raw `browser.runtime.sendMessage` in UI code. Use the typed RPC layer:

| Function | Use case |
|----------|----------|
| `rpc(method, params)` | Request/response — returns result or throws `RpcError` |
| `rpcNotify(method, params)` | Fire-and-forget notifications (e.g., `configUpdated`) |
| `useRpc(method, params, opts)` | React hook for loading data on mount |

This ensures consistent error handling, type narrowing, and makes it easy to find all RPC call sites.

---

## 9. Effects in a Popup

The popup is a window that is destroyed on focus loss, talking to a service worker that is torn down after ~30s idle. Effects written for a long-lived web page misbehave here in ways that are easy to ship and hard to see. Four rules, each of which exists because breaking it produced a real bug.

**Key effects on stable identities, not on objects.** `AccountContext` recomputes `active` with `accounts.find(...)` on every render, so any storage write it watches — a profile resolving, for instance — hands consumers a brand-new object for the same account. An effect keyed on `[active]` re-runs on all of them. Depend on `active?.id`. `HomeTab` keyed on the object re-ran its whole site detection, flipped back to "Loading…", and remounted every card below it, each of which re-fired its own fetches.

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
