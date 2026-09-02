# Component Standards

Guidelines for shared components, hooks, and utilities in the Nostr WoT Extension.

---

## 1. Shared Component Inventory

All shared components live in `src/components/`, each in its own folder.

| Component | Props | Description |
|-----------|-------|-------------|
| Button | `variant`, `small`, `className`, `children`, `...rest` | Primary/secondary/danger button with optional small size |
| Card | `className`, `children`, `...rest` | Card container wrapper |
| ChipGroup | `options`, `value`, `onChange`, `className` | Toggle chip group; options: `{ value, label }[]` |
| EmptyState | `icon`, `text`, `hint`, `children`, `className` | Centered empty state placeholder |
| FieldDisplay | `label`, `value`, `mono`, `className` | Read-only label + value pair |
| Input | `type`, `mono`, `showToggle`, `label`, `error`, `className`, `...rest` | Text/password input with optional toggle |
| InputRow | `value`, `onChange`, `placeholder`, `onSubmit`, `buttonLabel`, `disabled`, `error`, `mono`, `className` | Inline input + submit button + error |
| ModeCard | `active`, `label`, `desc`, `onClick`, `className` | Radio-style selectable card |
| NavItem | `icon`, `label`, `desc`, `onClick`, `className` | Navigation row with icon and chevron |
| PulseLogo | `src`, `size`, `alt`, `className` | Logo with pulse animation |
| Select | `options`, `value`, `onChange`, `small`, `className`, `...rest` | Dropdown select |
| Splash | `visible`, `onTransitionEnd` | Full-screen splash with fade-out |
| StatusDot | `status`, `className` | Colored status indicator dot |
| Toggle | `checked`, `onChange`, `...rest` | Toggle switch |
| TopoBg | `className`, `children` | Topographic pattern background |

---

## 2. When to Extract

Extract a component when:

- It is used (or will be used) in **2+ places**.
- It encapsulates a discrete UI pattern (e.g., an input row, a toggle, a card).
- It has clear props and no tight coupling to parent state.

Do **not** extract if:
- The component only makes sense in one context.
- Extracting would require passing many parent-specific callbacks through props.

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
- **No global styles** in shared components. Use CSS variables (`var(--brand)`, `var(--card-bg)`, etc.) from the theme.
- **Transitions** — keep to `0.15s` for consistency.
- **Avoid `!important`** — specificity via module scoping is sufficient.

---

## 5. Hooks

All shared hooks live in `src/shared/hooks/`, one hook per file.

| Hook | Purpose |
|------|---------|
| `useBrowserStorage(key, default, area)` | Read/write `browser.storage` with live change listener |
| `useRpc<T>(method, params, opts)` | Call background RPC on mount, with reload/loading/error (generic) |
| `useVaultUnlock({ onSuccess })` | Password state, unlock RPC, error handling, input ref, brute-force lockout (escalating: 1/5/15/30 min after every 5 failures) |
| `useAnimatedVisible(visible)` | Manages mount/unmount transitions for overlays |
| `useWizardFlow()` | State machine hook for onboarding wizard |

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
