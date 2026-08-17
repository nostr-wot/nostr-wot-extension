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
  |  3. Forward over a persistent port (browser.runtime.connect)
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
- `params` gets `origin: window.location.hostname` merged in (via object spread, no mutation)

This allows `background.ts` to distinguish page-origin NIP-07 calls from internal extension calls.

---

## 2b. WebLN Method Prefixing

When `content.ts` forwards a WebLN request, it transforms:
- `method: 'sendPayment'` becomes `method: 'webln_sendPayment'`
- `params` gets `origin: window.location.hostname` merged in (via object spread, no mutation)

This allows `background.ts` to distinguish page-origin WebLN calls from internal extension calls. The same pattern is used for NIP-07 (see above).

---

## 3. Rate Limiting

There is no request rate limiting. The only rate-limited methods were the
removed trust-graph computations (page-facing relay-query channel + background
`checkRateLimit`), all of which have been deleted. NIP-07 and WebLN methods are
gated by the user-facing permission system (per-domain connect + per-method
approval prompts) instead.

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

Nothing is persisted. Post-quantum keys are a deterministic function of the mnemonic
already in the vault, so they are recomputed on each call rather than stored — no vault
migration, and no extra secret material at rest. Secret key bytes are zeroed before the
handler returns and are never included in the response.

The handler refuses derivation for four cases, each reported with a distinct `reason` so
the UI can explain it: `read-only` (watch-only account), `remote-signer` (NIP-46 has no
post-quantum operations), `no-seed` (imported from an nsec), and `short-seed` (a 12-word
mnemonic — 128 bits would be the weakest link).

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
detected `pq` can still be refused, and `activePqKeys` in `lib/signer.ts` names which of
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
specifications in [`nips/`](../nips/README.md).

## 6. Channel Isolation

The three message channels are strictly separated:
- **NIP-07 channel** (`NIP07_REQUEST`/`NIP07_RESPONSE`) -- can only access `NIP07_ALLOWED_METHODS`
- **WebLN channel** (`WEBLN_REQUEST`/`WEBLN_RESPONSE`) -- can only access `WEBLN_ALLOWED_METHODS`
- **Internal channel** (direct `browser.runtime.sendMessage`) -- can access privileged methods

A NIP-07 request cannot invoke WebLN methods and vice versa. Neither can invoke privileged methods.

The background enforces this independently of content.ts: the `browser.runtime.onConnect` port listener rejects any method that does not start with `nip07_` or `webln_` ("Permission denied"), so even a compromised or regressed content script can never reach `vault_`/`signer_`/`wallet_` privileged methods over the port channel.
