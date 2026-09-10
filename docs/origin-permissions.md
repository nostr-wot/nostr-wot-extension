# Website permission origins

Website identity is the canonical web origin: scheme, hostname and non-default
port. For example, `http://localhost:3000`, `http://localhost:4000` and
`https://localhost:3000` are three independent origins for new grants. Paths do not affect identity;
URL normalization removes default ports and normalizes hostname casing.

The content bridge forwards `window.location.origin`. Both background message
entrypoints overwrite that value using browser-provided sender URL information.
A frame's URL takes precedence over its tab URL; only a top-frame sender can use
the tab URL fallback. Malformed, non-HTTP(S), and explicitly opaque (`null`)
origins are rejected before dispatch. A subframe cannot replace the top-frame
origin tracked for account-change notifications.

Connection consent, WebLN enable consent, remembered signing/payment rules,
approval grouping, pending request limits and popup site context all use this
same complete key. The active tab resolver also rejects legacy hostname popup
context. Account-change notifications carry their authorized origin and the
content script checks it against the current origin before releasing the identity.
This prevents an old tab registry entry from leaking identity after navigation.

Existing hostname-only connection consent, WebLN consent, signing/payment rules,
dismissals and identity blocks continue to apply to the same hostname across
schemes and ports, exactly as before. Existing sites need no reconnect or renewed
approval. This is a compatibility fallback only when a matching stored hostname
entry exists; subdomains are not included and nothing is automatically copied or
created. New grants use the exact origin supplied by the browser.

Permission reads merge only the selected account/global bucket from applicable
legacy and exact keys. An explicit exact-origin rule overrides the same legacy permission key, so editing
an inherited rule works without changing other origins or accounts. Unedited
legacy keys remain effective, including the usual kind/method/wildcard deny
cascade. An unrelated broader deny must still be changed separately. The popup uses the same
compatibility lookup for connection indicators and displayed permission rules.
Clearing rules or disconnecting from an origin removes both its exact record and
any applicable legacy hostname record, so fallback cannot resurrect consent.
Removing a legacy record also revokes that old shared grant for sibling ports and
schemes; independently approved exact-origin records remain intact.

Internal extension operations that use explicit non-page labels remain separate
from browser-authenticated website requests. Cosmetic favicon lookup extracts
a hostname without changing the origin used by new permission writes.

Tests live in `permissions.test.ts`, `communication.test.ts`,
`active-tab-domain.test.ts`, `openPopupForActiveTab.test.ts` and `favicon.test.ts`.
