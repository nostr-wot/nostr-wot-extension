# Message Flow

## 1. Page-to-Background Round Trip

```
inject.ts (MAIN world)
  |  window.postMessage({ type: 'NIP07_REQUEST' | 'WEBLN_REQUEST', id, method, params })
  v
content.ts (ISOLATED world)
  |  1. Validate method against allowlist
  |  2. For NIP-07: enforce HTTPS, prefix method with 'nip07_', append origin
  |  2b. For WebLN: enforce HTTPS, prefix method with 'webln_', append origin
  |  3. Forward immediately over a persistent port with an internal request ID
  v
background.ts (service worker)
  |  1. Privilege gate (block privileged methods from content scripts)
  |  2. validateNip07Params (event shape, pubkey format)
  |  3. Domain gate: if not allowed & not dismissed → open popup, wait for connect
  |  4. handleRequest() -> switch on method -> return result
  v
content.ts
  |  window.postMessage({ type: 'NIP07_RESPONSE' | 'WEBLN_RESPONSE', id, result, error })
  v
inject.ts
     Promise resolves with result
```

---

## 2. NIP-07 Method Prefixing

When `content.ts` forwards a NIP-07 request, it transforms:
- `method: 'signEvent'` becomes `method: 'nip07_signEvent'`
- `params` gets `origin: window.location.origin` merged in (via object spread, no mutation)

This allows `background.ts` to distinguish page-origin NIP-07 calls from internal extension calls.

---

## 2b. WebLN Method Prefixing

When `content.ts` forwards a WebLN request, it transforms:
- `method: 'sendPayment'` becomes `method: 'webln_sendPayment'`
- `params` gets `origin: window.location.origin` merged in (via object spread, no mutation)

This allows `background.ts` to distinguish page-origin WebLN calls from internal extension calls. The same pattern is used for NIP-07 (see above).

---

## 3. Rate Limiting

Page requests share per-origin and global in-flight limits. NIP-07 and WebLN
also use their permission flows. Experimental WoT requests use the same resource
budget plus bounded batches, cached oracle queries and manual or explicitly enabled automatic local sync.


---

## 4. HTTPS Enforcement

NIP-07 and WebLN methods are blocked on `http:` origins, preventing key material from being exposed over insecure connections. Exceptions: `localhost`, `127.0.0.1`, and `[::1]` (local development). The check uses exact string matching -- `localhost.evil.com` is **not** exempted.

---

## 4b. NIP-07 Domain Connect Prompt

On the first NIP-07 request from an unknown domain, instead of silently rejecting, the background script opens the extension popup. The popup's home screen already shows a "Connect this site" card for unconnected domains. The NIP-07 request blocks until the user clicks Connect or a 2-minute timeout elapses.

| Domain state | Behavior |
|-------------|----------|
| Allowed | Request proceeds normally |
| Dismissed (previously denied) | Silent rejection ("Site not connected") |
| Unknown (first visit) | Popup opens showing "Connect this site" card, request waits |

If the user clicks Connect, the domain is added to `allowedDomains` and the blocked request proceeds. If the popup is closed or the timeout elapses, the request fails. Users can always manually connect dismissed domains later via the GlobeButton, which clears the dismissal.

---

## 4c. WebLN Domain Gating

WebLN methods are gated behind a **WebLN-specific consent list** (`weblnAllowedDomains`), separate from the NIP-07 domain allowlist. A site that is only NIP-07-connected (e.g. it called `getPublicKey`) cannot read the wallet — it must call `webln.enable()` first.

`webln_enable()` is the consent entry point: like NIP-07, calling it from an un-connected origin opens the "Connect this site" popup (only when the request comes from the active tab) and the background **waits for the user to click Connect** before resolving. The user's approval — not the handler — adds the domain to the allowlist; the `webln_enable` handler then records the origin in `weblnAllowedDomains`. WebLN access is therefore **never granted silently**; a page that calls `enable()` on page load cannot connect itself without a user click, and a previously dismissed origin is rejected without re-prompting. Every other WebLN method (`getInfo`, `getBalance`, `sendPayment`, `makeInvoice`) requires the origin to be in `weblnAllowedDomains` and never pops UI on its own. Disconnecting a site also revokes its WebLN consent. Individual sensitive methods still enforce their own permission prompts (e.g., `sendPayment` prompts the user before paying — see docs/wallet.md §7).

`webln_getInfo()` returns an empty `node.pubkey`: the Lightning-node id is not exposed, and the user's **Nostr identity pubkey is deliberately never returned here** — reading the identity goes through `nostr.getPublicKey()`, which is governed by the Connect consent and the per-site identity toggle (see docs/signer.md §2). Note that the Connect card is a single consent for both surfaces: an origin the user connected via `webln.enable()` is in `allowedDomains`, so a later `getPublicKey()` from it resolves without a second prompt.

---

## 5. Privileged Methods

Methods in `PRIVILEGED_METHODS` are gated to internal extension senders only. The check:

```ts
const isInternal = sender.id === browser.runtime.id &&
  (!sender.url || sender.url.startsWith(extensionBaseUrl));
```

This ensures the message comes from an extension page (popup, onboarding, prompt) and not from a content script running in a web page tab. This protects all vault, permission, and configuration methods.

---

## 5b. Post-Quantum Status (`pqc_getStatus`)

A privileged method (internal pages only, like `vault_*`). Returns whether the active
account can hold post-quantum keys and, when it can, the derived public keys plus an
unsigned `kind:10203` attestation for the popup to display and the user to publish.

Derived keys are not persisted. They are a deterministic function of the mnemonic already in the vault, so they are recomputed on each call rather than stored — no vault migration, and no extra secret material at rest. Secret key bytes are zeroed before the handler returns and are never included in the response.

The handler refuses derivation for four cases, each reported with a distinct `reason` so
the UI can explain it: `read-only` (watch-only account), `remote-signer` (NIP-46 has no
post-quantum operations), `no-seed` (imported from an nsec), and `short-seed` (a 12-word
mnemonic — 128 bits would be the weakest link).

The response also carries `source` (`'derived' | 'imported' | null`) and `canImport`.

### `pqc_importKeys` / `pqc_removeImportedKeys`

The `no-seed` and `short-seed` accounts hold a working secp256k1 key and simply have no mnemonic to derive from, so they may import an externally generated pair instead (`canImport: true`). `read-only` and `remote-signer` may not: the first can sign nothing and cannot take part in the hybrid key agreement, and the second routes nip44 to a bunker that knows nothing about our envelope, so imported keys would sit unused.

`pqc_importKeys({ keyfile })` parses and validates the key file (`parsePqKeyfile` — both pairs must prove themselves by round trip, not merely match a byte length), stores it in the encrypted vault, and returns the fresh `pqc_getStatus`. Unlike derived keys these ARE persisted, because there is nothing to recompute them from. Importing over an account that already has keys is refused; `pqc_removeImportedKeys` clears them first, zeroing the secrets. Both are privileged (internal pages only), like every other handler.

An imported account's attestation is tagged `origin: independent` and carries no `seed_strength` tag — the vocabulary `scripts/pqc-keygen.mjs` already uses, so a relay reader can tell the two provenances apart.

## 5c. Post-Quantum via NIP-44 (no new namespace)

Post-quantum encryption reuses `window.nostr.nip44` rather than adding a parallel
`nostr.pq` namespace. The two directions are treated differently on purpose:

**`decrypt` is polymorphic and takes no flag.** The envelope is self-describing — a
version byte and an algorithm byte — so `handleNip44Decrypt` inspects the payload with
`isPqEnvelope` and routes it. Existing callers are untouched and cannot get it wrong.
A test asserts classic NIP-44 payloads are never mistaken for envelopes, since a false
positive there would break ordinary traffic.

**`encrypt` requires an explicit opt-in:**

```js
window.nostr.nip44.encrypt(pubkey, plaintext, { scheme: 'pq', recipientKemKey })
```

Inferring here was rejected deliberately. The signer does not have the recipient's
ML-KEM key, so inferring would mean fetching their `kind:10203` attestation from relays
inside a signing call — network I/O with latency and a failure mode. When that lookup
failed the only options would be to break every existing caller or to fall back to
classic silently, and a silent downgrade is precisely what this scheme exists to
prevent. The calling application owns that decision and passes the key it already has.

`opts` is validated in `nip07-handlers.ts` rather than deeper in, because an ML-KEM key
is 1568 bytes (2092 base64 characters) and would fail the 64-hex checks those handlers
apply to other key material.

**A caller must be able to ask, not guess — `window.nostr.nip44.schemes`.**

```js
window.nostr.nip44.schemes  // ['nip44', 'pq']
```

Because post-quantum rides an optional third argument, a signer that supports it and one
that has never heard of it expose an identical shape. An unaware signer ignores the extra
argument and returns classic ciphertext, and a caller that assumed support would present
that as post-quantum. A silent downgrade dressed as protection is worse than no feature at
all, and it is the same failure the `encrypt` opt-in above exists to avoid — so support has
to be detectable, not inferable.

The marker is additive: existing callers that only read `encrypt` and `decrypt` are
untouched. A consumer checks `schemes.includes('pq')` and falls back to classic when it is
absent. Note the difference between an **absent** marker (an older signer — capability
unknown) and one advertising `['nip44']` only (a signer explicitly declaring it does not do
post-quantum). Both mean "do not send post-quantum", but only the second is an answer.

Post-quantum keys are recomputed from the vault's mnemonic per request and zeroed after
use; nothing extra is stored. Accounts without a 24-word seed are refused with an
explanation rather than silently downgraded.

**The marker is a property of the signer, not of the active account.** `schemes` is a
fixed array in `inject.ts`. Deriving it from the account would leak which kind of account
the user holds to any page that reads `window.nostr`, before any consent, and it would
change under a caller when the user switched accounts. So a request that correctly
detected `pq` can still be refused, and `activePqKeys` in `src/services/signing/signer.ts` names which of
the four reasons it hit so the client can tell the user what to change. Those messages
reach the page, but only after the user has approved the call.

**Remote-signer accounts are refused at the routing step, not in the crypto callback.**
`handleCryptoRequest` sends every NIP-46 account to the bunker and never reaches
`cryptoFn`, and a bunker answers `nip44Encrypt` with ordinary NIP-44 ciphertext. A
post-quantum request would therefore have come back classic, indistinguishable to the
caller: the silent downgrade the opt-in and the marker both exist to prevent. The
`remoteSignerUnsupported` parameter refuses it before delegation, after the permission
gate so an origin cannot use it to probe the account type. `tests/signer-pq-refusal.test.ts`
covers this, including that classic NIP-44 still routes to the bunker untouched.

The full wire formats and the reasoning behind them are written up as draft
specifications in [`nips/`](../nips/pqc/README.md).

## 6. Channel Isolation

The three message channels are strictly separated:
- **NIP-07 channel** (`NIP07_REQUEST`/`NIP07_RESPONSE`) -- can only access `NIP07_ALLOWED_METHODS`
- **WebLN channel** (`WEBLN_REQUEST`/`WEBLN_RESPONSE`) -- can only access `WEBLN_ALLOWED_METHODS`
- **Internal channel** (direct `browser.runtime.sendMessage`) -- can access privileged methods

A NIP-07 request cannot invoke WebLN methods and vice versa. Neither can invoke privileged methods.

The background enforces this independently of content.ts: the `browser.runtime.onConnect` port listener rejects any method that does not start with `nip07_` or `webln_` ("Permission denied"), so even a compromised or regressed content script can never reach `vault_`/`signer_`/`wallet_` privileged methods over the port channel.


### Mute editor reads

Home calls `getMyMuteList` for a cached summary. Opening Mutes calls
`getMyMuteList({ fresh: true })`; the handler waits for startup unlock, then reads
verified kind:10000 events for the active identity from the user's relays. A failed
read leaves editing unavailable with Retry. A successful read without an event
shows that no published list was found. Public edits round-trip `rawContent`
unchanged when the user explicitly publishes. An obsolete read after closing or
switching accounts cannot replace the current editor state.

## Activity content review

Successful NIP-04/NIP-44 operations retain ciphertext (up to 128 KiB per operation) with the peer and requesting account in local activity history. Encrypt inputs and decrypt results are never logged. Older operation-only records cannot be reconstructed. Existing signed-event snapshots retain their original content.

`activity_decrypt` is an internal extension RPC, privileged through the handler-map gate. It locates the exact stored entry, derives its protocol and peer, and calls `localDecryption.decryptForAccount` for the recorded account without switching the active account or modifying permissions. A missing peer may be supplied by the review form. NIP-04, classic NIP-44, and the existing PQ envelope decoder are reused. Gift-wrap kinds 1059/21059 verify the inner kind-13 seal before decrypting its second layer. Missing/local watch-only/remote keys produce an explicit error. The plaintext reply is never persisted.

Profile editing uploads selected avatar and cover files through the existing Blossom authentication and upload service before presenting its publish preview. Successful upload URLs remain cached only for that editing session; URL-only edits do not upload. Confirming still signs and publishes the merged kind:0 event, preserving metadata fields the editor does not own. Closing or switching accounts invalidates late upload UI replies.

## Relay cache refresh feedback

`cachedRelayRead` serves successful answers fetched within the last 60 seconds without opening sockets. Stale answers still return immediately while one deduplicated refresh runs in the background; cold reads await that same shared query. A refresh writes `fetchedAt` and notifies popup listeners. Their follow-up reads now consume the fresh cache rather than starting another query. There is no periodic timer: expiration permits the next requested read to refresh. Failed/unreachable reads never overwrite a successful answer. The mute editor’s explicit `{fresh: true}` read continues to bypass this cache.

Previously every cached read unconditionally refreshed. `useRelayCache` reacted to the resulting storage write with another RPC, forming a repeating cache-write → popup-read → relay-query loop affecting mute and post-quantum status.

### Published relay discovery

The privileged `getMyRelayList` RPC reads the selected public account from local storage after startup settles (with a legacy vault fallback) and queries kind 10002 on the configured plus default discovery relays. It reuses the finite `liveQuery` transport, verifies signatures and author/kind, and returns the newest event plus relay reachability. The popup offers explicit application of the published read/write configuration; reading never overwrites local settings. No periodic polling or storage-triggered refresh is added.

NIP-65 and PQ publication discovery share `readPublishedEvent`: consume all relay replies, verify author/kind/signature, select the newest replaceable event and retain the signed event locally. Socket exhaustion without EOSE is unreachable, not proof of no publication. Public relay-list discovery works with a locked vault. PQ publication checks compare both KEM and DSA keys. The `pqcPublishedV2` cache drops legacy negative answers produced by exhaustion; acknowledged publication seeds a fresh positive answer and prevents an older in-flight refresh overwriting it.

### Profile display query coalescing

`getProfileMetadata` shares an in-flight kind:0 read per pubkey. Missing profiles and unavailable relay results have a 60-second, bounded in-memory cooldown, preventing repeated display reads from opening all configured relays on every call. Positive profiles still use the existing persistent profile cache. The fresh `getProfileForMerge` path bypasses the display cooldown so editing never treats an unavailable read as proof that a profile is empty. The cooldown does not schedule polling: a later caller initiates the next read.

### Relay publication and recovery

`publishRelayList` uses the UI’s configuration snapshot, or the same default-aware storage parser as `RelaysContext` for older callers. It refuses an empty set of NIP-65 tags before signing, waits for startup unlock, and retains the signed event and publication timestamp only after a relay acknowledgement. `getMyRelayList` uses the same first-account fallback as the popup when no selection was persisted. Configuration edits are serialized and save the previous nonempty list plus flags under `relayConfigurationBackup`; restoring a list does not publish it automatically.

Wallet presence and balance/history reads wait for startup unlock. `wallet_hasConfig` rejects a locked vault instead of returning false. Successful reads persist account-specific display snapshots; popup hydration precedes RPC refresh. Local cache notifications are passive and only apply explicit disconnects, preventing a write/read/network feedback loop. Disconnect/replacement and account/vault removal invalidate older cache writes.

Wallet settings reads (threshold, NWC URI, Lightning Address) wait for the startup unlock gate. The popup loads independent fields through WalletContext on first settings access, retains them across panel navigation, and explicitly refreshes on request; HTTP lookup failures remain errors.

The in-popup approval queue is account-wide, grouping all origins for the selected account by website and permission with readable event kinds. Opening a group displays all pending items with expandable details and shared decisions. New arrivals update the list through existing queue notifications. “Approve once” / “Approve all” resolves a captured set of displayed IDs concurrently without remembering permission, waits for all responses and refreshes after partial failures. A separate “Always allow” action saves the origin/kind permission for future requests and explains that scope. Single/batch background resolution denies foreign identities, and signEvent checks claimed authors and account continuity before crypto.

The content bridge multiplexes concurrent NIP-07/WebLN calls on one port per channel. The background echoes each internal request ID on success and failure; the bridge maps it back to the page request ID. Replies may finish out of order. Calls are not held behind an earlier approval, so all received requests can reach the approval list together. Disconnect rejects every outstanding call; no signing or payment request is automatically replayed. After updating this bridge, reload existing website tabs as well as the extension to replace their injected content scripts.

Automatic popup opening first checks for an existing popup context (runtime.getContexts, or extension.getViews on older browsers). Incoming requests update the open approval UI without reopening the native popup. The originating-tab check still applies and popup context metadata is refreshed.

### WebLN capability and invoice compatibility

`webln_getInfo` translates backend method grants into WebLN method names instead
of advertising all operations unconditionally. The injected `makeInvoice`
normalizes numeric, string and object arguments to a validated fixed amount;
the background repeats amount validation before invoking the wallet provider.

The popup’s existing `wallet_resolveLightningAddress` and
`wallet_payToLightningAddress` RPCs also accept bech32 LNURLs and
`lightning:LNURL…` links. They reuse pay-parameter validation, amount checks and
payment-intent deduplication. No additional page-facing payment API is exposed.

### Page API timeout constants

NIP-07 and WebLN page calls use their respective constants in
`src/constants/signing.ts`. Vite inlines these values into `inject.ts` at build
time, preserving a synchronous, self-contained MAIN-world script without runtime
imports. The packaged-script test verifies both timeout delays and rejection.

### Signer implementation boundaries

The NIP-07 RPC handlers call `signer.ts` for permission-gated operations.
Approval resolution, unlock waiters and account-switch rejection are owned by
`services/signing/approvalQueue.ts`; identity lookup/cooldowns by `identity.ts`.
Remote work is tracked by the queue and delegated to `remoteSigner.ts`.
Internal activity review imports `decryptForAccount` from `localDecryption.ts`.
The wire method names and request/response formats are unchanged.

Account removal is authoritative in vault_removeAccount: private accounts require an unlocked vault; watch-only accounts can be removed while locked. The handler updates local accounts and the synced active public key. UI failures remain visible without performing a second independent storage deletion.


onboarding_generateSubAccount accepts an optional derivationPath. It prefers the
active generated account's seed, otherwise the first stored seed. Omitted paths
use the next index in the existing sequence. Custom paths are validated and
canonicalized before BIP-32 derivation; existing public keys are rejected.
Only a public preview, recovery path and seed account name are returned. The
private key and mnemonic remain in pending onboarding storage until addToVault.
The saved account and local public projection retain the canonical recovery path.

The addToVault request accepts an optional name override, trimmed and limited to
100 characters. Blank names retain the generated name. Keys and derivation paths
come from the pending background account, never from the name override.

Account switching commits the background identity and refreshes the active website
because many clients cache their own selected account and ignore account-change
notifications. It also invalidates old-account approvals and broadcasts the existing
nostr:accountChanged event only to connected, identity-enabled sites.

A signEvent with an explicit author different from the extension's selected public
key is rejected before permissions, prompting, or signing (including remote signers).
It writes a bounded unread metadata summary to local signerRejections: ID, time,
origin, kind, requested/active public keys and reason. No content, tags or private
keys are copied into this summary. The latest 100 summaries survive popup and
service-worker restarts. A storage failure never permits the signature.
signer_getRejections and signer_acknowledgeRejections are internal extension-only
RPCs. Acknowledgement removes only displayed IDs, preserving concurrent arrivals.
Unread rejection count has red badge priority over the yellow pending count; all
badge writes reread current storage in one serialized writer. Queue cleanup does
not erase unread rejection notices. Rejections alone never open the native popup.

NIP-04/NIP-44 pubkey parameters identify the peer, not a claimed local account.
They cannot be used to infer a foreign-account mismatch. Unsigned events without
an author likewise do not disclose which identity the website has selected.

Account-switch reloads first send `NOSTR_RELOAD_PAGE` to the active tab's top-frame
content script. Only a same-extension sender with an extension-page URL is accepted.
The bridge acknowledges before scheduling `location.reload()`, so navigation does
not discard the acknowledgement. Missing bridges or acknowledgements fall back to
`tabs.reload`.
This routing is under native Chrome popup-lifetime investigation; passing bridge
and React tests does not establish that the browser preserves its action popup.

Before triggering an account-switch reload, the popup awaits the privileged
`scheduleAccountSwitchPopupRecovery` RPC. On Chrome, the background arms one
100 ms timer so losing the originating popup does not cancel recovery. The attempt
only runs if the original tab is still active in its focused browser window;
a newer request replaces the pending timer. It calls `action.openPopup` once and
leaves an existing native popup to Chrome's own guard. It does not use context
existence as a visibility test, close a popup, focus a window, or retry a refusal.
Recovery errors do not block the website refresh. Chrome may still refuse if it
considers a hidden popup active. Temporary popup tracing and its Settings controls
have been removed; startup clears the old session trace.

### Audit remediation: request lifetime boundaries

Page methods share a 64-per-origin / 256-global in-flight budget across the port and
runtime transports. Reservations survive port disconnect until work actually settles.
Queue limits include unlock and remote in-flight entries, while actionable prompts
retain their separate five-per-origin limit. Vault locking revokes pending approvals
and unlock waiters and invalidates setup continuations. Remote cancellation suppresses
local delivery; it does not recall a request already sent to a bunker.

Signing/decryption and wallet handlers bind continuations to an account and vault
revision. They validate that capability immediately before secret use or payment
dispatch; crypto results are checked again before release. Switching back to the same
account cannot revive the earlier request. Payment permission reads/writes and the
threshold all use the captured account, including account-specific deny rules.

Wallet snapshots are read through the internal `wallet_readDisplayCache` RPC. Only background code decrypts the cache; while locked, it returns provider presence without financial fields. Activity reads require unlock. See [private-cache.md](private-cache.md).


## Experimental WoT channel (0.8.0)

`WOT_REQUEST` / `WOT_RESPONSE` uses the same persistent-port bridge as NIP-07,
with an explicit method allowlist and `wot_` prefix. Background listeners derive
the origin from the browser sender and enforce HTTPS, feature opt-in, site
connection and identity consent. `experimentalWot_*` configuration/sync RPCs are
privileged and cannot cross the page port. A storage-driven availability message
adds/removes `window.nostr.wot`; spoofing that page notification cannot grant
background access. See [WoT](wot.md).

The privileged `experimentalWot_getTrustScore` RPC serves the menu's public-key
lookup through `queryWot('getTrustScore', ...)`, preserving opt-in, account context,
saved query mode and mute/scoring rules. It does not route through website approval
because its callers are trusted extension pages. Page access remains unchanged.

The popup-only `experimentalWot_getScoreExplanation` RPC reuses the WoT query
context, traversal and final account/settings/mute revision checks. Its mute
counts and local snapshot diagnostics are not part of the page API; the website
handler explicitly rejects `wot_getScoreExplanation`.

Internal WoT sync/clear handlers accept an optional accountId to operate on a
database row without changing the active identity. Sync resolves it against
saved accounts, retaining generation-based cancellation. Clear removes only
the prefixed WoT snapshot. The internal clearCache RPC removes the public-list
store independently of account snapshots. Neither delete operation runs during
an active crawl.

The proposed public contract is documented in [nips/wot](../nips/wot/README.md). Pending approvals expose per-group remembered actions in compact menus; choosing one resolves and saves only that origin/permission group, preserving the existing account/global scope.

### Empty/singleton follow-list replacement guard

`handleSignEvent` checks kind:3 empty/singleton replacements before local signing or
remote dispatch. A known reduction from multiple follows attaches
`followReplacementCount` to the normal pending approval. `ApprovalOverlay` reuses
`ConfirmDialog` for a danger notice showing origin and old/new counts. Approving
that dialog sends `confirmFollowReplacement` only for those displayed IDs.
`resolveRequest` refuses an unconfirmed approval; `resolveBatch` leaves dangerous
requests pending even when an allow permission is remembered.

Follow replacement checks also consult the author’s versioned public follow list in the WoT sync database, respecting newer signed changes. Event details show detected dangerous reductions before approval and reuse the shared split buttons, with Always choices behind the arrows.

Empty kind:3 lists (including client-only tags) require confirmation when any previous follows are known. Warnings display both the previous and proposed counts, including zero. Tests cover local and remote accounts, ordinary/batch approval bypasses, and clearing the last follow.

The pending-request cards and event details share `FollowReplacementNotice`; identical reductions within a group and in the second confirmation are shown once, while every displayed request ID remains individually confirmed. Clicking Approve or Always allow still opens the separate danger confirmation, and Cancel sends no approval.

Wallet receipt feedback: after a successful WebLN provider response the background
stores an encrypted account-scoped receipt. The popup observes that storage key,
reads through `wallet_getPaymentNotices`, and acknowledges exact IDs through
`wallet_acknowledgePaymentNotices`. Both are extension-only RPCs and require the
current unlocked account. Approval queue removal itself never signals payment
success. Receipt persistence failure leaves the successful WebLN reply unchanged.
