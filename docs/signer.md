# NIP-07 Signer -- `src/services/signing/signer.ts`

## 1. Signing Flow

The signer checks **permissions FIRST**, then vault lock state. This means a denied permission is enforced even when the vault is unlocked and the key is available.

```
Web page calls window.nostr.signEvent(event)
    |
inject.ts  -->  NIP07_REQUEST { method: 'signEvent', params: { event } }
    |
content.ts -->  { method: 'nip07_signEvent', params: { event, origin: window.location.origin } }
    |
background.ts  -->  signer.handleSignEvent(event, origin)
    |
    v
[1] Get active account info from storage (accountId, accountType)
[2] Check vault.exists() -- throw if no vault (and not nip46)
[3] permissions.check(origin, 'signEvent', event.kind, accountId)
    - 'deny' --> throw "Permission denied" (STOPS HERE — for ALL account
      types, including nip46: an explicit local deny blocks BEFORE anything
      is routed to the remote signer)
    - 'ask' --> queue for popup approval (badge shown); ordinary events may
      delegate to nip46, but authentication destination consent stays local
    - 'allow' --> proceed
[3b] For authentication, validate and authorize the destination (see Authentication below)
[4] If type === 'nip46' --> route to remote signer (NIP-46)
[5] If vault.isLocked() --> await any in-flight startup auto-unlock
    (vault.whenStartupUnlockSettled()); if STILL locked, queue as
    waitingForUnlock and open the popup
[6] If still locked after queue resolves --> throw "Vault is locked"
[7] vault.withPrivkey() --> sign with cryptoSignEvent inside the scope
    (the copy is zeroed on every path; the follow-list and zap-note
    bookkeeping runs after the scope, never with a key in hand)
[8] Return signed event
```

---

## 2. Permissions x Lock State Matrix

The interaction between permissions and vault state:

| Permission | Vault    | getPublicKey | signEvent / encrypt / decrypt |
|------------|----------|--------------|-------------------------------|
| `deny`     | locked   | REJECTED     | REJECTED                      |
| `deny`     | unlocked | REJECTED     | REJECTED                      |
| `allow`    | locked   | WORKS *      | BLOCKED (queues waitingForUnlock) ‡ |
| `allow`    | unlocked | WORKS        | WORKS                         |
| `ask`      | locked   | WORKS † / QUEUED | QUEUED                    |
| `ask`      | unlocked | WORKS † / QUEUED | QUEUED                    |

\* `getPublicKey` reads from `browser.storage.sync.myPubkey`, not from the vault

‡ **"locked" excludes the cold-start window.** In "Never lock" mode the vault re-unlocks itself on every service-worker start, asynchronously (PBKDF2). `waitForVaultUnlock()` awaits `vault.whenStartupUnlockSettled()` before queueing anything, so a request that arrives mid-startup just waits for the key and signs — it does not queue an unlock marker and does not open the popup. Only a vault that is still locked once the auto-unlock has settled (or where none was in flight) prompts the user. Skipping that wait was the cause of the "popup opens with nothing in it on every signEvent" bug.

† **Connected sites never prompt for `getPublicKey`.** Connecting a site *is* the consent to share the identity pubkey: the "Connect this site" flow adds the origin to `allowedDomains` and clears `identityDisabled` for it, `background.ts` refuses every NIP-07 method from an origin that is not on that list, and `broadcastAccountChanged` already pushes the active pubkey to every connected tab unprompted. So with `ask`, `handleGetPublicKey` returns the pubkey directly when the origin is in `allowedDomains`, and only QUEUES a prompt for an origin that is not (which the NIP-07 path cannot reach — it is a guard for any other caller).

Both opt-outs still win over this: an explicit `deny` is rejected before the connected check, and `src/services/background/nip07-handlers.ts` rejects the call earlier still when identity is disabled for the site. Disconnecting the site restores prompting.

Prompting a connected site was the cause of the "popup opens by itself" bug: approving that prompt persisted nothing but the 60-second in-memory cooldown below, so the prompt — and the popup it auto-opens — returned on every service-worker restart, account switch, or page load a minute later.

---

## 3. Prompt System (In-Popup Approval)

- Pending requests stored in `browser.storage.session` under key `signerPending` as an array.
- Popup overlay shows pending requests with approve/deny buttons.
- **Full event snapshot**: for `signEvent` prompts the pending entry carries the FULL `content` and FULL `tags` for EVERY kind (never truncated). The approval UI (`EventPreview`) renders the complete content in a scrollable block and lists every tag, so a site cannot hide payload from the user in long content or non-contact-list tags.
- **Identity snapshot**: `getPublicKey` prompts capture the active account's pubkey and accountId at QUEUE time. On approval, if the active account no longer matches, the request is rejected (`Account switched`); otherwise the snapshotted pubkey — the one the user actually saw — is returned, never the current account's.
- **Storage mutex**: `withStorageLock()` prevents concurrent read-modify-write races on session storage.
- **Request timeout**: 120 seconds. Unresolved requests are auto-rejected.
- **Per-origin cap**: an origin may have at most 5 actionable prompts pending at once (`MAX_PENDING_PER_ORIGIN`); further `queueRequest` calls from that origin are rejected with `Too many pending requests from this origin` (popup-spam / DoS guard). NIP-46 in-flight entries and unlock markers don't count.
- **Badge count**: Shows number of pending requests needing user action.
- Users can choose "remember" to save the permission decision, optionally scoped to a specific event kind.
- **Batch resolve**: `resolveBatch()` resolves all pending requests for the same origin + method + kind.

---

## 4. Account Switching

EVERY code path that changes the active account calls `signer.onActiveAccountChanged(previousAccountId, newAccountId)`:

- `switchAccount` and `vault_setActiveAccount` (`src/services/background/vault-handlers.ts`)
- `vault_removeAccount` when the removed account was active
- `onboarding_createVault`, `onboarding_addToVault`, and `onboarding_saveReadOnly` (`src/services/background/onboarding-handlers.ts`)

`onActiveAccountChanged`:
1. Clears the per-origin `getPublicKey` auto-approve cooldown (a site must never silently receive the new account's pubkey off a cooldown earned by the old one)
2. Calls `rejectPendingForAccount(previousAccountId)` -- rejects all pending requests for the old account with `{ allow: false, reason: 'Account switched' }`

This prevents signing with the wrong key — or leaking the new account's identity — if requests were queued before the switch. As defense in depth, `handleGetPublicKey` additionally snapshots the pubkey/accountId at queue time and rejects on approval if the active account changed mid-prompt (see §3). New requests use the new active account.

---

## 5. Permission Cascade -- `src/services/permissions/permissions.ts`

Permissions are stored in `browser.storage.local` under key `signerPermissions` as a nested object with account-aware buckets:

```json
{
    "example.com": {
        "_default": {
            "signEvent:1": "allow",
            "signEvent": "deny",
            "nip04Encrypt": "allow",
            "*": "allow"
        },
        "acct_abc123": {
            "signEvent:1": "deny"
        }
    }
}
```

**Mode-based resolution** (controlled by `signerUseGlobalDefaults` flag):
- `useGlobalDefaults=true` -> only check `_default` bucket
- `useGlobalDefaults=false` -> only check account-specific bucket

**Cascade order** (deny-wins):
1. **Deny short-circuit**: if ANY consulted level — kind-specific (`signEvent:{kind}`), method-level (`signEvent`), or wildcard (`*`) — is `deny`, the result is `deny`. A kind-specific `allow` can never override a method-level or wildcard `deny`, and a broad `*` allow cannot bypass a narrower deny.
2. When no consulted level denies, the most specific defined value wins:
   `signEvent:{kind}` > `signEvent` > `*`
3. Default: `"ask"`

**DM kinds collapse into `sendMessages`**: `signEvent` for kinds `4` (NIP-04 DM), `13` (NIP-59 seal), `14` (NIP-17 chat rumor), and `1059` (NIP-59 gift wrap) resolves to the logical key `sendMessages`, which is also the key used by `nip04Encrypt` / `nip44Encrypt`. This means a single approval covers the entire send-DM flow (encrypt + sign), and a single Always-Allow does not produce a follow-up prompt for the matching `signEvent`. To deny only sign-of-DM-kind without affecting encrypt is no longer possible — it is one decision.

**Key properties**:
- Per-domain isolation: permissions for `allowed.com` do not affect `other.com`
- Per-kind isolation: `signEvent:1` (notes) can be allowed independently of other kinds; DM-related kinds are intentionally grouped under `sendMessages`
- Lock-independent: locking the vault does not change permission decisions

---

## 6. NIP-46 Remote Signing

For accounts of type `nip46`, signing requests are routed to a `BunkerSigner` instance (from `nostr-tools/nip46`, wrapped by `getNip46Client()` in `src/services/signing/signer.ts`) instead of the local vault:

- **Local `deny` still applies**: `permissions.check()` runs for every account type. An explicit per-origin `deny` throws `Permission denied` BEFORE the request is forwarded to the remote signer. Only the local `ask` prompt is skipped for NIP-46 accounts (the bunker runs its own approval for `ask`/`allow`).
- Signer instances are cached per account ID in `_nip46Clients: Map<accountId, BunkerSigner>`.
- An ephemeral keypair is generated for relay communication on first use and persisted to the account's `nip46Config` (`vault.updateAccountNip46Keys`) so reconnecting after a service-worker restart reuses the same identity rather than minting a new one.
- Supports `signEvent`, `nip04Encrypt/Decrypt`, `nip44Encrypt/Decrypt` via the remote signer protocol. **Post-quantum is the exception**: NIP-46 defines no post-quantum operations, and a `nip44Encrypt` sent to a bunker comes back as classic ciphertext. A post-quantum request is therefore refused before delegation rather than answered classically — see §8.
- NIP-46 in-flight requests are tracked in `signerPending` but do NOT show badges (no user action needed).
- `nostrconnect://` flow validates a shared secret before accepting the remote signer (see [Security](security.md#7-nip-46-connect-secret)).

### 6.1 `nostrconnect://` QR onboarding — persisted, resumable sessions

The QR onboarding flow (`src/services/background/onboarding-handlers.ts`) lets the user scan a `nostrconnect://` URI with their wallet app. The live `BunkerSigner` (with its relay subscription + `AbortController` + ephemeral secret) lives in the in-memory `_nostrConnectSessions` Map. In MV3 that Map is lost whenever the service worker suspends — which happens routinely while the user switches to their wallet to scan. To survive suspension, a **serializable mirror** of every session is persisted to `browser.storage.session`:

```
PersistedNcSession {
  sessionId, secretKeyHex, localPubkey, relays,
  nostrconnectUri, status: 'waiting' | 'connected' | 'error',
  errorMessage?, signerPubkey?, createdAt
}
```

- Mirrors are stored under `_ncSessions` (status fields) plus `_ncSessionSecrets` (the ephemeral secret). Per security policy **S-6**, the secret is never written in plaintext: it is XOR-split into a random `pad` and a `masked` half (the same scheme `setPendingOnboardingAccount` uses for privkeys), so neither half alone reveals it. `loadNcSession` reconstructs it via `xorBytes(pad, masked)` and zeroes the intermediates.
- `ensureLiveSession(persisted)` returns the in-memory session if present, otherwise rebuilds it — reconstructing the secret key, creating a fresh `AbortController`, and calling `BunkerSigner.fromURI(...)` again. Its `.then`/`.catch` write `status: 'connected' + signerPubkey` / `status: 'error' + errorMessage` back to the mirror.
- **Resume on re-init**: `onboarding_initNostrConnect` first looks for a non-expired `'waiting'` mirror; if found it rebuilds the live signer and returns the **same** `{ nostrconnectUri, sessionId }` rather than minting a second session (the QR the user is mid-scan stays valid). Only when no resumable session exists are old sessions torn down and a fresh one created.
- **Poll** (`onboarding_pollNostrConnect`) loads the mirror and:
  - missing → `{ expired: true }`
  - older than `NC_TTL_MS` (5 min) → delete + `{ expired: true }`
  - `status === 'error'` → delete + `{ error: errorMessage }` (a real failure is surfaced, **not** silently reported as expired)
  - otherwise `ensureLiveSession`, and if the signer is ready, create the account, delete both the Map entry and the mirror, stash it as the pending onboarding account, and return `{ connected: true, account }` (with `privkey`/`nip46Config`/`mnemonic` stripped).
- **Cancel** (`onboarding_cancelNostrConnect`) aborts the live signer (if any) and deletes the mirror. The popup only cancels on an explicit user action (Retry) — **not** on unmount/blur — so switching to the wallet app does not destroy the session.

There is no client-side 120s timeout: `BunkerSigner.fromURI` receives only the abort signal, so it waits until the user connects, the abort fires, or the `NC_TTL_MS` mirror TTL lapses.

---

## 7. Activity Logging

Every sign/encrypt/decrypt operation (both approved and rejected) is logged to `browser.storage.local.activityLog`:

```json
{
    "timestamp": 1708700000000,
    "domain": "example.com",
    "method": "signEvent",
    "kind": 1,
    "decision": "approved"
}
```

The log is capped at 200 entries (newest first, oldest trimmed).

---

## 8. Post-quantum Encryption

`nip44Encrypt` takes an optional third argument, `{ scheme: 'pq', recipientKemKey }`, which
switches it to the hybrid ML-KEM-1024 envelope. `nip44Decrypt` takes no flag: the envelope
is self-describing, so `handleNip44Decrypt` routes on the payload. The mechanics are in
[Message Flow §5c](message-flow.md#5c-post-quantum-via-nip-44-no-new-namespace); the wire
formats are specified in [`nips/`](../nips/pqc/README.md).

Two things matter at the signer level.

**Only the signer can do this.** Encryption needs the raw NIP-44 conversation key and
decryption needs the ML-KEM secret key. Neither ever leaves this process, so no client
library can implement the scheme on top of the NIP-07 surface however it is layered.

**Which is why `window.nostr.nip44.schemes` exists.** Post-quantum rides an optional
argument, so a signer that supports it and one that ignores it are shaped identically and
both return valid-looking ciphertext. Callers must be able to ask.

### Refusals

`schemes` describes the signer, not the active account, so `pq` requests can still fail.
Four reasons, each with its own message, so a client can say what to change:

| Account | Message | Where |
|---|---|---|
| Remote signer (NIP-46) | `Remote signers do not support post-quantum encryption` | `handleCryptoRequest`, before delegation |
| Watch-only / `readOnly` | `This account is watch-only…` | `activePqKeys` |
| Imported from an `nsec` | `This account has no seed phrase…` | `activePqKeys` |
| 12-word mnemonic | `Post-quantum keys require a 24-word seed phrase` | `activePqKeys` |

The NIP-46 case is the one that must not be missed. `handleCryptoRequest` routes remote
accounts to the bunker and never reaches `cryptoFn`, so a guard placed with the other three
would never run and the caller would receive classic ciphertext for a post-quantum request.
It is refused via the `remoteSignerUnsupported` parameter instead, after the permission gate
so that an origin cannot use it to probe the account type. `tests/signer-pq-refusal.test.ts`
covers all four, plus the requirement that classic NIP-44 still reaches the bunker.

None of these refusals ever downgrades. A caller that asked for post-quantum either gets
post-quantum or gets an error.

### Remote identity resolution

Both bunker-link and QR onboarding query `get_public_key` before returning an
account. `remoteAccount.ts` separates that user identity from `signer.bp.pubkey`,
which remains the encrypted transport recipient. It retains all current relays,
the pairing secret and client key for reconnection. Resolution has a bounded wait
and closes the temporary signer subscription on success or failure. QR polling
reports connected only once this resolution completes. See
[remote signer compatibility](remote-signer-compatibility.md) for tests and gaps.

For kind:9734 only, successful local and remote signing retains the zap message in
the encrypted wallet-note cache, keyed by the exact returned signed JSON's SHA-256.
Cache failure never rejects an otherwise successful signing result. This is display
metadata: the signer does not pay or publish the zap, and all WebLN consent and
payment checks remain independent. See wallet.md for matching and recovery limits.

## Authentication destinations (NIP-98 and NIP-42)

Authentication adds a destination-specific gate before local signing or NIP-46 delegation. `src/domain/signing/authentication.ts` validates the exact event snapshot before any asynchronous work. NIP-98 requires one `u` and one `method`; NIP-42 requires one `relay` and one nonempty `challenge`. Duplicate/ambiguous required tags, invalid payload hashes, credential-bearing or fragment URLs, insecure non-loopback transports, nonempty content and stale/future timestamps are rejected. HTTP auth has a 60-second window; relay auth has a 10-minute window, checked again after approval/unlock. The exact URL and event remain unchanged when signed.

- Every NIP-98 request, including same-origin HTTP, requires explicit endpoint consent or a matching saved grant. Ordinary signing allows never substitute for this gate. Remembered consent binds **account + exact requesting origin + exact signed URL (including query bytes) + HTTP method**. Paths and queries are not normalized or sorted; a different resource asks again. NIP-98 may authorize operations beyond login.
- HTTP grants use `version: 2` and an exact `resource`, preserving the destination origin for display. Legacy origin-wide HTTP allows (including records without a decision) are deliberately ignored and require new consent. They remain visible/revocable in storage; their original broad scope is never silently converted to endpoint consent. Legacy HTTP denies remain broad until explicitly revoked. Relay grants retain their existing behavior.
- NIP-42 always uses destination consent. A remembered permission binds **account + requesting origin + canonical full relay URL**, retaining path and query. Users may explicitly authorize that relay from **all connected sites**. A per-site deny still wins.
- Grants are always account-specific, independent of the ordinary permissions' “all accounts” toggle. They are not automatically copied to another account.
- Authentication requests are excluded from generic batch allow and require an explicit `authenticationScope` through `signer_resolve`. The compact UI shows the requesting website and a destination sentence (plus the HTTP method when present). Full event data is collapsed under Advanced. Approve and Reject act once; their arrow menus offer Approve always, relay-only Always for all sites, and Reject always. All remembered choices remain account-specific.
- Reject always persists a site-specific denial for the reviewed account, destination and HTTP method (when present), before resolving the request. It takes precedence over shared relay allowances and broad signing permissions, including same-origin HTTP. Stale/account-switched requests cannot create a denial; failed storage leaves the request pending. Settings labels and revokes both approvals and rejections. Legacy relay records without a decision remain approvals. New HTTP denials bind the exact resource; legacy HTTP denials retain their broader origin/method scope.
- Grants live in `authenticationGrants`; settings can list/revoke them through internal-only RPCs. Site-specific grants appear at the bottom of Permissions; a link below opens all-sites relay grants in a separate popup table. Both views follow the active account and retain individual revocation without a separate account selector. Disconnect removes site-specific grants; an intentionally shared relay grant remains but cannot serve the disconnected site. Account deletion and vault destruction clear relevant grants. Revocation and denials are rechecked after waiting for unlock.

The [client/backend registry](auth-client-registry.md) supplies exact NIP-98 pairs for **Default backend auth**, an account-specific Permissions toggle that starts disabled. When enabled, connected sites may authenticate to exact same-origin HTTPS backends or registered pairs without an endpoint prompt. All valid paths and methods at those origins qualify; no individual grants are created. Explicit denials win. Other destinations and relays still require their own consent. The policy is rechecked before signing, cleared on account removal/vault reset, and does not bypass identity, origin/frame, native-wallet or signature validation. Turning it off preserves explicitly saved grants and existing site sessions.

NIP-42 challenges are supplied by the client; only the relay can bind them to its connection. A trusted relay grant cannot prove the requesting client obtained its challenge honestly.

Authentication revalidation includes identity-disabled sites after approval/unlock, before both local signing and remote delegation.

## Local pending-message review

NIP-04/NIP-44 approval details show a cached peer profile (sender for decrypt,
recipient for encrypt) with a public-key fallback. Missing profiles use the shared verified kind:0 reader with purplepag.es only, then persist to the profile cache. NIP-44 decrypt waits for Reveal before querying the identified sender, avoiding lookups of temporary wrapping keys. Compact profiles use safe profile image URLs with an initial fallback. Clicking the blurred message surface previews plaintext locally without resolving
the page request or changing its permission. The code-button raw-data popup shows the full method,
origin and parameters; these crypto calls do not carry a complete Nostr event.

The internal-only `signer_previewRequest` RPC accepts an existing pending ID and
an explicit `reveal` boolean. Its callback holds the original payload in worker
memory, never pending-request storage. Raw review does not decrypt. Reveal uses
the same classic/PQ crypto implementation and captured account session as the
request, validates the session before and after the operation, and returns only
to the extension UI. Resolution, rejection, timeout, lock and worker restart
discard callbacks. A late preview result for a removed request is rejected.
The UI clears preview data on account, lock or pending-queue changes and ignores
late replies. Remote signers retain their own approval flow and do not gain a
local-key preview.

Grouped messages use sender profiles and available sent dates rather than numbered
Message headings or repeated permission labels. Preview failures appear once and retain the actual RPC error.
Queue callbacks are registered before publishing pending metadata, so an already
open popup can preview immediately; opening native UI does not block registration.
For NIP-17, Reveal verifies the inner kind-13 seal and decrypts the rumor locally.
A kind-14 rumor must match its seal author. The UI then uses that author's cached
profile, shows the message body, and includes the decrypted event in the raw-data popup while revealed.
This never changes the original result returned to the site after approval.
A loading hint appears during lookup; missing or unavailable profiles retain the public-key fallback without a cache warning.

The message surface hides again after 30 seconds using the same timed-reveal hook as private-key export. Concealed content is a placeholder; plaintext and the decoded event are discarded on timeout or click-to-hide.

Pending signEvent review opens the full event in a code-button popup and describes intent above it, including app action then app name for kind 30078. Grouped ordinary requests expose checkboxes and approve only selected request IDs, leaving unchecked siblings pending; Reject all applies to the group. Authentication destination review remains separate from ordinary bulk approval.

## Authentication integrity and native wallet policy

Optional `origin` and reserved `client-origin` tags on authentication events must each
appear at most once, contain exactly one value, and equal the browser-derived caller
origin. They remain optional signed metadata, not browser or extension attestation.
Another signer can make arbitrary origin claims; backends must not infer browser identity
from the presence of either tag.

Generic page `signEvent` refuses NIP-98 tokens for `https://zaps.nostr-wot.com` wallet
operations `/api/provision`, `/api/claim-username`, `/api/release-username`, and their
`/api/v2/` counterparts, including queries and trailing slashes. This applies even to
same-origin pages and existing grants. These capabilities are issued only by the
extension's privileged internal wallet flow. Other endpoints use the ordinary exact
resource consent policy. Relay authentication is unaffected.

Before review, omitted ordinary-event tags become `[]` and omitted timestamps become
the current integer timestamp. The same normalized event is signed. Remote signing uses
`signVerifiedRemoteEvent`: snapshot before any connection await, give the signer a separate
copy, and compare the result's expected author, kind, timestamp, content and every ordered
tag against that snapshot. Verify its ID and Schnorr signature independently before
returning canonical fields; reject mutations even when the remote signature is valid.
Account-session validity is rechecked after verification.


Community explanations: [backend authentication](https://nostr-wot.com/en/guides/backend-authentication)
and [relay authentication](https://nostr-wot.com/en/guides/relay-authentication).
