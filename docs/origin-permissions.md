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

## Templates when connecting

Both the home card and globe Connect action open the same compact “Give permissions to this app” picker. Built-in and saved custom templates appear immediately in a table; suggestions are checked and marked Suggested, and selected rows turn purple. Checkboxes select templates; clicking a template name opens its permissions popup. Users can select multiple templates, open View permissions in a popup to inspect or edit their combined rules, or create their own in a separate popup. Closing either popup without confirming discards its unapplied draft. Combining templates keeps Deny over Ask over Allow when they overlap. Explanations are available through info buttons. Connecting shares the selected account's public key without a separate template or public-key approval. The review covers additional signing/encryption actions only. Disconnect revokes future site access and clears its rules; it cannot retract data a site already received. Historical explicit identity denials remain enforced until the user reconnects, which records fresh identity consent. Identity blocking remains a separate site privacy control.

Choose **Apply and connect** to save the reviewed rules for the exact origin and selected account. **Skip template** connects without adding optional rules; existing global rules still apply. Closing the dialog leaves the site disconnected. A reconnect offers templates again, but reopening the extension or receiving another request does not. Read-only accounts cannot grant signing permissions. Remote accounts retain external-signer approval and routing; local templates cannot bypass that signer.

### Built-in templates

| Template | Actions offered |
| --- | --- |
| Nostr WoT Playground | Read graph status, follow lists, and trust paths/scores |
| Social network | Notes, reactions, reposts, comments, articles and app settings; profile/contact edits and deletion stay Ask |
| Direct messages | Read and send private messages |
| Group messages | Chat messages, threads and reactions; joining, leaving, creating and deleting group content stay Ask |
| Publishing | Articles, drafts and comments; deletion stays Ask |
| App preferences | Save app-specific data |

These are action presets, not protocol sandboxes. Private-message permissions cover NIP-04/NIP-44 operations and message signing, not a selected conversation. Group kinds are not restricted to one group. Kind 30078 permission covers app-data signing and cannot enforce app-specific tag namespaces. Payments and WebLN connection are not granted by any template. Authentication is not pre-authorized by built-in templates. Users may explicitly add individual event kinds to their own template; the existing authentication checks still apply. No wildcard or unrestricted signing permission is accepted by the template API.

Group actions follow [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md) and the shared event-label catalogue. Membership and administrative actions stay Ask. Actual support varies between clients and relays.

### Known sites

Recognition matches an exact HTTPS origin. A lookalike, HTTP URL, port change, or unlisted subdomain gets no known-site recommendation. Recommendations are optional product defaults, not claims that a website requested every listed action or an endorsement. They do not extend the separate backend-auth registry.

| Origin | Display name | Suggested templates |
| --- | --- | --- |
| `https://sky.obelisk.ar` | Obelisk Sky | Groups, direct messages |
| `https://obelisk.ar` | Obelisk | Groups, direct messages |
| `https://lawallet.io` | LAWallet | No extra permissions |
| `https://nostrwot.com` | Nostr WoT | Nostr WoT Playground |
| `https://primal.net` | Primal | Social |
| `https://coracle.social` | Coracle | Social |
| `https://nostrich.org` | Nostrich | Social |
| `https://snort.social` | Snort | Social |
| `https://yakihonne.com` | YakiHonne | Publishing, social |
| `https://chachi.chat` | Chachi | Groups |

The initial list was curated on 2026-11-02 from the requested sites, the existing source-evidenced client registry, and [Nostrich's canonical website](https://nostrich.org/). This list describes recommended use cases, not an exhaustive audit of those live deployments. LAWallet receives no speculative signing grants. The Nostr WoT Playground recommendation follows our website’s `lib/graph/sources.ts` ExtensionGraphSource: `getStatus`, `getFollows`, and `getDistanceBatch`. It grants no signing, encryption or payment actions.

### Custom templates

Open **Permissions → Permission templates**, or choose **Choose a template or create your own** while connecting. Start from a preset or a blank template, edit Allow / Ask / Deny, add known actions or a custom event kind, and give the template a name. Save updates the selected custom template; Save a copy duplicates it. Built-ins remain unchanged. Remove a rule through its decision menu, or delete a custom template.

Templates are local reusable snapshots. Editing or deleting one never changes the rules of previously connected sites. To revoke applied permissions, edit Site rules or disconnect. Storage is limited to 50 custom templates, 100 rules each, and 80-character names. Background validation rejects unsupported methods, malformed kinds, wildcard and prototype keys. Built-ins are not writable.

Rules and the connection allowlist are saved together under the existing permissions write lock, before waiting page requests resume. An existing effective Deny conflict blocks application; keep that action denied in the template or change the existing rule deliberately. Skip does not erase denials. A changed active account prevents submission. The background derives the account from stored state and template endpoints are extension-only RPCs.

### Playground read permissions

The Playground template uses `wot_getStatus`, `wot_getFollows`, and `wot_getDistanceBatch`. These also cover equivalent status/config/stats, common-follow, and single/batch trust/path query variants, so using another form of the same query cannot bypass a Deny. Explicit Ask opens the existing approval flow; Deny rejects the read. Previous connections without explicit graph rules retain their original connection consent. Web of Trust must still be enabled and the required graph available; a template does not change those settings or start a sync. Disconnection, identity blocking, and account-change checks remain enforced.
