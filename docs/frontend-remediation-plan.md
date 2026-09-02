# Frontend Remediation Plan — Nostr WoT Extension

This plan consolidates five audited lenses (data ownership, lifecycle/races, boundaries/duplication, extension hazards, shared layer), each adversarially verified against the source. Every claim below survived verification; overstated ones are listed separately with the corrected reading. File:line references are to the current `main`.

---

## 1. The diagnosis

Nearly every shipped bug traces to one rule the codebase never adopted: **a shared fact has no single owner — whichever component needs it fetches it privately, in its own mount effect, with its own refresh policy and no invalidation.** The three contexts watch exactly 5 storage keys (`accounts`, `activeAccountId`, `profileCache`, `signerPermissions`, `signerUseGlobalDefaults` — AccountContext.tsx:61,117; PermissionsContext.tsx:53); everything else — allowlist, tab domain, pending requests, relays, wallet, PQC, mute list — is fetched by 27 component files independently. That is why the PqcCard could put a relay round trip on the popup's critical path without anyone seeing it, why GlobeButton goes stale when the allowlist changes three lines of tree away, why removing host permissions broke three components in three different ways (three private copies of "what site is this"), and why the fix for any of these has to be re-fought per copy. The secondary cause, compounding the first, is that the private fetches are written for a long-lived web page rather than a popup that is destroyed on focus loss: unguarded async effects keyed on unstable object identities, so the popup re-fires and races its own work.

---

## 2. What is actually wrong

Verifier severities. "Spread" = how many places share the pattern.

| # | Finding | Where | Broke / will break | Spread |
|---|---------|-------|--------------------|--------|
| 1 | **Component-private fetching by default**; contexts own 5 storage keys, components own everything else, no invalidation path exists for anything else | AccountContext.tsx:61,117; PermissionsContext.tsx:53; VaultContext.tsx:31-36; 27 rpc-calling component files | The root cause of the PqcCard, GlobeButton, and host-permission incidents; every new feature adds another private fetch to the critical path | 27 files |
| 2 | **ApprovalOverlay refresh is an infinite async loop** — inline `onRequestUnlock` prop (PopupApp.tsx:116) in `refresh`'s deps, fresh `unlockWaiters` array re-renders parent, new prop identity re-runs effect | ApprovalOverlay.tsx:50,66-68,107,109-117 | Continuous tabs.query + `signer_getPending` churn the entire life of every popup open; plausibly the felt sluggishness; listener add/remove churn can drop `signerPendingUpdated` broadcasts | 1, but always-on |
| 3 | **HomeTab keyed on `active` object identity, no request versioning** — every profileCache write rebuilds `active` (AccountContext.tsx:58), re-running `loadHomeState` with no cancellation | HomeTab.tsx:49-93,91-93 | The shipped stale-overwrite bug's confirmed mechanism; with N accounts, up to N full re-fetches and "Loading…" flips per open; **also unmounts/remounts the home cards each time, re-firing their relay fetches (multiplier on #4)** | 1, multiplies everything |
| 4 | **Relay/NWC sockets from mount effects, uncached**: `pqc_checkPublished` (WebSocket per write relay), `getMyMuteList` (WebSocket per relay, 8s timeout), `wallet_getBalance` (NWC round trip) | PqcCard.tsx:59 → pqc-handlers.ts:275-292; MutesCard.tsx:19 → profile-handlers.ts:216-223; HomeTab.tsx:106 | The PqcCard bug class moved off first paint but not eliminated: blank/wrong cards gated on the slowest relay, repeated per card remount (#3), and repeated again by PqcSection and FiltersModal in the same session | 3 + repeats |
| 5 | **GlobeButton reads raw `tab.url`, computes `connected` once, no listener** — never migrated to `resolveActiveTabDomain` | GlobeButton.tsx:17-37 vs activeTabDomain.ts:4-13 | One third of the shipped three-readers incident still live: blind on background-opened popups; dot goes stale when HomeTab connects/disconnects (and vice versa) | 1 of 3 unfixed |
| 6 | **No popup listener for `allowedDomains`/`identityDisabledSites`**; the background listens to its own writes (domain-handlers.ts:28) but the popup does not; `configUpdated` has 5 emitters and **zero listeners**, and runtime messages never return to the sending document, so the bus cannot work same-popup | GlobeButton.tsx:17-37; HomeTab.tsx:65-95; background.ts:48-58 | Connect from the globe leaves the home card stale and vice versa — the owner's known bug, both directions confirmed | 2 copies + a dead bus |
| 7 | **`signer_getPending` fetched twice with two different filters** — HomeTab badge unfiltered, ApprovalOverlay origin-filtered fail-closed | HomeTab.tsx:149-165; ApprovalOverlay.tsx:50-66 | Badge can show a count the overlay (correctly) refuses to display; duplicate fetch + duplicate listener per event | 2 |
| 8 | **Empty-password auto-unlock ritual copied three times, all bypassing the brute-force lockout** in useVaultUnlock.ts:46-48 *(verifier: UNDERSTATED — auditor found 2, missed PasswordStep)* | UnlockModal.tsx:63-69; KeyActionModal.tsx:66-79; PasswordStep.tsx:39-43 | The predicted "policy must be fixed in N places" failure has already shipped, in a security-relevant path | 3 |
| 9 | **Two incompatible profile-cache schemas** — background writes `profile_<pubkey>`; AccountContext keeps a separate `profileCache` aggregate and only watches that *(verifier: UNDERSTATED)* | AccountContext.tsx:86-89,117 vs profile-handlers.ts:41-54 | **Live bug**: publish a profile edit → new metadata lands in `profile_<pk>` via `updateProfileCache`, `reload()` re-reads the stale aggregate → top bar shows the old name/avatar for the rest of the session (EditProfileOverlay.tsx:170-173). Plus a lost-update RMW race between concurrent resolutions (AccountContext.tsx:82-93) | 2 schemas, every profile |
| 10 | **~20 async effects with no cancellation/versioning; last-to-finish wins.** Only 5 sites in the whole popup guard themselves; even useRpc lacks a token (useRpc.ts:34-51) | VaultContext.tsx:29-49; PermissionsContext.tsx:38-59; Wallet.tsx:164-208; ActivityModal.tsx:69-78 | Vault shown locked after unlocking, permissions list reverting an optimistic save, stale transaction list after filtering — the HomeTab class, everywhere | ~20 |
| 11 | **All three context values are unmemoized object literals** | AccountContext.tsx:127-141; VaultContext.tsx:80-89; PermissionsContext.tsx:116-127 | Every provider render re-renders all consumers and re-runs any effect with a context object in deps — the amplifier under #2 and #3; during #2's loop, duplicate `vault_unlock` RPCs fire (UnlockModal.tsx:63-69) | 3 |
| 12 | **Approve/deny loops one RPC per request**; popup death mid-loop half-resolves the queue. `signer_resolveBatch` already exists and (verifier) already covers per-group approve/deny verbatim | ApprovalOverlay.tsx:128-133,146-151,202-209 | Blur after the second of five awaits: 2 signed, 3 hang until timeout — the shipped lost-click class | 3 loops |
| 13 | **Wallet deposit/send flows are memory-only in a window destroyed on focus loss** | Wallet.tsx:75-95 | The deposit flow's whole point is switching away to pay the invoice; reopening loses invoice, hash, paid-detection. Payment has no in-flight record (Wallet.tsx:300-323) → LN-address retry double-pays | 2 flows |
| 14 | **Profile publish runs the Blossom upload in the popup and snapshots `cachedProfile` at open** | EditProfileOverlay.tsx:56-74,113-133,146 | Blur during upload kills the publish; the late-arriving-profile race can publish a kind:0 stripped of fields the user never saw | 1 |
| 15 | **Transport failure rendered as a real "no"** — failed RPC paints "not connected"; relay outage shows "set up post-quantum keys" to a user who published; RPC failure shows "set up a wallet" | GlobeButton.tsx:28-29; pqc-handlers.ts:290-291 + PqcCard.tsx:61; HomeTab.tsx:108-110 | Each invites a wrong user action (reconnect, PQC re-setup/republish, wallet re-setup); the correct pattern already exists in useSiteState's `error` state (HomeTab.tsx:65-77,311-319) | 3 |
| 16 | **Plaintext mnemonic written to storage.session from the popup**, keys never swept *(verifier: OVERSTATED as "on disk today" — latent, see §cleared — but the invariant violation is real and gates step 3's ordering)* | CreateStep.tsx:52-54; useWizardFlow.ts:24,91; sweep at onboarding-handlers.ts:331-341 | Becomes cleartext-on-disk the moment the shim unification (#17) lands first; even memory-backed, the seed outlives its 5-minute TTL until browser restart (TTL enforced only on read) | 2 write sites |
| 17 | **Two divergent browser shims**: lib/browser.ts polyfills storage.session, src/shared/browser.ts does not; background writes `popupContext` through one, popup reads through the other | lib/browser.ts:10-49 vs src/shared/browser.ts; openPopupForActiveTab.ts:38 vs activeTabDomain.ts:59 | On a shim-active browser, account creation throws outright at CreateStep.tsx:35 and the popup-context handoff degrades; one API name, two stores | 5 consumers + a third variant in lib/i18n.ts:6 |
| 18 | **Wallet.tsx is five features in one closure**: 46 useState hooks, five mount fetches, four hand-rolled portal modals, a full OverlayPanel reimplementation; PR #21 grew it in place | Wallet.tsx:62-118,210-216,568-990 | Every wallet feature lands here; the only subtle logic (paging/filter predicates, duplicated at :164-208 and :508-528 and required to agree; timezone-sensitive date boundary) is closure-trapped and untestable | 1 file, the growth magnet |
| 19 | **Modal extraction reached 2 of ~9 dialogs**; 7 bespoke scrims remain, two of them line-for-line twins (Settings permModal / Wallet txFilterModal); six scrim opacities; Escape/backdrop/focus exist only in Modal.tsx:43-59 — whose own Escape handler bypasses `dismissOnBackdrop` (verifier-found hole) | Modal consumers: PqcSection.tsx:6, MenuOverlay.tsx:6; bespoke list in Wallet.module.css, Settings.module.css, UnlockModal, KeyActionModal, WizardOverlay:551 (+ a 4th unconsolidated modal at CreateStep.tsx:180-209) | New dialogs copy whichever CSS is nearest — that is how the twins happened; the scroll revert was this finding in miniature | 7+ |
| 20 | **OverlayPanel.body has no overflow rule; the scroll contract is undefined** | OverlayPanel.module.css:78-83; consumers each re-solve at a different depth; MenuOverlay.module.css:31 documents why the central fix broke | The still-open clip bug (§6); tall Settings sections (PqcSection, 346 lines) silently clip today | 7 consumers, 10+ private scroll patches |
| 21 | **AccountDropdown reimplements account removal in a click handler** — swallowed `vault_removeAccount` failure, then UI-side storage surgery with a load-bearing ordering comment | AccountDropdown.tsx:55-83 | A throw mid-sequence leaves vault and accounts inconsistent; the invariants are enforced nowhere testable | 3 (+ 2 wizard steps reading `accounts` raw) |
| 22 | **Locale placeholder drops** — 15 instances across 5 locales ({address}, {count}, {n} silently gone), no CI check; Modal aria-label hardcoded English, OverlayPanel close has none | locales/*; Wallet.tsx:977; Modal.tsx:73; OverlayPanel.tsx:45-72 | A consent dialog asks non-English users to publish "your Lightning address" without showing which one | 15 strings + 2 components |
| 23 | **Mount-only home cards stale under the menu overlay**; the wallet-only `menuOpen` re-check hack (HomeTab.tsx:124-128) is the structure fighting back | RelaysCard.tsx:16-23; MutesCard; PqcCard.tsx:68 | Edit relays, close menu: stale count; publish attestation: card still says "set up" | 4 cards |
| 24 | **VaultContext.locked has no push invalidation** — background auto-lock fires while the popup sits open and the UI keeps rendering unlocked *(verifier-found, missed by all lenses)* | VaultContext.tsx:29-63 | The missing-invalidation class on the single most security-relevant fact in the tree | 1 |
| 25 | Friction cluster, all confirmed: seed-backup PBKDF2/AES-GCM inline and format untested (KeyActionModal.tsx:166-198); kind:0 publish duplicated and divergent (Wallet.tsx:405-425 vs EditProfileOverlay); clipboard pattern ×11, security-sensitive copies silent; truncation ×6 shapes, no origin-ellipsis in ApprovalOverlay; formatTxDate duplicates formatTimeAgo with a seconds-vs-ms trap; theme literals ×134/26 files; card visual ×50/20 files; z-index ×15 ad-hoc values; native `confirm()` at PqcSection.tsx:219; EventDetailModal in src/components with shadow domain types; docs/component-standards.md lists a component that doesn't exist and omits the 15 newest | various | Cost deferred, drift accruing; each is individually cheap and testable | see plan |

### Checked and cleared

Findings the verifiers cut down, with my reading where auditor and verifier disagreed:

- **"Unlock dialog unclickable under the approval scrim" (z 360 vs 500)** — the DOM state exists, but UnlockModal.tsx:62-69 auto-unlocks never-lock vaults in one RPC, and never-lock vaults are guaranteed an empty password by both write paths (vault-handlers.ts:104-128; PasswordStep.tsx:81). Transient flash, not a lockout. The z-index chaos is still worth tokenizing, but as hygiene, not a bug fix.
- **"Forgetting a reset line leaves an nsec in KeyActionModal state"** — MenuOverlay.tsx:275-280 conditionally renders the modal, so close unmounts it and React discards all state. The standing part is the untested inline crypto (plan step 8).
- **"Seed sits unencrypted on disk today (Safari)"** — does not reproduce in any current configuration: the popup's unshimmed browser module throws on shim-active browsers before anything is written, and native storage.session is memory-backed. My reading: the auditor had the right defect in the wrong tense — it is a landmine armed by the shim fix, which is why step 3's ordering is non-negotiable.
- **"~20 RPCs, 4 exact duplicates per open"** — arithmetic loose; verified ~15-20 depending on account state, with 2 unconditional duplicate pairs. Conclusion (contexts first, batched `popupInit` later if ever) unchanged.
- **"Fold NavItem into NavRow, 2 files change"** — three factual errors (NavRow does truncate its subtitle; consumer accounting wrong; the two rows are deliberately different visual identities). Cleared; see §5.
- **Firefox suppresses popup `confirm()`** — the code and the fix are solid; the Firefox behavior was asserted, not demonstrated. Replace it anyway (the shared Modal exists and the string is localized), but as consistency work.

---

## 3. The plan, in execution order

Ordering principle: verifiable and self-amplifying problems first. Steps 1-3 are bug fixes with proofs; steps 4-7 build the structure that removes the bug *class*; steps 8-12 are paydown. Nothing here requires a state library, a fetch library, or a component test framework.

### Step 1 — Stop the popup's self-inflicted churn *(hours; mostly provable by reading)*

- HomeTab.tsx:91-93: depend on `active?.id`, not `active`; add a version ref to `loadHomeState` (`const v = ++versionRef.current; … if (v !== versionRef.current) return;`). `loadHomeState` never reads `active`, so the keying change is provably behavior-narrowing. This also removes the card remount multiplier that re-fires every relay fetch (finding 3/4).
- Break the ApprovalOverlay loop: hold `onRequestUnlock` in a ref (or `useCallback` it in PopupApp), and bail in `onUnlockWaitersChange` when the waiter list is deep-equal. **Caution from verification**: the loop is today an accidental polling mechanism — before shipping, manually walk the approval + unlock flow and confirm `signerPendingUpdated` broadcasts on every transition, including `waitingForUnlock` flips.
- GlobeButton: replace the tabs.query block with `resolveActiveTabDomain()`. Verified behavior-identical when the URL is granted (`getDomainFromUrl` is literally `new URL(url).hostname`, url.ts:1-6) and strictly better when withheld — the one migration in this plan that is safe to ship blind.
- RelaysCard: 5-line storage.onChanged listener — **must filter `area === 'sync'`**, unlike every existing popup listener.
- Defer `captureVisibleTab` (PopupApp.tsx:46-50) behind an idle callback after first paint; fix its comment to name the programmatic-open case so nobody "fixes" it by adding a host permission.

**Verify**: the first three are logic changes checkable by reading plus one manual popup pass with RPC logging in the background (count messages per open — should drop visibly); the approval walk above.

### Step 2 — Locale placeholders, aria-labels, and the CI test that pins the class *(hours; fully testable)*

Fix the 15 dropped-placeholder strings; add `common.close` to all six locales; `aria-label={t('common.close')}` in Modal.tsx:73 and OverlayPanel's close/back buttons. Add a node:test asserting every locale has en's key set **and** en's placeholder set per key — this repo has real PR-gating CI, so the test permanently closes the drift class.

**Verify**: the new test is the verification. Pure data.

### Step 3 — Secrets out of wizard session storage, *then* unify the browser shim *(a day; node:test)*

Order matters and is the one place two lens reports interacted: unifying the shims first routes the popup's plaintext-mnemonic session writes onto disk-backed `storage.local` on exactly the browsers the shim serves.

1. Strip `mnemonic`/key material from `useWizardFlow`'s persisted ctx; have CreateStep restore via an `onboarding_getPendingAccount` RPC (the background already holds it XOR-split); add `wizardCreateData`/`wizardState` to `cleanupExpiredPendingOnboarding`.
2. Then collapse lib/browser.ts and src/shared/browser.ts (and the inline variant in lib/i18n.ts:6) onto one shim module.

**Verify**: both halves against the existing browser mock in node:test; the sweep gets a test asserting wizard keys are removed.

### Step 4 — Make useRpc the one blessed read primitive, and say so *(1-2 days; hook fully testable)*

Extend the existing, orphaned src/shared/hooks/useRpc.ts with: an epoch counter (stale results discarded), an unmount guard, and an optional `watch: [storageKeys]` re-run with stable identity. Write node:test coverage for the hook — it is pure logic and the popup's only currently-verifiable seam. Adopt the rule in docs (step 12): **components call `rpc()` only for commands; shared reads come from a context or this hook.** This also answers the verifier's open question: useRpc grows into the sanctioned read path rather than remaining a side door.

Migrate a *handful* of low-risk consumers (WalletSection, ActivityModal — MutesCard is already on it). Do **not** sweep all 20; see §5.

**What it unlocks**: every subsequent step that touches a fetch gets cancellation and invalidation for free, tested once instead of hand-rolled twenty times.

### Step 5 — SiteContext and PendingContext *(2-3 days; core logic testable, consumers migrated byte-identical)*

- **SiteContext** owns `{ domain, restricted, allowedDomains, identityDisabled }`: one `resolveActiveTabDomain` + one `getAllowedDomains` + one `getIdentityDisabledSites` per open, invalidated by storage.onChanged on those keys (the background already writes them as plain keys; the pattern exists in the background's own cache invalidation at domain-handlers.ts:28). Migrate HomeTab first, **moving its empty/loading/notConnected/error state machine byte-identical — props for locals only** (these are exactly the visual states behind last week's rollbacks); migrate GlobeButton in a separate change so any regression is attributable. This deletes both private copies, the desync, and the duplicate round trips, and gives the site fetch one owner.
- **PendingContext** owns the `signer_getPending` result plus the resolved domain, with the fail-closed filter applied once. **Expose both the filtered groups and the unfiltered actionable count** — the unfiltered badge is currently the only surface signaling unlock-waiters from other tabs, so which count the badge shows is a product decision to make explicitly, not a side effect of dedup.

**Verify**: the contexts' load/subscribe logic lives in plain modules under node:test with the browser mock; consumer diffs are mechanical and small; one manual pass through the home states per migration.

### Step 6 — Background-owned cache-then-refresh for the relay-backed cards *(1-2 days background + small popup diffs)*

Give `getMyMuteList` and `pqc_checkPublished` the treatment `fetchProfileMetadata` already has (profile-handlers.ts:36-46: storage-backed TTL cache): answer from cache instantly, refresh from relays behind, land updates via storage.onChanged — which also fixes the stale-under-menu cards (finding 23) and lets the `menuOpen` prop-threading hack be deleted. Rule to adopt: **no popup mount effect may open a socket.**

Two verified cautions: a cached `pqcPublished` shown as plain truth defeats the handler's documented purpose (pqc-handlers.ts:269-274 — it queries relays precisely to catch rotation from another device), so the cached render must be visually qualified as "last known"; and defer the wallet-balance cache — a stale money figure without a staleness cue is worse than a blank one. Fix finding 15 in the same pass: `pqc_checkPublished` throws (or returns `{error:true}`) instead of `published:false` on catch; GlobeButton/HomeTab keep `null` = unknown instead of coercing to `false`.

**Verify**: background halves entirely in node:test (tests/pqc-handlers.test.ts exists); the popup halves are render-only reads of cached values.

### Step 7 — One profile cache, one profile publisher *(a day; fixes a live bug)*

Delete the popup-side `profileCache` aggregate: the background's per-key `profile_<pubkey>` store (with TTL, and an existing `getProfileMetadataBatch`) becomes the sole schema; AccountContext subscribes to `profile_*` changes and drops its write path (AccountContext.tsx:84-93 shrinks to fire-and-forget), with a one-time migration read of the old key. This fixes the stale-top-bar-after-publish bug, the RMW lost-update race, and removes the storage.onChanged trigger that fed step 1's churn — three findings, one move. Extract `publishProfileMetadata(patch)` into src/shared/ from EditProfileOverlay's `buildMetadata` (pure, testable) and route Wallet.tsx:405-425's divergent copy through it.

**Verify**: `buildMetadata`/merge logic under node:test; manual check: publish a profile edit, top bar updates immediately.

### Step 8 — Pure-logic extractions *(1-2 days; every item gains a test)*

All of these move untestable closure logic into the repo's one verifiable lane, following the siteState.ts / wizardMachine.ts precedent:

- KeyActionModal's inline PBKDF2/AES-GCM (lines 166-198) → `lib/crypto/seedBackup.ts` with encrypt+decrypt and a **round-trip node:test** — nothing currently verifies a seed backup can be decrypted, in a key-custody extension. Non-negotiable.
- Wallet tx filtering → `matchesFilters(tx, filters)` + `accumulateFilteredPages(fetchPage, filters, target)` with an injected fetcher; kills the two-predicates-must-agree hazard and the untested timezone boundary.
- `formatTxDate` → fold into shared/format/time.ts with the unit documented in the signature (the seconds-vs-ms trap is real).
- `useCopy()` hook (11 sites; the nsec/seed copies currently give no feedback); `truncateNpub` adoption at the 6 slice() sites; `getAccountLabel` for the 3 name-fallback chains.

### Step 9 — Wallet decomposition and dialog migration, one commit each *(3-4 days)*

Now cheap because step 8 tested the logic and step 4 provides the fetch primitive. Split by the ownership boundaries the reset lists at Wallet.tsx:346-366 already prove: DepositModal (owns the polling effect, reports via `onPaid`), SendModal (`onSent`), TransactionsCard, WalletSettingsOverlay + LightningAddressCard; parent keeps balance and orchestration. In the same series:

- Persist deposit/send snapshots to storage.session with a short TTL (the useWizardFlow pattern; invoices are not secrets) — the deposit flow's entire purpose is switching away.
- Background pending-payment record keyed by payment hash before paying, cleared on completion; surfaced on mount (node:test).
- Batch the approval loops: `handleApprove`/`handleDeny` need **no new handler** — a group shares origin and permKey by construction, so existing `signer_resolveBatch` covers them; add an `ids[]` variant only for `handleRejectAll`.
- Migrate the true dialogs onto shared Modal one per commit (the twin permModal/txFilterModal first), **with a state checklist per dialog** (configured wallet, unlocked vault mid-key-action) — verified caveats: the bespoke dialogs are `position:fixed` with backdrop blur while Modal is `position:absolute` without, so keep blur on the two key-material surfaces and expect the scrim's covered area to change; fix Modal's Escape hole first (`dismissOnBackdrop` must also guard Escape, Modal.tsx:43-48); **never migrate ApprovalOverlay** — it is deliberately non-dismissible.

**Verify**: extracted logic by test; each dialog commit by eye against its checklist. This is the step that cannot be fully verified before shipping — sequenced last among the big moves for exactly that reason, and sliced so each blind diff is one dialog.

### Step 10 — Vault and account-lifecycle consolidation *(1-2 days; security path — tests before shipping)*

- VaultContext stores `autoLockMs` (deriving the boolean); one `tryAutoUnlock()` routed through useVaultUnlock so the three empty-password call sites stop bypassing the lockout counters. Land the trivial isNip46 dedup (drop VaultContext's copy in favor of AccountContext's derivation) separately; land the unlock consolidation only with node:test coverage of the extracted logic — a mistake here is a security regression.
- Move account removal wholly into `vault_removeAccount`, preserving the ordering AccountDropdown.tsx:67-76's comment documents (sync `myPubkey` cleared **before** the local accounts write, or AccountContext's migration re-creates the account) — **pinned by a test**, or the refactor reintroduces the bug the comment exists to prevent. Wizard steps switch to `useAccount()`.
- Push invalidation for `locked`: background notifies (or writes a watched key) when auto-lock fires, so an open popup stops rendering unlocked UI (finding 24).

### Step 11 — Memoize the three context values, one provider per release *(hours each)*

Mechanical, zero intended behavior change — but it changes effect-firing frequency popup-wide, and flows that accidentally lean on extra re-runs would degrade with no test to catch it. One provider at a time, with a manual pass between.

### Step 12 — Docs and tokens: write the rules the code now follows *(a day; zero code risk)*

Rewrite docs/component-standards.md around decisions, not inventory: choosing a surface (OverlayPanel = navigate, Modal = interrupt, approval sheet = neither — the comment at Modal.tsx:13-16 already says this where nobody looks), the fetch rule from step 4, the scroll-ownership contract from §6, "null means unknown, never no" for transport failures, and a z-scale as theme.css tokens (label the z pass a behavior change, not a refactor — it deliberately reorders unlock above approval and must resolve the Splash/UnlockModal 9999 tie by DOM-order accident today). Do the exact-value token find/replace (134 literals whose values match existing tokens — byte-diffable, zero visual change) and replace the native `confirm()` at PqcSection.tsx:219 with the shared Modal. Drop the stale component table or auto-generate it.

---

## 4. The one thing to do first

**Step 1's identity fix: key HomeTab's effect on `active?.id` and version-guard `loadHomeState`.** Roughly ten lines. It is the confirmed mechanism of a bug that already shipped (the stale-overwrite), and — the part no single lens saw until verification joined them — it is the *multiplier* under everything else: each churn cycle resets `siteState`, which unmounts and remounts the home cards, which re-fires every relay WebSocket fan-out, up to N+1 times per popup open. Every other cost in this document gets smaller and every future measurement gets honest once the popup stops re-doing its own work. It is also verifiable by pure reading (`loadHomeState` demonstrably never uses `active`), which no other candidate for "first" can claim.

---

## 5. What NOT to do

- **A state library (Zustand/Redux/jotai).** The popup is destroyed on focus loss; any in-memory store dies with it. Durable state already has a home (extension storage) and an invalidation primitive (storage.onChanged) that the background itself already uses correctly (domain-handlers.ts:28). A store would be a third copy of every fact between storage and components — this codebase's disease is *too many copies*, and there are no component tests to catch what the migration breaks.
- **A data-fetching library (react-query/SWR).** Built for long-lived pages with in-memory caches; here the cache must live in extension storage to survive popup death, and the transport is an rpc layer with MV3 wake-retries these libraries know nothing about. The needed subset — epoch, unmount guard, watch keys — is ~60 lines in the useRpc this repo already owns, and *that* can be node:tested.
- **Migrating all ~20 rpc callers onto useRpc in one sweep.** Each migration is a per-component behavior change (the hook re-fires when `JSON.stringify(params)` changes) verifiable only by hand in an untestable popup. Twenty blind diffs at once is precisely the shape of last week's two rollbacks. Extend the hook, test it, migrate opportunistically.
- **Changing OverlayPanel's default body overflow, or any other one-shot change to a shared surface.** Already tried, already reverted, and the verifiers explained mechanically why it had to fail (nested scroll containers; MenuOverlay's shadow clipping). The opt-in path in §6 reaches the same end state.
- **"Just add Escape handling to OverlayPanel — same five lines as Modal."** Modal's Escape listener is on `document` with no layering protocol, and Modals demonstrably stack over OverlayPanels (PqcSection at zIndex 720); the five-line version closes every layer on one keypress — a regression of exactly the class that was reverted. Needs a top-most-only dismissal protocol, designed once, verified in a browser.
- **Folding NavItem into NavRow.** The verifier found the audit's premise flawed: they are two deliberate visual identities (floating shadow card vs flat hairline row), the consumer accounting was wrong, and TypeScript passing says nothing about the menu looking right. Add title truncation to each where missing; leave them apart.
- **Origin-filtering the pending badge as a "dedup".** It silently blinds the only surface that signals unlock-waiters from other tabs. If the badge should be origin-scoped, decide it as product behavior in step 5, visibly.
- **A dark theme riding along with the token cleanup.** The find/replace is byte-diffable; a palette redesign is not. Separate decisions.
- **A `popupInit` mega-RPC before the contexts exist.** Collapsing ~10 calls into one is real savings, but doing it first would freeze today's ownership chaos into one giant response shape. Contexts first; batch later if the numbers still justify it.

---

## 6. The still-open scroll bug

**The correct fix is an opt-in prop, not a changed default** — both the extension-hazards and shared-layer lenses converged on this independently, and the verifiers rated it the safest incremental change in the whole set.

The contract is currently *silently absent*: `.body` is `flex:1; min-height:0; display:flex; flex-direction:column` with no overflow rule (OverlayPanel.module.css:78-83), so each of the 7 consumers re-guesses. Four brought their own inner `overflow-y:auto` at four different depths; MenuOverlay deliberately has none ("no overflow so shadows & hover transforms aren't clipped", MenuOverlay.module.css:31); the Settings sections brought nothing and clip today — PqcSection, at 346 lines of content, is the worst. The reverted central fix failed for two mechanical reasons: it nested a scroll container above consumers that already scrolled internally (their `flex:1; min-height:0` areas no longer resolved a bounded height — collapse or double-scroll), and a scroll container establishes the paint clip MenuOverlay's shadows cannot survive. A one-shot default change was guaranteed to regress someone, and did.

**The fix, scoped:**

1. Add `scroll?: boolean` to OverlayPanel, rendering `.bodyScroll { overflow-y: auto; overscroll-behavior: contain; }` alongside `.body`. Default off — today's rendering is byte-identical for every existing consumer, so the prop itself ships risk-free.
2. Migrate one consumer per commit, and **in the same commit delete that consumer's private inner scroll wrapper** — so a nested scroll pair never exists at any point in the sequence. Order: the clipping Settings sections first (PqcSection, then the rest reached via MenuOverlay's section view), then ActivityModal, EditProfileOverlay, EventDetailModal, FiltersModal.
3. MenuOverlay's menu-item list migrates **last**, compensating its shadows with padding inside the scroll container instead of relying on unclipped overflow.
4. Flip the default (and delete the prop) only when all seven are migrated — or keep the prop permanently; either way the contract is now stated in the component instead of guessed per consumer.

**How to verify before shipping**: each step is a single section's diff. Build in the main clone (`npm run build` — the browser loads `dist/` from here, per CLAUDE.md; a worktree build verifies nothing visible), open the popup, and check three things for that one section: tall content scrolls to the bottom (PqcSection's full height is the natural fixture), short content is not visually changed, and — for MenuOverlay only — hover transforms and shadows are not clipped. Because no step touches more than one consumer, any regression is attributable to its commit and revertable alone, which is the property last week's central fix lacked.
