# Architecture

## 1. Overview

The Nostr WoT Extension is a Manifest V3 browser extension that provides:

1. **NIP-07 Identity Provider (Signer)** -- Exposes `window.nostr` for web applications to request public keys, event signing, and NIP-04/NIP-44 encryption/decryption.
2. **WebLN Lightning Wallet** -- Exposes `window.webln` for web applications to send/receive Lightning payments via connected wallets.

The popup also lets the user edit their kind:0 profile, manage their own NIP-51 `kind:10000` mute list, and edit their NIP-65 read/write relay list.

> **0.8.0 experimental:** `window.nostr.wot` is restored behind menu-only opt-in,
> with local, remote-oracle and hybrid queries. It is off by default. See [WoT](wot.md).
> A new IndexedDB snapshot service stores compact graphs; page badges remain removed. Automatic refresh is separately opt-in.

The extension targets Chrome and Firefox, using a service worker on Chrome and a background script on Firefox (declared side by side in `manifest.json`).

**Build system**: Vite + `@crxjs/vite-plugin`. All source is TypeScript (`.ts`/`.tsx`), compiled to JavaScript at build time. React JSX is used for popup, onboarding, and prompt UIs.

**TypeScript configuration**: `strict` mode, ES2022 target, `moduleResolution: bundler`, `jsx: react-jsx`. Path aliases: `@assets`, `@components`, `@screens`, `@domain`, `@services`, `@context`, `@hooks`, `@utils`, `@styles`, `@lib`. `@models` and `@shared` no longer exist — `models/` was merged into `domain/` and `shared/` was split into `domain/`, `services/` and `utils/` by what a thing is (see [Component Standards §2](component-standards.md)).

Cross-browser compatibility is handled by a thin shim at `src/lib/browser.ts`:

```ts
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
export default browserAPI;
```

Firefox natively supports the `browser.*` API; Chrome uses the `chrome.*` API. All other modules import from `src/lib/browser.ts` (aliased `@lib/browser.ts`) to stay portable.

---

## 2. Extension Architecture

### 2.1 Background Script -- `background.ts` + `src/services/background/`

The central coordinator. Runs as a **service worker** on Chrome and a **persistent background script** on Firefox (both declared in `manifest.json` via `"service_worker"` and `"scripts"` fields respectively, with `"type": "module"`).

`background.ts` is a thin orchestrator (~300 lines) that assembles handler modules, sets up listeners, and dispatches requests. Business logic lives in `src/services/background/` handler modules, each exporting a `Map<string, HandlerFn>` plus individual functions for direct testing.

#### Handler Modules -- `src/services/background/`

| Module | Responsibility |
|--------|---------------|
| `state.ts` | Shared mutable state (`config`) and background utility functions |
| `domain-handlers.ts` | Domain allowlist (`connectDomain` is its only writer), dismissed domains, first-visit connect prompt, the tab→origin registry behind account broadcasts, identity disable |
| `vault-handlers.ts` | Vault lifecycle (unlock/lock/create), account switching |
| `nip07-handlers.ts` | NIP-07 signer methods (sign, encrypt/decrypt), permission management |
| `wallet-handlers.ts` | WebLN page methods + privileged wallet management (connect, provision, Lightning Address) |
| `onboarding-handlers.ts` | Account import/generation, NostrConnect sessions, vault creation during onboarding |
| `profile-handlers.ts` | Profile metadata (kind:0) fetch/cache, NIP-51 mute-list (kind:10000) fetch (`getMyMuteList` / `fetchMuteList`) |
| `publish-handlers.ts` | Event signing/broadcasting, relay-list (kind:10002) and mute-list (kind:10000) publishing, NIP-46 session info, relay health checks |
| `activity-handlers.ts` | Activity log read/clear with in-memory write buffering |
| `pqc-handlers.ts` | Post-quantum key status/import/removal (`pqc_getStatus`, `pqc_importKeys`, `pqc_removeImportedKeys`) |
| `relayCache.ts` | Background-side cache backing the popup's cached-first relay reads |
| `misc-handlers.ts` | Assembles focused handler maps; consumers import functions from their owners |

**Dispatch pattern:** Each handler module exports `handlers: Map<string, HandlerFn>`. `background.ts` merges all maps into a single `allHandlers` map. `handleRequest()` does pre-checks (NIP-07 validation, domain gating, read-only guard, npub normalization) then delegates to `allHandlers.get(method)`.

**Dependency rules:** Handler modules import from `state.ts`, feature services, domain models and low-level libraries, and may import exported functions from sibling handler modules (e.g., `nip07-handlers` imports `logActivity` from `activity-handlers`). No circular dependency chains exist.

Responsibilities of `background.ts`:
- Handler map assembly from all `src/services/background/*-handlers.ts` modules
- `loadConfig()` -- initializes `state.config` (myPubkey, relays) and ensures an active account exists in `browser.storage.local`
- Startup IIFEs: `loadConfig()`, permission migration, vault auto-unlock, `approvalQueue.cleanupStale()`. The auto-unlock is registered through `vault.beginStartupUnlock()` so request paths can await it instead of mistaking the cold-start window for a locked vault (see [Security](security.md))
- `browser.runtime.onMessage` listener (privilege gate, origin derivation, dispatch to `handleRequest()`)
- `browser.runtime.onConnect` listener (port-based NIP-07/WebLN)
- `browser.alarms.onAlarm` listener -- the `'vault-keepalive'` tick does a trivial storage read to keep the MV3 service worker alive until the vault auto-lock fires (see [Security](security.md))
- Auto-injection: `content.ts` and `inject.ts` are declared as `content_scripts` in `manifest.json` (matching `<all_urls>`), so the browser handles injection automatically.
- On `runtime.onInstalled` (reason `install`), opens the onboarding wizard if no vault exists.

### 2.2 Content Script -- `content.ts`

Runs in the **ISOLATED** world. Acts as a bidirectional message bridge between the page context (`inject.ts`) and the background script.

- Listens for `window.postMessage` events with `type: 'NIP07_REQUEST'` or `type: 'WEBLN_REQUEST'`.
- Validates the method name against hardcoded allowlists: `NIP07_ALLOWED_METHODS`, `WEBLN_ALLOWED_METHODS`.
- Forwards valid requests concurrently over one persistent port per channel (`browser.runtime.connect`), correlating replies by internal request ID so approvals do not serialize delivery.
- Posts responses back to the page as `NIP07_RESPONSE` or `WEBLN_RESPONSE`.
- **HTTPS enforcement**: NIP-07 and WebLN methods are blocked on `http:` origins except `localhost`, `127.0.0.1`, and `[::1]`.
- **NIP-07 prefixing**: Adds `nip07_` prefix and `origin` (scheme, hostname and port) to all NIP-07 requests before forwarding.
- **WebLN prefixing**: Adds `webln_` prefix and `origin` (scheme, hostname and port) to all WebLN requests before forwarding.
- Guards against double injection with `window.__nostrWotContentInjected`.

### 2.3 Inject Script -- `inject.ts`

Runs in the **MAIN** world (page context). Written as an IIFE with `export {}` for module context. Bundled by Vite into a single script.

Exposes two API surfaces on the page:

- `window.nostr.getPublicKey()`, `window.nostr.signEvent(event)`, `window.nostr.getRelays()`, `window.nostr.nip04.{encrypt,decrypt}`, `window.nostr.nip44.{encrypt,decrypt}` -- NIP-07 signer.
- `window.webln.{enable, getInfo, sendPayment, makeInvoice, getBalance}` -- WebLN Lightning wallet API.

Each method posts a typed message to `window.postMessage` and returns a Promise that resolves when the matching response arrives. Timeout: 120 seconds for NIP-07 and WebLN calls (users may need time to respond to prompts).

Fires `CustomEvent('webln-ready')` and `CustomEvent('nostr-wot-ready')` on `window` when injection completes so pages can detect API availability.

### 2.4 Popup -- `src/entrypoints/popup/`

Extension popup UI opened when clicking the toolbar icon. React-based, styled with Tailwind (see [Component Standards §7](component-standards.md)). The entry document itself is thin; feature content lives under `src/screens/`, outside the browser-document shells.

| File | Purpose |
|------|---------|
| `src/entrypoints/popup/index.html` | Entry point |
| `src/entrypoints/popup/main.tsx` | React app mount |
| `src/entrypoints/popup/PopupApp.tsx` | Root component: the `OverlayType` state machine, splash/unlock gating, wires the context providers and hands navigation to `NavigationProvider` |
| `src/screens/` | One folder per screen (`Home`, `Menu`, `TopBar`, `Vault`, `Activity`, `Approval`, `EditProfile`, `Settings`, `Wallet`, `Filters`) — all popup-only, so not split by entry point |
| `src/context/` | The eight React contexts (`AccountContext`, `VaultContext`, `PermissionsContext`, `WalletContext`, `RelaysContext`, `PqcContext`, `NavigationContext`, `ActivityContext`) |
| `src/screens/Wizard/` | Account-creation screens shared by popup and onboarding; neither is their owner |

### 2.5 Onboarding -- `src/entrypoints/onboarding/`

First-run wizard opened on `runtime.onInstalled` if no vault exists. Guides users through account creation (generate, import nsec, import npub, NIP-46 bunker) by rendering the same `src/screens/Wizard/` steps the popup uses.

| File | Purpose |
|------|---------|
| `src/entrypoints/onboarding/index.html` | Entry point |
| `src/entrypoints/onboarding/main.tsx` | React app mount |
| `src/entrypoints/onboarding/OnboardingApp.tsx` | Hosts `useWizardFlow()` (`@hooks`) and `WizardSteps` (`@screens/Wizard`) |

### 2.6 Prompt -- `src/entrypoints/prompt/`

Signing request approval popup. The signer queues pending requests in `browser.storage.session` and the popup overlay shows them with approve/deny buttons.

| File | Purpose |
|------|---------|
| `src/entrypoints/prompt/index.html` | Entry point |
| `src/entrypoints/prompt/main.tsx` | React app mount |
| `src/entrypoints/prompt/PromptApp.tsx` | Document shell rendering `PromptScreen` |
| `src/screens/Prompt/PromptScreen.tsx` | Pending-request loading, approval content and decision handling |
| `src/screens/Prompt/DecisionRow.tsx`, `src/screens/Prompt/UnlockSection.tsx` | The row and the vault-locked sub-view `PromptScreen` composes |

---

### 2.7 Wallet Provider Layer -- `src/services/wallet/`

Abstracts Lightning wallet backends behind a common `WalletProvider` interface. Each provider implements `getInfo()`, `getBalance()`, `payInvoice(bolt11)`, `makeInvoice(amount, memo)`, `connect()`, `disconnect()`, and `isConnected()`.

| File | Purpose |
|------|---------|
| `src/domain/wallet/types.ts` | `WalletConfig` (discriminated union: `nwc` or `lnbits`), `WalletProvider` interface, `SafeWalletInfo` |
| `src/services/wallet/nwc.ts` | NWC (Nostr Wallet Connect / NIP-47) provider — communicates over Nostr relays |
| `src/services/wallet/lnbits.ts` | LNbits provider — communicates over HTTPS REST API |
| `src/services/wallet/lnbits-provision.ts` | Auto-provisioning: creates a new LNbits wallet via `POST /api/provision` on a proxy server |
| `src/services/wallet/lnurl.ts` | LNURL-pay / Lightning Address resolution (LUD-16, LUD-06) |
| `src/domain/wallet/bolt11.ts` | BOLT11 invoice decoder |
| `src/services/wallet/payment-intents.ts` | At-most-once payment intent tracking across popup teardown |
| `src/services/wallet/index.ts` | Factory + per-account provider cache (`getWalletProvider`, `setWalletProvider`, `clearWalletProviders`) |

Provider instances are cached per account ID in a `Map<string, WalletProvider>`. The cache is cleared on vault lock via `clearWalletProviders()`. Both LNbits and NWC providers are created directly by the factory. For NWC, the factory validates connection key formats and injects the shared NIP-04 encryption and NIP-01 signing implementations. Recreating a provider after cache removal restores fresh connection key bytes from the saved configuration.

---

## 3. Manifest and Permissions

From `manifest.json` (MV3):

```json
{
    "manifest_version": 3,
    "permissions": ["storage", "activeTab", "alarms"],
    "background": {
        "scripts": ["background.ts"],
        "service_worker": "background.ts",
        "type": "module"
    },
    "content_scripts": [
        { "matches": ["<all_urls>"], "js": ["content.ts"], "run_at": "document_start" },
        { "matches": ["<all_urls>"], "js": ["inject.ts"], "run_at": "document_start", "world": "MAIN" }
    ],
    "web_accessible_resources": [{
        "resources": ["icons/icon-base.svg", "locales/en.json", "..."],
        "matches": ["<all_urls>"]
    }]
}
```

There is no `optional_permissions` key. `host_permissions` is empty and stays that way (see [Deployment](deployment.md) on why). `web_accessible_resources` names each locale file individually rather than a `locales/*.json` glob.

Firefox-specific settings (`browser_specific_settings`):
```json
{
    "gecko": {
        "id": "nostr-wot@dandelionlabs.io",
        "strict_min_version": "140.0",
        "data_collection_permissions": {
            "required": ["financialAndPaymentInfo", "personallyIdentifyingInfo"]
        }
    }
}
```

`data_collection_permissions` switches on Firefox's built-in data-consent install screen for the two categories the wallet and the profile/relay-list publishing actually transmit — see [Deployment](deployment.md) for the rejection that made this required and why the other categories are deliberately not declared.

### Permission Model

- **Required**: `storage` (browser.storage), `activeTab` (current tab access), `alarms` (the vault's MV3 service-worker keep-alive, see [Security](security.md)).
- **None requested at runtime**: there is no `optional_permissions` key and no runtime `permissions.request()` call. Up to 0.5.0, connecting a site additionally requested `*://<site>/*`; that request is gone (see [Security — Connecting a site](security.md#connecting-a-site)) because identity release is decided by the allowlist below, not by `permissions.contains`.
- **Per-domain**: The "Connect this site" card calls the `connectDomain` RPC (`addAllowedDomain` underneath), the only writer of the `allowedDomains` list in `browser.storage.local`.

---

## 4. Feature-owned types and module boundaries

Shared types live with their owning domain: `src/domain/nostr/types.ts` owns events,
`src/domain/accounts/types.ts` owns account records, `src/domain/vault/types.ts` owns
vault payloads, `src/domain/signing/types.ts` owns approval requests,
`src/domain/permissions/types.ts` owns permission decisions, and
`src/domain/wallet/types.ts` owns wallet contracts. Relay and language types live
in their respective domain directories. Configuration and protocol constants live in `src/constants/`, grouped by purpose.

`src/domain/` contains data contracts and pure feature rules. `src/services/`
contains background RPC handlers, signing orchestration, vault persistence,
relay connections/cache, wallet providers, browser operations, media upload and
localization. `src/utils/` contains domain-independent helpers such as the async
lock. `src/lib/` retains only cryptographic primitives and the shared browser
compatibility shim. Domain modules do not import services or browser APIs.
LNURL parsing and URL validation live in the wallet domain; fetching pay parameters
and invoices lives in the wallet service. There are no legacy re-export facades.

The main shared types are:

| Type | Purpose |
|------|---------|
| `UnsignedEvent` | Nostr event before signing: `{ kind, created_at, tags, content }` |
| `SignedEvent` | Nostr event with `id`, `pubkey`, `sig` |
| `Account` | Storage format: `{ id, name, type, pubkey, privkey, mnemonic, nip46Config, readOnly, createdAt, pqKeys? }` |
| `PqImportedKeys` | Externally generated post-quantum keys for an account that cannot derive: `{ profile, kem: { public, secret }, dsa: { public, secret }, importedAt }` |
| `SafeAccount` | Account without `privkey`, `mnemonic` or `pqKeys` (for public APIs) |
| `MemoryAccount` | In-memory format: replaces `privkey: string` with `privkeyBytes: Uint8Array`, `mnemonic: string` with `mnemonicBytes: Uint8Array`, and `pqKeys` with `pqPublic` + `pqKemSecretBytes` / `pqDsaSecretBytes` (all zeroable) |
| `MemoryVaultPayload` | `{ accounts: MemoryAccount[], activeAccountId: string \| null }` |
| `VaultPayload` | Storage/JSON format: `{ accounts: Account[], activeAccountId: string \| null }` |
| `PendingRequest` | Signer queue entry: `{ id, type, origin, accountId, timestamp, waitingForUnlock?, needsPermission?, nip46InFlight? }` |
| `RequestDecision` | `{ allow: boolean, remember?: boolean, rememberKind?: boolean, reason?: string }` |
| `PermissionDecision` | `'allow' \| 'deny' \| 'ask'` |
| `AccountType` | `'generated' \| 'nsec' \| 'npub' \| 'nip46' \| 'external'` |
| `WalletConfig` | Discriminated union: `{ type: 'nwc', connectionString }` or `{ type: 'lnbits', instanceUrl, adminKey }` |
| `WalletProvider` | Interface: `getInfo`, `getBalance`, `payInvoice`, `makeInvoice`, `connect`, `disconnect` |
| `SafeWalletInfo` | Wallet metadata without secrets: `{ type, connected, alias?, instanceUrl? }` |
| `SafeAccountWithWallet` | Account without `privkey`/`mnemonic` but with `walletConfig` (for background wallet handlers) |

### Shared record ownership

Activity storage and UI use `ActivityEntry` from `src/domain/activity/activity.ts`. The writer accepts its `ActivityLogInput` projection without a timestamp, and filtered clearing reuses `filterActivityEntries`. Mute lists, profile-read results and PQ status are declared in their domain modules and imported by background handlers. Display account/language shapes are projections of their canonical domain types. Only operational state and dependency-injection contracts remain local to services.

## Service module ownership

- `services/http/types.ts` owns the injectable `FetchFn` transport contract used by
  LNbits and LNURL services.
- `services/vault/vault.ts` owns the single private unlocked session, persistence,
  lock timers and startup gate. `encryption.ts` owns Web Crypto operations;
  `serialization.ts` converts stored accounts to/from zeroable in-memory bytes.
  `accountAccess.ts` and `importedKeys.ts` build operations using injected session,
  save and touch capabilities. The vault composes these operations once; factories
  read the live session on each call, never a captured unlocked payload.
- `services/signing/signer.ts` coordinates NIP-07 permission and account routing.
  `approvalQueue.ts` owns pending storage, resolvers, unlock waiters, remote tracking,
  cancellation and account-switch invalidation. `identity.ts` owns canonical identity
  reads and sharing cooldowns; `remoteSigner.ts` owns NIP-46 clients;
  `localDecryption.ts` owns classic/PQ local decryption and PQ key acquisition.
  Consumers import queue, identity, remote and decryption APIs from their owners.

Website permission keys and backward-compatible legacy hostname grants are specified in
[Website permission origins](origin-permissions.md).
