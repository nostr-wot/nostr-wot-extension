# Wallet -- Lightning Payments & Zaps

## 1. Overview

The extension includes a built-in Lightning wallet that exposes `window.webln` for web applications. Nostr clients that support WebLN (Primal, Coracle, Snort, etc.) can use it directly for zaps (NIP-57).

Two wallet backends are supported behind a unified `WalletProvider` interface:

| Provider | Transport | Use case |
|----------|-----------|----------|
| **NWC** (NIP-47) | Nostr relays | Connect an existing wallet via `nostr+walletconnect://` URI |
| **LNbits** | HTTPS REST API | Auto-provision or connect a custodial LNbits wallet |

---

## 2. Architecture

```
Nostr client (window.webln.sendPayment)
  |
inject.ts  ──>  WEBLN_REQUEST { method, params }
  |
content.ts ──>  validate allowlist + prefix 'webln_' + append origin
  |
background.ts  ──>  permission check → provider dispatch
  |
WalletProvider interface
  ├── NwcProvider   (NIP-47 over Nostr relays)
  └── LnbitsProvider (REST API over HTTPS)
```

This mirrors the NIP-07 signer flow: inject.ts exposes the API, content.ts bridges and validates, background.ts dispatches to the provider.

---

## 3. File Structure

```
lib/wallet/
  types.ts              # WalletConfig, WalletProvider, Transaction, SafeWalletInfo
  index.ts              # Factory + per-account provider cache
  nwc.ts                # NWC (NIP-47) provider
  lnbits.ts             # LNbits REST provider
  lnbits-provision.ts   # Auto-provisioning via challenge-response
  bolt11.ts             # BOLT11 invoice decoder
  lnurl.ts              # LNURL-pay / Lightning Address resolution (LUD-16, LUD-06)

src/popup/components/
  Wallet/
    Wallet.tsx           # Composition: balance card, action row, which dialog is open
    WalletSetup.tsx      # Setup flow (Quick Setup / NWC / LNbits tabs)
    WalletSection.tsx    # Menu entry point; decides setup vs connected
    DepositDialog.tsx    # Create an invoice, show the QR, poll for payment
    SendDialog.tsx       # Pay an invoice or a Lightning Address
    TransactionList.tsx  # Search, filter button, rows, "show more"
    TxFilterDialog.tsx   # Direction + date-range form
    WalletSettings.tsx   # Connection, auto-approve threshold, Lightning Address

src/shared/               # the decision logic, unit-tested without a browser
  txFilter.ts             # what matches the filter bar; the memo placeholder rule
  invoiceExpiry.ts        # how long an invoice has left
  sendTarget.ts           # the single answer to "what would Pay send?"

tests/wallet/
  nwc.test.ts            # NWC provider tests
  lnbits.test.ts         # LNbits provider tests
  lnbits-provision.test.ts # Auto-provisioning tests
  bolt11.test.ts         # BOLT11 decoder tests
  lnurl.test.ts          # Lightning Address / LNURL-pay tests
  background-handlers.test.ts # Background RPC handler tests
  permissions.test.ts    # Wallet permission tests
  approval.test.ts       # Payment approval flow tests
  types.test.ts          # Type guard tests
  index.test.ts          # Factory/cache tests
```

---

## 4. WalletProvider Interface

```typescript
interface WalletProvider {
  readonly type: 'nwc' | 'lnbits';
  getInfo(): Promise<{ alias?: string; methods: string[] }>;
  getBalance(): Promise<{ balance: number }>;
  payInvoice(bolt11: string): Promise<{ preimage: string }>;
  makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }>;
  listTransactions(limit?: number, offset?: number): Promise<Transaction[]>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}
```

### 4.1 NWC Provider (`nwc.ts`)

- Parses `nostr+walletconnect://` connection string (pubkey + relay + secret)
- Communicates via NIP-47 encrypted events over Nostr relays
- Amounts: the `WalletProvider` interface is denominated in **sats**; NIP-47 wire
  amounts are millisatoshis — `make_invoice` multiplies by 1000, responses
  (`get_balance`, `lookup_invoice`, `list_transactions`) divide by 1000
- Responses (kind 23195) are trusted only if the pubkey matches the wallet
  service, the signature verifies (`verifyEvent`), and the content decrypts;
  the pending request is only consumed by such a response (see
  `docs/security.md` §13)
- Crypto dependencies injected at runtime (cannot be constructed by the factory directly)
- Created externally via `createNwcProvider()`, then registered with `setWalletProvider()`

### 4.2 LNbits Provider (`lnbits.ts`)

- Connects to a configurable LNbits instance URL
- REST API with admin key in `X-Api-Key` header
- HTTPS-only: requests throw for any non-`https://` instance URL except
  `http://localhost` / `http://127.0.0.1` (see `docs/security.md` §15)
- Endpoints: `GET /api/v1/wallet` (balance), `POST /api/v1/payments` (pay/create invoice), `GET /api/v1/payments` (transactions)

### 4.3 Provider Factory (`index.ts`)

Per-account provider cache (`Map<string, WalletProvider>`):
- `getWalletProvider(accountId, config)` — returns cached or creates new
- `setWalletProvider(accountId, provider)` — cache an externally-created provider (NWC)
- `removeWalletProvider(accountId)` — disconnect and remove
- `clearWalletProviders()` — disconnect all, called on vault lock

---

## 5. Auto-Provisioning

Users can instantly provision a wallet via "Quick Setup" without manual key entry.

### Flow

```
User clicks "Create Wallet"
  → GET  {server}/api/provision/challenge     → { challenge }
  → Sign challenge as NIP-98 kind:27235 event
  → POST {server}/api/provision               → { adminkey, id, nwcUri? }
  → Store as LNbits config in vault
  → Initialize provider
```

- Default server: `https://zaps.nostr-wot.com`
- Users can override the server URL in an "Advanced" section
- Wallet name includes npub prefix (`WoT:npub1abc...`) for admin recovery
- Authentication via signed Nostr event — no registration required

### File

`lib/wallet/lnbits-provision.ts` — `provisionLnbitsWallet(instanceUrl, walletName, signFn)`

### 5.2 Lightning Address Claiming

After provisioning, users can claim a Lightning Address (`username@zaps.nostr-wot.com`) that creates an lnurlp pay link for receiving payments.

```
User enters desired username
  → GET  {server}/api/provision/challenge     → { challenge }
  → Sign challenge as NIP-98 kind:27235 event
  → POST {server}/api/claim-username          → { address, payLinkId }
  → Prompt to update profile lud16 field
```

Server endpoints:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/claim-username` | POST | NIP-98 | Claim a username, creates lnurlp pay link |
| `/api/lightning-address` | GET | None | Look up address by pubkey |
| `/api/release-username` | POST | NIP-98 | Delete pay link, release username |

Username validation: `^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$` (3-30 chars). Reserved names blocked.

Client functions in `lib/wallet/lnbits-provision.ts`:
- `claimLightningAddress(instanceUrl, username, signFn)`
- `getLightningAddress(instanceUrl, pubkey)`
- `releaseLightningAddress(instanceUrl, signFn)`

#### Adding the address to the profile never overwrites what it could not read

`kind:0` is **replaceable**: publishing one replaces the user's profile outright.
So the "Add to profile" prompt reads the current profile, merges `lud16` into it,
and publishes the result — which makes that read load-bearing rather than a
nicety. Merging into the result of a *failed* read publishes a document
containing only `lud16`, and the name, picture, about and nip05 are gone.
Silently, and worst on exactly the flaky-relay day that caused it.

`fetchKind0` could not express the difference: it returned `null` both for "this
user has no profile" and for "every relay timed out". `fetchKind0Read` returns
`{ metadata, reachable }`, where `reachable` is true only if at least one relay
actually answered — delivered the event, or reached EOSE, which is a relay
stating it holds no `kind:0`. The `getProfileForMerge` handler exposes that
uncached (a stale cache could drop a field changed elsewhere), and the popup
refuses to publish when `reachable` is false, saying so instead of closing the
dialog as though it had worked.

### 5.3 Paying a Lightning Address (`lnurl.ts`)

The Send flow accepts a Lightning Address (`name@domain`) in the same field as
a BOLT11 invoice. Resolution is LUD-16 → LUD-06:

```
User pastes name@domain
  → GET  https://{domain}/.well-known/lnurlp/{name}  → pay params
  → Popup shows domain, description, min/max, comment field
  → GET  {callback}?amount={msats}&comment={text}     → { pr: <bolt11> }
  → Decode the invoice, check its amount == the approved amount
  → provider.payInvoice(bolt11)
```

Both hops are attacker-influenced — the user pastes the address, the *server*
picks the callback — so `lib/wallet/lnurl.ts` constrains every one of them
(see [Security §17](security.md#17-lnurl-pay-hardening-libwalletlnurlts)):

| Guard | Why |
|-------|-----|
| HTTPS only, on both the well-known URL and the callback | No cleartext, no downgrade |
| No loopback / private / link-local / IP-literal hosts | A pasted "address" must not probe the LAN |
| Amount clamped to `[minSendable, maxSendable]` before any request | Endpoint's own stated limits |
| Returned invoice decoded and its amount compared to the approved amount | The server must not set the price |
| Amountless invoices refused | Same reason |
| Comment truncated to `commentAllowed` (itself capped at 1000) | LUD-12 |
| Redirects refused rather than followed | The guard vouches for the URL requested, not for wherever a `302` points |
| 15s timeout on every request | An endpoint that stops answering must not hold the worker open |
| 64 KB response cap, enforced while reading; LUD-06 `status: "ERROR"` surfaced verbatim | Bounded, legible failures |

Exports:
- `parseLightningAddress(input)` / `isLightningAddress(input)` — parse/detect; never throws
- `lightningAddressToLnurlpUrl(address)` — the LUD-16 well-known URL
- `assertPublicHttpsUrl(url)` — the guard above; returns the parsed `URL`
- `fetchPayParams(address, fetchFn?)` — validated `LnurlPayParams`
- `requestInvoice(params, amountSats, comment?, fetchFn?)` — amount-verified `{ bolt11, amountSats }`

Note: this runs in the background service worker with no host permission for
arbitrary domains, so the LNURL server must serve permissive CORS (nearly all
do). A server that does not is reported as "could not reach the endpoint".

`wallet_payToLightningAddress` re-resolves the address instead of trusting a
callback URL passed back from the popup, and the resolve handler never returns
the callback — the endpoint the user saw is the endpoint that gets paid.

#### At most once per click (`payment-intents.ts`)

`rpc()` retries up to three times when the message port closes without a reply,
because an MV3 worker that was asleep and a worker that ran the handler and then
died look identical from the popup. Re-running most handlers is harmless. This
one is not: it asks the endpoint for a **fresh invoice** on every call, so the
retry carries a different payment hash and the node has no way to recognise it
as a duplicate — it simply pays again. (`wallet_payInvoice` needs no such guard;
the same bolt11 carries the same payment hash, and the node refuses it itself.)

So the popup stamps one `intentId` per click and `runPaymentOnce` records it in
`storage.session` — not in a module variable, since the point is to survive the
very teardown that causes the retry. A replay of a completed intent returns the
first result; a replay while the first is still in flight is refused; a payment
that *threw* clears its record, because `rpc()` does not retry application
errors and the user is the one deciding whether to try again.

**Claiming an intent is serialized** through the same `AsyncLock` that
`lib/signer.ts` and `lib/permissions.ts` use for their session-storage maps.
Read-modify-write on one key is not atomic, and the guard cannot itself be racy:
two claims that both read before either writes each store back a map missing the
other's record, and once an in-flight marker is gone a retry finds nothing and
sends a second invoice — the precise failure the module exists to prevent.

**In-flight records are not pruned on the completed-record TTL.** Completed
intents expire after 10 minutes; a record still marked in-flight is kept for 24
hours. Dropping one on the short timer would re-arm the double payment it was
written to stop. Intent ids are per-click UUIDs, so a stranded marker blocks
nothing — the long bound exists only so the leak cannot grow without limit.

Errors that cross back to the popup are **stable codes**, not sentences
(`PAYMENT_IN_FLIGHT`, in `lib/wallet/types.ts` — the one wallet module that
imports nothing, so the popup can recognise it without pulling the background's
storage shim into its bundle). A sentence thrown in the background is an English
sentence in all six locales.

Two limits worth stating. The residual risk is the one every Lightning wallet
has: a payment that failed after the sats left cannot be told apart from one that
never left. And this covers the *machine* retry only — a popup destroyed by the
user switching to a wallet app takes its `intentId` with it, so clicking Pay
again after reopening is a new intent and a second payment. Closing that needs a
background in-flight record keyed by payment hash and surfaced when the wallet
mounts; see `docs/frontend-remediation-round-2.md` R3.

---

## 6. WebLN API

Injected as `window.webln` in inject.ts:

```typescript
window.webln = {
  enabled: false,
  enable(): Promise<void>,               // opens the Connect popup; resolves only after the user approves
  getInfo(): Promise<{ node: { alias: string; pubkey: string } }>,  // pubkey is always "" — the Nostr identity is never exposed here
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>,
  makeInvoice(args: { amount: number; defaultMemo?: string }): Promise<{ paymentRequest: string }>,
  getBalance(): Promise<{ balance: number }>,
};
```

Fires `CustomEvent('webln-ready')` on `window` after injection.

### Message Channel

| Direction | Type |
|-----------|------|
| Page → Content | `WEBLN_REQUEST` |
| Content → Page | `WEBLN_RESPONSE` |

Allowed methods: `enable`, `getInfo`, `sendPayment`, `makeInvoice`, `getBalance`

HTTPS enforcement and rate limiting apply (same rules as NIP-07).

---

## 7. Permission Model

### 7.1 WebLN Permissions

Same structure as NIP-07, stored per-domain per-account:

```json
{
  "primal.net": {
    "_default": {
      "webln:sendPayment": "ask",
      "webln:makeInvoice": "allow",
      "webln:getBalance": "allow"
    }
  }
}
```

### 7.2 WebLN Consent (`weblnAllowedDomains`)

WebLN access is a **separate consent** from the NIP-07 connect. A site that is
merely NIP-07-connected (e.g. via `getPublicKey`) cannot see the wallet at all.

- Stored in `browser.storage.local` at key `weblnAllowedDomains` (list of
  origins), managed by `lib/bg/domain-handlers.ts`
  (`getWeblnAllowedDomains` / `addWeblnAllowedDomain` / `isWeblnAllowed` /
  `removeWeblnAllowedDomain`).
- Recorded by the `webln_enable` handler after the user approves the
  "Connect this site" card for that origin.
- Every other `webln_*` method (`getInfo`, `getBalance`, `sendPayment`,
  `makeInvoice`) is gated on this list in `background.ts` — a site that never
  called `enable()` gets "Site not connected".
- Disconnecting a site (`removeAllowedDomain`) also revokes its WebLN consent,
  so a re-connected site must call `enable()` again.

### 7.3 Auto-Approve Threshold

Per-account setting stored in `browser.storage.local` at key `walletThreshold_{accountId}`.

A `sendPayment` is auto-approved **without a prompt only when ALL of these
hold**:

- the BOLT11 invoice amount decoded successfully and is greater than `0`, AND
- a threshold is set (`> 0`), AND
- the invoice amount is at or below the threshold.

The cap applies **regardless of a remembered "allow"**: a saved `'allow'`
permission means "don't ask again for amounts within my threshold", never
"unlimited". In every other case the interactive approval prompt is required,
even when the saved permission is `'allow'`:

- amount above the threshold,
- no threshold set (default `0` = always prompt),
- the invoice amount could not be decoded (unknown/zero amount).

Net effect: a site can never drain the wallet from a remembered allow —
amounts above the threshold and undecodable amounts always prompt.

### 7.4 Payment Approval

Extends the existing signer prompt system:
- `sendPayment` requests go through permission check (`deny` rejects outright)
- Unless auto-approved within the threshold (7.3), a prompt is queued via `signer.queueRequest()` with type `webln_sendPayment`
- User sees amount, domain, and can approve/deny with optional "remember" checkbox
- "Remember" saves `'allow'`, which only enables threshold-capped auto-approval (see 7.3)

---

## 8. Background Handlers

### Privileged (extension pages only)

| Method | Purpose |
|--------|---------|
| `wallet_getInfo` | Get wallet type, connection status |
| `wallet_getBalance` | Get current balance |
| `wallet_connect` | Store wallet config in vault, init provider |
| `wallet_disconnect` | Remove wallet config, destroy provider |
| `wallet_setAutoApproveThreshold` | Set auto-approve threshold (sats) |
| `wallet_getAutoApproveThreshold` | Get current threshold |
| `wallet_makeInvoice` | Generate receive invoice |
| `wallet_payInvoice` | Pay a BOLT11 invoice |
| `wallet_getTransactions` | List transactions (paginated) |
| `wallet_getNwcUri` | Get NWC connection URI (if available) |
| `wallet_hasConfig` | Check if wallet is configured |
| `wallet_provision` | Auto-provision a new LNbits wallet |
| `wallet_resolveLightningAddress` | Resolve a Lightning Address to pay params (min/max sats, description, comment limit) |
| `wallet_payToLightningAddress` | Resolve, request an amount-verified invoice, and pay it |
| `wallet_claimLightningAddress` | Claim a Lightning Address username |
| `wallet_getLightningAddress` | Look up current Lightning Address |
| `wallet_releaseLightningAddress` | Release a claimed Lightning Address |

### Non-privileged (from web pages via content.ts)

| Method | Purpose |
|--------|---------|
| `webln_enable` | Activate WebLN for the requesting page |
| `webln_sendPayment` | Pay a BOLT11 invoice (goes through permission/approval) |
| `webln_makeInvoice` | Request invoice generation |
| `webln_getBalance` | Get balance |
| `webln_getInfo` | Get wallet info |

---

## 9. BOLT11 Invoice Decoder

`lib/wallet/bolt11.ts` provides lightweight BOLT11 invoice decoding using the existing bech32 infrastructure:

```typescript
interface DecodedInvoice {
  amountSats: number | null;
  description: string | null;
  expiry: number;           // seconds, default 3600
  paymentHash: string | null;
  network: string;          // 'bc' (mainnet), 'tb' (testnet), 'bcrt' (regtest)
  timestamp: number;
}

decodeBolt11(invoice: string): DecodedInvoice | null
```

Used in the Send modal to preview invoice details (amount, description, expiry) before payment.

---

## 10. Wallet Configuration Storage

Wallet credentials (`WalletConfig`) are stored inside the `Account` object in the encrypted vault — same AES-256-GCM + PBKDF2 protection as private keys:

```typescript
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string; nwcUri?: string };
```

See [Storage](storage.md#9-wallet-storage) and [Security](security.md#8-wallet-security) for details.

---

## 11. UI Structure

### Home Screen (HomeTab)

- **Wallet exists**: Shows a balance card at the top with sats amount. Clicking opens the wallet section in the menu.
- **No wallet**: Shows a setup banner inviting the user to create/link a wallet. Only appears after profile suggestion and sync reminder banners are resolved. Dismissible per account.

### Wallet Section (Menu → Wallet)

**Setup flow** (`WalletSetup.tsx`):
- Three tabs: Quick Setup / NWC / LNbits
- Quick Setup: one-click provisioning with optional advanced URL override
- NWC: paste `nostr+walletconnect://` URI
- LNbits: enter instance URL + admin key

**Connected wallet** (`Wallet.tsx`) is composition only — balance, the two action buttons, and which child is open. Each surface owns its own state, so closing one *is* its reset; the parent used to clear eight fields by hand per dialog.

- **Balance card** with gear icon for settings
- **Deposit** (`DepositDialog.tsx`) — amount → invoice + QR → paid, polling every 2s and auto-closing 2.5s after payment lands. The amount is stored *with* the invoice rather than read back from the form, which the old version did through a stale closure that only worked because the field was unreachable by then.
- **Send** (`SendDialog.tsx`) takes either a BOLT11 invoice or a Lightning Address. An address is detected as it is typed, resolved (debounced 400 ms) via `wallet_resolveLightningAddress`, and shown as destination + description + accepted range, with amount and — where the endpoint allows it — comment fields. Pay stays disabled until the amount is inside the range. The backdrop stops dismissing while a payment is in flight.
- **Transaction list** (`TransactionList.tsx`) with search and pagination; the filter form is `TxFilterDialog.tsx`.
- **Settings** (`WalletSettings.tsx`) is an `OverlayPanel`: provider info + disconnect, NWC URI copy, auto-approve threshold, Lightning Address claim/view (LNbits only). Its three RPCs fire when it opens, not on every wallet open.

All of these are the shared `Modal`. Nothing portals to `#root` any more — that was a workaround for a containing-block bug fixed in `c01f087`, and it put wallet dialogs above the lock screen and the approval sheet. See `docs/component-standards.md` §4.

### NIP-57 Zap Flow

The extension provides primitives; the Nostr client orchestrates:

```
Client: user clicks "Zap 1000 sats"
  1. Client looks up recipient's lud16
  2. Client queries LNURL → pay params
  3. Client builds kind:9734 zap request
  ──> window.nostr.signEvent(zapRequest)     → Extension signs it
  4. Client sends zap request to LNURL endpoint → bolt11 invoice
  ──> window.webln.sendPayment(bolt11)       → Extension pays it
  5. Recipient's service publishes kind:9735 receipt
```
