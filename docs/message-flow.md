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

All WebLN methods except `webln_enable` are gated behind the same domain allowlist used for NIP-07. A site must be connected (approved by the user) before it can call `getInfo`, `getBalance`, `sendPayment`, or `makeInvoice`. The `webln_enable` method is exempt from the domain check because it is the method that *adds* the requesting domain to the allowlist — matching the standard WebLN convention where `enable()` is the connection handshake. Individual methods still enforce their own permission prompts (e.g., `sendPayment` prompts the user before paying).

---

## 5. Privileged Methods

Methods in `PRIVILEGED_METHODS` are gated to internal extension senders only. The check:

```ts
const isInternal = sender.id === browser.runtime.id &&
  (!sender.url || sender.url.startsWith(extensionBaseUrl));
```

This ensures the message comes from an extension page (popup, onboarding, prompt) and not from a content script running in a web page tab. This protects all vault, permission, and configuration methods.

---

## 6. Channel Isolation

The three message channels are strictly separated:
- **NIP-07 channel** (`NIP07_REQUEST`/`NIP07_RESPONSE`) -- can only access `NIP07_ALLOWED_METHODS`
- **WebLN channel** (`WEBLN_REQUEST`/`WEBLN_RESPONSE`) -- can only access `WEBLN_ALLOWED_METHODS`
- **Internal channel** (direct `browser.runtime.sendMessage`) -- can access privileged methods

A NIP-07 request cannot invoke WebLN methods and vice versa. Neither can invoke privileged methods.
