# Message Flow

## 1. Page-to-Background Round Trip

```
inject.ts (MAIN world)
  |  window.postMessage({ type: 'WOT_REQUEST' | 'NIP07_REQUEST' | 'WEBLN_REQUEST', id, method, params })
  v
content.ts (ISOLATED world)
  |  1. Rate-limit check (100 WoT req/sec)
  |  2. Validate method against allowlist
  |  3. For NIP-07: enforce HTTPS, prefix method with 'nip07_', append origin
  |  3b. For WebLN: enforce HTTPS, prefix method with 'webln_', append origin
  |  4. browser.runtime.sendMessage({ method, params })
  v
background.ts (service worker)
  |  1. Privilege gate (block privileged methods from content scripts)
  |  2. validateNip07Params (event shape, pubkey format)
  |  3. Domain gate: if not allowed & not dismissed → open popup, wait for connect
  |  4. handleRequest() -> switch on method -> return result
  v
content.ts
  |  window.postMessage({ type: 'WOT_RESPONSE' | 'NIP07_RESPONSE' | 'WEBLN_RESPONSE', id, result, error })
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

| Layer | Location | Limit |
|-------|----------|-------|
| Content script | `content.ts` | 100 relay-query (WOT channel) req/sec (sliding window) |

The content script rate-limits the relay-query (WOT) channel. The background no
longer rate-limits any method: `RATE_LIMITED_METHODS` is empty and
`checkRateLimit()` always allows (the only methods it ever throttled were the
removed trust-graph computations). NIP-07 methods are gated by the user-facing
permission system instead.

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

All WebLN methods except `webln_enable` are gated behind the same domain allowlist used for NIP-07. A site must be connected (approved by the user) before it can call `getInfo`, `getBalance`, `sendPayment`, or `makeInvoice`. The `webln_enable` method is exempt from the domain check because it is the method that *adds* the requesting domain to the allowlist — matching the standard WebLN convention where `enable()` is the connection handshake. Individual methods still enforce their own permission prompts (e.g., `sendPayment` prompts the user before paying).

---

## 5. Privileged Methods

Methods in `PRIVILEGED_METHODS` are gated to internal extension senders only. The check:

```ts
const isInternal = sender.id === browser.runtime.id &&
  (!sender.url || sender.url.startsWith(extensionBaseUrl));
```

This ensures the message comes from an extension page (popup, onboarding, prompt) and not from a content script running in a web page tab. This protects all vault, permission, database management, and configuration methods.

---

## 6. Channel Isolation

The four message channels are strictly separated:
- **Relay-query channel** (`WOT_REQUEST`/`WOT_RESPONSE`) -- can only access `WOT_ALLOWED_METHODS`, which now contains only `getRelayList` and `getRelayPool`
- **NIP-07 channel** (`NIP07_REQUEST`/`NIP07_RESPONSE`) -- can only access `NIP07_ALLOWED_METHODS`
- **WebLN channel** (`WEBLN_REQUEST`/`WEBLN_RESPONSE`) -- can only access `WEBLN_ALLOWED_METHODS`
- **Internal channel** (direct `browser.runtime.sendMessage`) -- can access privileged methods

A WoT request cannot invoke NIP-07 or WebLN methods and vice versa. None can invoke privileged methods.
