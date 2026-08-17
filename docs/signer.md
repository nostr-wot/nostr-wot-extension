# NIP-07 Signer -- `lib/signer.ts`

## 1. Signing Flow

The signer checks **permissions FIRST**, then vault lock state. This means a denied permission is enforced even when the vault is unlocked and the key is available.

```
Web page calls window.nostr.signEvent(event)
    |
inject.ts  -->  NIP07_REQUEST { method: 'signEvent', params: { event } }
    |
content.ts -->  { method: 'nip07_signEvent', params: { event, origin: hostname } }
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
    - 'ask' --> queue for popup approval (badge shown); skipped for nip46
      accounts, whose remote signer (bunker) runs its own approval flow
    - 'allow' --> proceed
[4] If type === 'nip46' --> route to remote signer (NIP-46)
[5] If vault.isLocked() --> queue as waitingForUnlock
[6] If still locked after queue resolves --> throw "Vault is locked"
[7] vault.getPrivkey() --> sign with cryptoSignEvent --> privkey.fill(0)
[8] Return signed event
```

---

## 2. Permissions x Lock State Matrix

The interaction between permissions and vault state:

| Permission | Vault    | getPublicKey | signEvent / encrypt / decrypt |
|------------|----------|--------------|-------------------------------|
| `deny`     | locked   | REJECTED     | REJECTED                      |
| `deny`     | unlocked | REJECTED     | REJECTED                      |
| `allow`    | locked   | WORKS *      | BLOCKED (queues waitingForUnlock) |
| `allow`    | unlocked | WORKS        | WORKS                         |
| `ask`      | locked   | WORKS † / QUEUED | QUEUED                    |
| `ask`      | unlocked | WORKS † / QUEUED | QUEUED                    |

\* `getPublicKey` reads from `browser.storage.sync.myPubkey`, not from the vault

† **Connected sites never prompt for `getPublicKey`.** Connecting a site *is* the consent to share the identity pubkey: the "Connect this site" flow adds the origin to `allowedDomains` and clears `identityDisabled` for it, `background.ts` refuses every NIP-07 method from an origin that is not on that list, and `broadcastAccountChanged` already pushes the active pubkey to every connected tab unprompted. So with `ask`, `handleGetPublicKey` returns the pubkey directly when the origin is in `allowedDomains`, and only QUEUES a prompt for an origin that is not (which the NIP-07 path cannot reach — it is a guard for any other caller).

Both opt-outs still win over this: an explicit `deny` is rejected before the connected check, and `lib/bg/nip07-handlers.ts` rejects the call earlier still when identity is disabled for the site. Disconnecting the site restores prompting.

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

- `switchAccount` and `vault_setActiveAccount` (`lib/bg/vault-handlers.ts`)
- `vault_removeAccount` when the removed account was active
- `onboarding_createVault`, `onboarding_addToVault`, and `onboarding_saveReadOnly` (`lib/bg/onboarding-handlers.ts`)

`onActiveAccountChanged`:
1. Clears the per-origin `getPublicKey` auto-approve cooldown (a site must never silently receive the new account's pubkey off a cooldown earned by the old one)
2. Calls `rejectPendingForAccount(previousAccountId)` -- rejects all pending requests for the old account with `{ allow: false, reason: 'Account switched' }`

This prevents signing with the wrong key — or leaking the new account's identity — if requests were queued before the switch. As defense in depth, `handleGetPublicKey` additionally snapshots the pubkey/accountId at queue time and rejects on approval if the active account changed mid-prompt (see §3). New requests use the new active account.

---

## 5. Permission Cascade -- `lib/permissions.ts`

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

For accounts of type `nip46`, signing requests are routed to a `Nip46Client` instance (`lib/nip46.ts`) instead of the local vault:

- **Local `deny` still applies**: `permissions.check()` runs for every account type. An explicit per-origin `deny` throws `Permission denied` BEFORE the request is forwarded to the remote signer. Only the local `ask` prompt is skipped for NIP-46 accounts (the bunker runs its own approval for `ask`/`allow`).
- Client instances are cached per account ID in `_nip46Clients: Map<accountId, Nip46Client>`.
- Ephemeral keypair generated for relay communication.
- Supports `signEvent`, `nip04Encrypt/Decrypt`, `nip44Encrypt/Decrypt` via the remote signer protocol. **Post-quantum is the exception**: NIP-46 defines no post-quantum operations, and a `nip44Encrypt` sent to a bunker comes back as classic ciphertext. A post-quantum request is therefore refused before delegation rather than answered classically — see §8.
- NIP-46 in-flight requests are tracked in `signerPending` but do NOT show badges (no user action needed).
- `nostrconnect://` flow validates a shared secret before accepting the remote signer (see [Security](security.md#7-nip-46-connect-secret)).

### 6.1 `nostrconnect://` QR onboarding — persisted, resumable sessions

The QR onboarding flow (`lib/bg/onboarding-handlers.ts`) lets the user scan a `nostrconnect://` URI with their wallet app. The live `BunkerSigner` (with its relay subscription + `AbortController` + ephemeral secret) lives in the in-memory `_nostrConnectSessions` Map. In MV3 that Map is lost whenever the service worker suspends — which happens routinely while the user switches to their wallet to scan. To survive suspension, a **serializable mirror** of every session is persisted to `browser.storage.session`:

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
formats are specified in [`nips/`](../nips/README.md).

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
