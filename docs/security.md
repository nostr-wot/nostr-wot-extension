# Security

## 1. Vault -- `src/services/vault/vault.ts`

The vault encrypts sensitive account data (private keys, mnemonics) at rest using Web Crypto APIs.

**Encryption scheme:**

1. User password fed to PBKDF2 with SHA-256, **600,000 iterations**, random 32-byte salt, producing a 256-bit AES key.

   600,000 is OWASP's recommendation for PBKDF2-HMAC-SHA-256. The vault previously used 210,000 — which is OWASP's figure for SHA-**512**, the wrong row of the same table, so the parameter looked calibrated while being ~2.9x weak. The record now stores the `iterations` it was written with; a record without that field predates the change and is read back at 210,000, then **transparently re-encrypted at 600,000 on the next successful unlock**, since that is the one moment the password is in hand. A failed upgrade is logged and leaves the working record alone.

   **"Never lock" vaults stay at 210,000 deliberately.** That mode stores the vault under the empty password, and the code supplying it is public — the work factor protects nothing there, while this KDF runs on every service-worker cold start. Paying 600,000 on that path would be latency without security.
2. AES-256-GCM encrypts the vault payload JSON with a random 12-byte IV.
3. Stored in `browser.storage.local` under key `keyVault`:

```json
{
    "version": 1,
    "salt": "<base64>",
    "iv": "<base64>",
    "ciphertext": "<base64>"
}
```

**Auto-lock**: Configurable timeout (default 15 minutes / 900,000ms). When the timer fires, `lock()` zeroes all in-memory key material and sets `_decrypted = null` and `_cryptoKey = null`. It also writes `LOCK_STATE_KEY` (`vaultLockStateAt`, `src/constants/vault.ts`) to `storage.local`, fire-and-forget, because locking left no trace an open popup could observe: `VaultContext` re-checked only when the active account changed, so a popup sitting open past the interval went on rendering unlocked UI over a locked vault — and an incoming request that queued an unlock waiter produced no prompt at all, since the surface that raises one only does so when it believes the vault is locked. The request simply timed out after two minutes with no UI ever shown. `storage.onChanged` is the only channel that carries this: runtime messages are not delivered back to the document that sent them, and a background broadcast reaches only a popup already listening. The background script also calls `clearWalletProviders()` on lock to disconnect and discard cached wallet provider instances. On Chrome, service worker termination also naturally clears memory. When the vault auto-locks, a full-screen overlay blocks all UI until the password is entered.

The configured interval is stored as `autoLockMs` in `browser.storage.local`, but `_autoLockMs` is module-level in-memory state that resets to the 15-minute default on every service-worker cold start. `restoreAutoLockSetting()` re-reads the persisted `autoLockMs` (defaulting to 15 min when absent) and re-arms the timer; it is called on background startup and after every successful `vault_unlock`, so the user's chosen interval — not the default — governs locking after the SW restarts (bug #10).

**"Never lock" auto-unlock and the cold-start window**: with `autoLockMs === 0` the vault is stored under an empty password and `background.ts` re-unlocks it on every service-worker cold start. That unlock is asynchronous — a storage read plus PBKDF2 at 210,000 iterations — so `isLocked()` reports **locked** for a few hundred milliseconds after every startup, and no keep-alive alarm is armed in this mode (`armKeepAlive()` returns early when `_autoLockMs <= 0`), so Chrome tears the worker down after ~30s idle and cold starts are routine. The startup sequence is therefore registered via `vault.beginStartupUnlock()`, and request paths (`waitForVaultUnlock()` in `src/services/signing/approvalQueue.ts`) `await vault.whenStartupUnlockSettled()` before concluding the vault is locked. Without that gate a `signEvent` arriving inside the window queued an unlock marker and auto-opened the action popup — showing an empty popup on requests the user's saved `allow` permission had already approved.

**The `vault_isLocked` RPC awaits the same gate**, and did not until the UX audit found it. The popup asks that one question and trusts the answer, so on a never-lock vault every popup opened after ~30s idle — which is every ordinary open — raced the startup PBKDF2 and was told "locked". Because a *successful* unlock wrote nothing observable, the answer never corrected: the wallet balance card, the Wallet menu row and every locked-gated action stayed hidden for the whole life of that popup and reappeared on the next open for no visible reason. This was the extension's most reproducible intermittent fault. `unlock()` now bumps `LOCK_STATE_KEY` on success as well as `lock()` doing so, so the marker means "the lock state changed" in either direction and an open popup re-reads it.

**Service-worker keep-alive**: On Chrome MV3 the service worker is torn down frequently (including around page refreshes), which wipes the in-memory decrypted key and makes a timed-mode vault appear locked well before the configured interval. While the vault is unlocked in timed-lock mode (`autoLockMs > 0`), `vault.ts` arms a periodic `browser.alarms` keep-alive (`'vault-keepalive'`, ~30s period — Chrome clamps the minimum). The `onAlarm` listener in `background.ts` does a trivial async storage read on each tick, resetting the SW idle timer so the worker stays alive until the auto-lock actually fires. The alarm is cleared on every `lock()` and is **never** used to persist the decrypted key — it only holds the worker open, preserving the security model. It is a graceful no-op where `browser.alarms` is unavailable (Safari's persistent background page, tests).

**Post-quantum handlers await startup auto-unlock too.** Their shared active-account lookup waits for `whenStartupUnlockSettled()` before checking the lock. This includes status and key export, so opening Security during a Never-lock cold start does not leave the post-quantum panel displaying a stale "Vault is locked" error while the main vault status says unlocked. If startup auto-unlock fails, the handlers still reject access to a locked vault.

**Brute-force protection**: Two layers with the same escalation schedule (every 5 consecutive failures: 1 min, 5 min, 15 min, 30 min cap):

1. **Popup-side** — the `useVaultUnlock` hook displays the countdown and disables the input during lockout. Module-level state, so remounting components does not reset it; it does reset on full page reload.
2. **Background-side (authoritative)** — the `vault_unlock` handler (`src/services/background/vault-handlers.ts`) keeps a persisted failure counter in `browser.storage.local` under `vaultUnlockGuard { failures, lockedUntil }`. While `lockedUntil` is in the future, `vault_unlock` throws `Too many failed attempts. Try again in Ns` without attempting decryption — even for the correct password. A failed attempt increments the counter; a successful unlock removes the guard; `vault_destroy` clears it. Because it is persisted, popup reloads and service-worker restarts do not reset it.

**Creating a vault refuses to replace one that holds accounts.** `vault.create()` writes the payload it is given, so `onboarding_createVault` — whose payload is `accounts: [theNewOne]` — replaces the vault outright. Adding to an existing vault is `onboarding_addToVault`; deliberately replacing one is `vault_destroy` first. The popup tries to route between them and cannot be relied on to: `PasswordStep` probes for an existing vault and falls into `catch { setVaultExists(false) }`, so a cold worker — or the persisted brute-force guard throwing during a lockout — turns *any* failure of that probe into "there is no vault", and the next screen offers to create one. The handler therefore enforces it, refusing when a vault exists **and holds accounts**. The account list in `storage.local` is what makes that answerable while the vault is locked, which is the state the dangerous path arrives in: the decrypted payload is unreadable then, so asking the vault itself would answer "no accounts" and wave the overwrite through. An empty vault left behind by removing the last account is still a supported thing to onboard into.

**Vault destroy** (`vault.destroy()`): Irreversibly wipes the encrypted vault from `browser.storage.local` and clears all in-memory state. The `vault_destroy` RPC handler also clears wallet providers, cancels pending signer requests, and removes account metadata from storage. Exposed via "Forgot password?" on the full-screen lock overlay with a confirmation step.

---

## 2. In-Memory Key Format -- `MemoryVaultPayload`

Private keys are stored differently on disk vs in memory:

| Layer | Format | Zeroable? |
|-------|--------|-----------|
| Disk (JSON) | `Account.privkey: string` (hex) | N/A |
| Memory | `MemoryAccount.privkeyBytes: Uint8Array` | Yes |
| Disk (JSON) | `Account.mnemonic: string` | N/A |
| Memory | `MemoryAccount.mnemonicBytes: Uint8Array` | Yes |

On `unlock()`, hex strings are converted to `Uint8Array` via `toMemoryAccount()`. On `lock()`, every account's `privkeyBytes` and `mnemonicBytes` are zeroed with `.fill(0)` (`zeroDecryptedKeys()`) before the reference is nulled, so the long-lived copy of the key material is zeroable memory rather than an immutable string.

This reduces the exposure; it does not eliminate it, and the previous wording here overstated it. Every call that serializes the vault — `getDecryptedPayload()`, `save()`, `reEncrypt()` — runs `toStoragePayload()`, which materializes every account's private key and mnemonic as JS strings for `JSON.stringify`. Those strings cannot be zeroed and stay in the heap until the GC collects them. That is unavoidable at encryption time, but it means the guarantee is "no *persistent* plaintext copy", not "no plaintext copy ever".

**Imported post-quantum keys are held the same way.** An account that cannot derive (no mnemonic, or a 12-word one) may import an ML-KEM-1024 / ML-DSA-87 pair. Those secrets live in the encrypted vault payload as `Account.pqKeys` and in memory as `pqKemSecretBytes` / `pqDsaSecretBytes` — `Uint8Array`, zeroed by `zeroDecryptedKeys()` with everything else. `'pqKeys'` is omitted from `SafeAccount` and `SafeAccountWithWallet`, and every accessor that returns a `SafeAccount` strips the memory fields, so the popup's account list never carries them. Reads go through `withImportedPqKeys()`, which zeroes its copies on every path including throws; `pqc_getStatus` reports only `source: 'imported'` and the public halves.

Unlike derived keys these are **not** recoverable from the seed phrase, which is a real change to the backup story for those accounts — the panel says so persistently rather than once.

**Replacing the decrypted payload also zeroes the old buffers**: `create()` (called while unlocked during password-change / lock-mode transitions) and a successful `unlock()` while already unlocked both run `zeroDecryptedKeys()` before assigning the new `_decrypted`, so the previous key buffers can't linger in the heap. A FAILED `unlock()` never touches the current session's buffers.

On `save()` and `reEncrypt()`, memory format is serialized back to JSON via `toStoragePayload()`.

---

## 3. Private Key Handling

`vault.getPrivkey()` returns a **copy** of the private key as `Uint8Array(32)` -- `new Uint8Array(acct.privkeyBytes)`. The caller MUST zero the returned array after use with `privkey.fill(0)` in a `try/finally` block. Because it's a copy, the caller's `fill(0)` does not affect the vault's internal state.

```ts
const privkey = vault.getPrivkey();
if (!privkey) throw new Error('No private key');
try {
    return await cryptoSignEvent(event, privkey);
} finally {
    privkey.fill(0);
}
```

The same try/finally discipline applies in `src/domain/accounts/creation.ts` and the vault handlers:

- `createFromMnemonic` / `createFromMnemonicAtIndex` / `importFromMnemonicDerived` zero the 64-byte BIP-39 seed (`mnemonicToSeed` result) and the derived privkey `Uint8Array` in a `finally` block — only the hex copy on the returned `Account` survives.
- `importNsec` zeroes the decoded `privkeyBytes` after deriving the pubkey.
- `vault_exportNsec` wraps its `privkeyBytes.fill(0)` in `finally` so a throw inside `nsecEncode` cannot skip zeroing.

---

## 4. Vault `reEncrypt()` Method

Changes the vault password without exposing private keys as intermediate hex strings:

1. Validates vault is unlocked and new password meets minimum length (8 chars, or empty for never-lock mode)
2. Generates new random salt + derives new AES key
3. Serializes `MemoryVaultPayload` -> `VaultPayload` JSON -> encrypts with new key
4. Stores new encrypted vault, replaces internal `_cryptoKey`

This avoids the old `getDecryptedPayload()` + `lock()` + `create()` pattern, which tore down and rebuilt the whole session. It does still produce one intermediate JSON copy containing hex private keys — step 3 serializes the payload — so the win is a smaller window and a preserved session, not the elimination of the plaintext copy.

---

## 5. NIP-49 Zeroing (`src/lib/crypto/nip49.ts`)

- **`ncryptsecEncode`**: The input `privkeyBytes` is zeroed in a `finally` block after encryption.
- **`ncryptsecDecode`**: The decrypted `Uint8Array` view is zeroed after extracting the hex string.

---

## 6. NIP-04 Error Normalization (`src/lib/crypto/nip04.ts`)

AES-CBC decrypt errors are caught and re-thrown as a generic `"Decryption failed"` message. This prevents padding oracle attacks where different error messages for "wrong padding" vs "wrong key" would leak information about the plaintext.

---

## 7. NIP-46 Connect Secret

The `nostrconnect://` QR code flow includes a `connectSecret` parameter:
- A random 16-byte hex string is generated (`onboarding_initNostrConnect` in `src/services/background/onboarding-handlers.ts`) and embedded in the URI via `createNostrConnectURI`
- `BunkerSigner.fromURI` (from `nostr-tools/nip46`, not a hand-rolled client) validates that the wallet's `connect` acknowledgement echoes the same secret before it resolves
- Requests with a wrong or missing secret never resolve the signer promise

There is no in-house `Nip46Client` class any more — the whole NIP-46 wire protocol (both this QR flow and signing requests to an existing bunker) is delegated to `nostr-tools`'s `BunkerSigner`; see [Signer §6](signer.md#6-nip-46-remote-signing).

---

## 8. Privileged Method Gating

The `PRIVILEGED_METHODS` set is auto-derived in `background.ts` from every handler
map that is not a page-facing NIP-07/WebLN/relay-query method, plus `configUpdated`.
It contains all sensitive operations (representative list):

- **Vault lifecycle**: `vault_unlock`, `vault_lock`, `vault_create`, `vault_isLocked`, `vault_exists`, `vault_listAccounts`, `vault_addAccount`, `vault_removeAccount`, `vault_setActiveAccount`, `vault_getActivePubkey`, `vault_setAutoLock`, `vault_getAutoLock`, `vault_exportNsec`, `vault_exportNcryptsec`, `vault_importNcryptsec`, `vault_changePassword`, `vault_getActiveAccountType`
- **Signer permissions**: `signer_getPermissions`, `signer_getPermissionsForDomain`, `signer_clearPermissions`, `signer_savePermission`, `signer_getPermissionsRaw`, `signer_getPermissionsForDomainRaw`, `signer_copyPermissions`, `signer_getUseGlobalDefaults`, `signer_setUseGlobalDefaults`, `signer_setupNewAccountPermissions`
- **Pending requests**: `signer_getPending`, `signer_resolve`, `signer_resolveBatch`
- **Account switching**: `switchAccount`
- **Onboarding**: `onboarding_validateNsec`, `onboarding_validateNcryptsec`, `onboarding_validateNpub`, `onboarding_connectNip46`, `onboarding_generateAccount`, `onboarding_exportNcryptsec`, `onboarding_saveReadOnly`, `onboarding_createVault`, `onboarding_addToVault`, `onboarding_initNostrConnect`, `onboarding_pollNostrConnect`, `onboarding_cancelNostrConnect`
- **Config**: `configUpdated`
- **Domain management & identity injection**: `requestHostPermission`, `enableForCurrentDomain`, `addAllowedDomain`, `removeAllowedDomain`, `getAllowedDomains`, `isDomainAllowed`, `isDomainDismissed`, `hasHostPermission`, `setIdentityDisabled`, `getIdentityDisabledSites`
- **Activity log**: `getActivityLog`, `clearActivityLog`
- **Profile & mute list**: `getProfileMetadata`, `getProfileMetadataBatch`, `updateProfileCache`, `getMyMuteList`, `fetchMuteList`
- **Publishing**: `publishRelayList`, `publishMuteList`, `signAndPublishEvent`, `signEvent`
- **NIP-46 sessions**: `nip46_getSessionInfo`, `nip46_revokeSession`
- **Health checks**: `checkRelayHealth`

All gated by: `sender.id === browser.runtime.id && sender.url.startsWith(extensionBaseUrl)`.

---

## 8b. Wallet Credential Storage

Wallet credentials are stored encrypted inside the vault as part of the `Account` object:

| Config type | Sensitive field | Storage |
|-------------|----------------|---------|
| NWC | `connectionString` (contains secret key) | `account.walletConfig.connectionString` inside AES-256-GCM vault |
| LNbits | `adminKey` (full access token) | `account.walletConfig.adminKey` inside AES-256-GCM vault |

Both values are encrypted at rest (same PBKDF2 + AES-256-GCM scheme as private keys). The `walletConfig` field is stripped from `SafeAccount` (used by public APIs) -- only `SafeAccountWithWallet` retains it, and that type is restricted to internal background wallet handlers.

The LNbits admin key grants full wallet control (send, receive, read balance) and is treated with the same sensitivity as private keys. It is never exposed to content scripts or page context.

---

## 8c. Payment Authorization Flow

When a page calls `window.webln.sendPayment(bolt11)`:

1. **Vault lock check** -- request is rejected if the vault is locked.
2. **Wallet config check** -- request is rejected if no `walletConfig` exists on the active account.
3. **Permission check** -- `signerPermissions.check(origin, 'webln_sendPayment')`:
   - `'deny'` -- immediately rejected.
   - `'allow'` -- proceeds to payment.
   - `'ask'` -- queues a prompt via `signer.queueRequest()` with `type: 'webln_sendPayment'`. The user sees an approval popup and can approve/deny, optionally with "remember" to save the decision for future requests from that origin.
4. **Provider connection** -- if the provider is not connected, `connect()` is called.
5. **Payment execution** -- `provider.payInvoice(bolt11)` sends the payment.

The auto-approve threshold (`walletThreshold_{accountId}`) is stored in `browser.storage.local` and managed via `wallet_setAutoApproveThreshold` / `wallet_getAutoApproveThreshold` privileged methods.

---

## 8d. Post-Quantum Key Derivation (`src/services/background/pqc-handlers.ts`)

Post-quantum keys are derived from the BIP-39 seed as **siblings** of the secp256k1 key,
never from the private key itself. This is the property the scheme depends on: deriving
`pq = KDF(nsec)` would be circular, since an adversary who recovers `nsec` from `npub` could
repeat the derivation. Because BIP-32 and HKDF are one-way, recovering the secp256k1 private
key reveals nothing about the seed and therefore nothing about the post-quantum keys.
`tests/crypto/pq.test.ts` asserts the two derivations differ, so a refactor cannot silently
reintroduce the circularity.

Keys are **not stored**. They are recomputed from the vault's mnemonic when requested, which
avoids a vault migration and keeps additional secret material out of storage entirely.
Within the handler, ML-KEM and ML-DSA secret keys are zeroed immediately after use and the
seed is zeroed in a `finally` block. The response contains public keys only; a test asserts
no secret material appears in it.

Derivation requires a 24-word (256-bit) mnemonic. A 12-word mnemonic would mechanically
work, but carries 128 bits of entropy — the seed, not the algorithm, would bound the
security — so those accounts are refused with `reason: 'short-seed'` and pointed at an
independently generated key instead.

## 9. Rate Limiting

- **Per-origin pending-request cap** (`src/services/signing/approvalQueue.ts`): an origin may have at most 5 actionable signer prompts pending at once (`MAX_PENDING_PER_ORIGIN`). Further `queueRequest` calls from that origin throw `Too many pending requests from this origin`, blunting popup-spam / DoS from a connected tab. NIP-46 in-flight tracking entries and unlock markers are exempt (they need no user action); resolving prompts frees capacity.
- **`vault_unlock`** is protected by the privilege gate (only callable from extension pages), PBKDF2's 600,000 iterations (~600ms per attempt), and the persisted background-side failed-attempt lockout described in [§1 Brute-force protection](#1-vault----srclibvaultts).

### 9b. Permission Resolution Is Deny-Wins

`permissions.check()` consults the kind-specific key, the method-level key, and the `*` wildcard. An explicit `deny` at ANY of those levels short-circuits to `deny` — a kind-specific or wildcard `allow` can never override a `deny` at another level. When no level denies, the most specific defined value wins. See [signer.md §5](signer.md#5-permission-cascade----srclibpermissionsts).

### 9c. Pending Onboarding TTL

The redacted pending-onboarding account is persisted to `browser.storage.session` together with a `_pendingOnboardingCreatedAt` timestamp. The 5-minute TTL is enforced **on read** in `getPendingOnboardingAccount()` — not only via the in-memory `setTimeout`, which dies with the MV3 service worker. Expired (or timestamp-less pre-upgrade) entries are wiped from session storage and never returned.

## Connecting a site

Connecting is one decision, made in one place. The "Connect this site" card calls the `connectDomain` RPC, which is the **only** writer of `allowedDomains` — and `allowedDomains` is what every consumer reads: the NIP-07 gate in `background.ts`, the identity shortcut in `src/services/signing/signer.ts`, the account-change broadcast, and the popup's own site state. One writer and one reader-of-record is what makes the list trustworthy.

The extension asks the browser for no host permissions. Up to 0.5.0 the Connect flow additionally requested `*://<site>/*`, which gated nothing — identity release is decided by the allowlist, and no NIP-07 path consults `permissions.contains` — while causing two bugs of its own: the browser's dialog dismissed the popup and lost the click, and recording the click before the dialog released the identity while it was still unanswered. The request is gone, and `releaseLegacyHostGrants()` hands back on startup whatever earlier versions were granted, so the browser stops listing those sites as ones this extension can read.

What remains is the install-time content-script declaration at `<all_urls>`. That is what puts `window.nostr` on the page, and it is the reason a site can reach the extension rather than the other way around; without it a Nostr client cannot tell the extension from one that is not installed. It is also the source of the "read and change all your data on all websites" warning at install — removing the runtime request does not change that warning, and nothing in the codebase reads page content.

**Disconnecting is a full revocation.** `removeAllowedDomain` clears the allowlist entry, the WebLN consent, and every stored signing rule for that domain across all account buckets. Leaving the rules behind used to make Disconnect a suggestion: the popup treated any site with stored permissions as connected and silently re-added it, and because the check counted any entry at all, a site whose only record was an explicit `deny` could be reconnected on a mere popup render.

**Declining a site has a lifetime the user picks.** "Not now" used to mean never, silently and invisibly: the domain went into a plain array, `background.ts` rejected it before the connect gate forever, nothing in the UI listed it, and the only escape was discovering that connecting cleared it. A dismissal now carries an expiry — the configured duration, `'session'` (kept in `storage.session`, so it ends with the browser), or `'never'` from the explicit Never button — and every one of them, permanent included, is listed in Settings → Permissions with an undo. Permanence is a visible state rather than folklore. Records written by older builds are migrated with their clock starting at migration rather than expiring instantly, so a site silenced yesterday is not resurrected by an upgrade.

**Wallet access is a separate consent and is asked for separately.** A site connected over NIP-07 has agreed to share an identity, not a balance. `webln_enable` grants wallet access only when the user answered a prompt raised by that call — either the Connect card shown because of it, or an explicit approval when the site was already connected. An already-connected site used to fall straight through and record consent silently.

**S-6 covers every secret, not just the privkey.** The account's `privkey`, `mnemonic`, and `nip46Config.localPrivkey` are collected into one blob, XOR-split against a random pad, and stored as `_pendingOnboardingSecrets` + `_pendingOnboardingSecretsPad`, with all three fields nulled on the stored account. Earlier builds split the privkey alone and wrote the mnemonic beside it in the clear — the more valuable secret of the two, since it restores every derived account. That mattered most on Safari, where `storage.session` is shimmed onto `storage.local` (`src/lib/browser.ts`) and therefore lands on disk. Records in the old privkey-only shape are treated as expired rather than read back.

Because the Safari shim persists, `background.ts` also calls `cleanupExpiredPendingOnboarding()` on startup: an abandoned onboarding is swept instead of waiting for a read that may never come. A record still inside its TTL is left alone, since on Chrome the service worker restarts constantly during a live onboarding.

---

## 10. Profile Verification

When fetching kind:0 profile metadata, events are validated for matching `event.pubkey` and `event.kind` before being cached:

```ts
if (event.pubkey !== pubkey || event.kind !== 0) return;
```

---

## 11. Data Sanitization

When returning account objects from public APIs, sensitive fields are stripped:

```ts
const { privkeyBytes, mnemonicBytes, ...safe } = acct;
return safe;
```

`getActiveAccount()`, `getAccountById()`, and `listAccounts()` all strip key bytes. `getDecryptedPayload()` reconstructs hex format for JSON export but is only callable when unlocked.

---

## 12. Relay Event Integrity (`src/services/relays/relay.ts`)

Relays are untrusted. Every inbound event consumed through `liveQuery` is
schnorr-signature-verified with `verifyEvent()` (`src/lib/crypto/nip01.ts` —
recomputed event id + BIP-340 signature check) before it is emitted, displayed,
or cached. Verification happens **before** the event id is added to the dedup
set, so a forged event cannot shadow a later legitimate event with the same id.

The local replaceable-event cache is verified on both sides:

- `writeLocalCache()` refuses to persist any event that fails `verifyEvent()`.
- `readLocalCache()` re-verifies on read, so stale entries written before
  verification existed (or tampered storage) are never surfaced.

Per-socket message handling is serialized (promise chain) so async verification
preserves relay ordering — an `EOSE` can't exhaust the query while an event is
still being verified.

### 12.1 The readers that bypassed it (`src/services/background/profile-handlers.ts`)

`liveQuery` is not the only way this extension reads from a relay. Two readers open their own sockets — `fetchKind0Read` (profile) and `fetchMuteList` (NIP-51 kind:10000) — and both accepted events on `pubkey` and `kind` alone. Those are fields the relay asserts; they are only meaningful once the signature over them is checked, so any relay could serve a document attributed to anyone, with a `created_at` high enough to win the "newest wins" comparison.

The consequence was worse than a wrong display, because both feed a read-modify-write of a **replaceable** event that the user then re-signs:

- `fetchKind0Read` backs `getProfileForMerge`, which the wallet's "Add to profile" merges into and republishes. A forged `kind:0` carrying the attacker's `lud16` would redirect the user's zaps — signed by the user.
- `fetchMuteList` supplies the `rawContent` that `publishMuteList` writes back verbatim as the user's NIP-44-encrypted **private mutes**. A forgery replaces them with ciphertext the relay chose.

Both now verify through a shared `acceptedEvent()` (id + `verifyEvent()`) before an event is considered at all.

**A relay that served an unverifiable event cannot then vouch for emptiness.** Rejecting the forgery is not sufficient on its own: these readers also report `reachable`, and `reachable: true` with null/empty data means "a relay authoritatively says you have nothing — safe to overwrite". A hostile relay could therefore serve garbage followed by `EOSE` and still get the profile destroyed. Each socket now carries its own record, and `reachable` counts only sockets that answered *and* never served an invalid event.

`tests/profile-read.test.ts` pins both properties, including forgeries that keep a valid signature and mutate the body.

---

## 13. NWC Response Hardening (`src/services/wallet/nwc.ts`)

Kind-23195 NWC responses are only trusted when all of the following hold:

1. `event.pubkey` equals the wallet service pubkey from the connection string.
2. The event passes `verifyEvent()` (schnorr signature) — a malicious relay
   cannot forge a response by just stamping the wallet's pubkey on an event.
3. The content decrypts successfully with the connection secret.

The pending-request entry is only deleted after a verified, decryptable
response arrives — an injected garbage event can no longer consume the pending
slot and drop the wallet's real response (previously a response-DoS vector).
`make_invoice` amounts are converted sats → millisatoshis per NIP-47.

---

## 14. Relay Health Check SSRF Guard (`src/services/background/publish-handlers.ts`)

`checkRelayHealth` only probes URLs that start with `ws://`/`wss://` and whose
host is not private: `localhost`, `*.local`, `[::1]`, `0.0.0.0/8`,
`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and
`169.254.0.0/16` are all rejected (`isPrivateHost()`) before any fetch, so the
handler cannot be used to probe the local machine or internal network. The
probe keeps its 5-second timeout.

---

## 15. LNbits Transport Security (`src/services/wallet/lnbits.ts`)

Every LNbits request calls `assertSecureUrl()` first: the admin key
(`X-Api-Key`) is only ever sent over `https://`, with a development exception
for `http://localhost` / `http://127.0.0.1` (exact hostname match). Any other
non-HTTPS instance URL throws instead of leaking the key in cleartext.

---

## 16. Untrusted Image URLs (`src/utils/safeUrl.ts`)

Relay-supplied profile metadata (`picture`, `banner`) is sanitized with
`safeImageUrl()` before being rendered in an `<img src>`: only absolute
`http:`/`https:` URLs pass; `javascript:`, `data:`, `blob:`, `vbscript:`,
relative paths, and obfuscated-scheme tricks return `undefined` (the WHATWG URL
parser normalizes case/whitespace/control characters first). Applied centrally
in the `Avatar` component plus the direct `<img>` sites (`ProfilePreview`
banner, `EditProfileOverlay`). Locally-created `blob:` object URLs used for
upload previews are exempt because they never come from relay data.

---

## 17. LNURL-pay Hardening (`src/services/wallet/lnurl.ts`)

Paying a Lightning Address or pasted LNURL makes the background service worker — the context
holding the wallet's admin key — fetch a URL derived from user input, then a
second URL chosen by that first server. Both are treated as untrusted:

- **`assertPublicHttpsUrl()`** runs on the well-known URL *and* on the callback
  the endpoint returns. `https://` only (no localhost exception here — unlike
  LNbits, there is no development target to reach), and it rejects `localhost`,
  `*.local`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and every bare IP
  literal. A pasted "address" cannot be used to probe the local machine or the
  user's network.

  The IPv6 private ranges (`::1`, `fc00::/7`, `fe80::/10`) are covered by the
  bare-literal rule rather than by a range test: an IPv6 literal is the only
  hostname that may contain a colon, so requiring a *name* excludes all of them
  at once. An earlier version prefix-matched hostnames for `fc`/`fd`, reaching
  for unique-local addresses; because it ran against every hostname it rejected
  real domains — `fdn.fr`, `fc2.com`, `fdroid.org` — as private endpoints.
  Matching a name against an address range is a category error.
- **Redirects are refused, not followed** (`redirect: 'error'`).
  `assertPublicHttpsUrl` vouches for the URL being requested and can say nothing
  about wherever a `302` points; following one would let an endpoint that passed
  the check hand back an internal address and walk the fetch straight inside.
  This is what makes "the endpoint cannot redirect the second hop inward" true.
- **Every request is bounded in time**, 15s via `AbortSignal.timeout`, so an
  endpoint that accepts a connection and then says nothing cannot hold the
  service worker open.
- **The user's amount is the amount.** The invoice returned by the callback is
  decoded and its amount compared to the approved amount; a mismatch, an
  undecodable invoice, or an amountless invoice throws and nothing is paid. A
  hostile or compromised LNURL server therefore cannot set the price.
- **Range and comment limits** come from the endpoint's own `minSendable`,
  `maxSendable`, and `commentAllowed`, enforced client-side before any callback
  request; `commentAllowed` is itself capped at 1000 characters.
- **Bounded responses**: 64 KB cap on the body, enforced *while reading* — the
  declared `Content-Length` is checked first, then the stream is read chunk by
  chunk and cancelled the moment it exceeds the cap. Measuring after buffering
  would only decline to parse a body already pulled into the worker. JSON-object
  shape required, LUD-06 `{ status: "ERROR", reason }` surfaced (truncated to
  200 chars).
- **No callback in the popup's hands.** `wallet_resolveLightningAddress`
  returns display fields only, and `wallet_payToLightningAddress` re-resolves
  the address itself, so the endpoint that was shown is the endpoint that is
  paid.

Both handlers are privileged (extension pages only) — the port listener still
rejects everything that is not `nip07_`/`webln_`, so a page cannot reach them.


### Mute-list editing and startup

`getMyMuteList` waits for startup auto-unlock before reading the active identity,
and rejects a locked vault. A Never-lock cold start must not masquerade as an
account with no published mutes. The explicit editor request uses `{ fresh: true }`
to bypass the Home summary cache and fetch the newest verified NIP-51 kind:10000
from the configured relays before editing. Its raw encrypted content is preserved
verbatim. Relay failure, a missing event, an empty event and private-only entries
have separate UI states; private entries are not decrypted or counted by this editor.

## Activity decryption

Activity review uses a privileged internal `activity_decrypt` RPC tied to an existing stored log entry, never a page-provided arbitrary ciphertext. The handler waits for startup auto-unlock and requires an unlocked vault. It resolves the recorded account and uses `withPrivkey` plus the existing NIP-04/NIP-44/PQ decoders; it never switches identities or grants site permissions. Gift-wrap inner seals are signature-verified before their author is used for second-layer decryption. PQ decoding loads the recorded account’s derived/imported keys, and zeroes temporary secret key copies. Remote signer keys are not requested through this local review path.

Successful crypto activity now saves ciphertext only (128 KiB maximum per operation); plaintext request inputs and decrypt outputs are excluded. Old history without a body remains unavailable. Revealed plaintext lives only in the detail component and clears on hide, closing the detail view, or vault lock-state changes. A generation guard discards replies arriving after unmount or lock.

### Wallet display snapshots

Account-scoped `walletDisplay_` records now use authenticated AES-256-GCM envelopes. Their balance, timestamps and transaction summaries (hash, amount, fee, memo, status, time) are encrypted with a random cache key protected by the vault. Only provider presence remains public. Credentials, invoices and preimages remain excluded from display summaries. Activity records and payment replay results are also encrypted. The storage key is authenticated as associated data, preventing cross-account record substitution. Legacy financial/activity records migrate on unlock; reads fail closed on invalid ciphertext. Cache encryption is blocked until a newly generated key is durably saved in the vault. Password changes preserve it. Lock clears decrypted UI state; account removal clears its display cache, and vault destruction removes encrypted records. Payment retry markers survive lock, with encrypted results, so losing access cannot trigger another payment. JavaScript strings cannot be reliably erased; this protects stored data rather than a compromised running process. Never-lock mode still permits automatic local decryption. See [private cache design](private-cache.md).

Approval queue identity checks: requests are bound to an account ID. The extension popup displays pending requests from all websites for that account, never treating a website filter as an account boundary. Foreign account/author entries are rejected (remote-signer and unlock waits use their respective cancellation methods). Individual and permission-batch resolution recheck account identity in the background. signEvent rejects a supplied foreign author before permission checks and rechecks the account/public key before signing. Recipient keys in encryption/decryption requests are not author keys. Bulk approval acts only on a snapshot of displayed request IDs.

Pasted LNURLs are checksum-validated bech32 with strict UTF-8 decoding and a
2,000-character limit. Mixed case is rejected before normalization. Decoded URLs
pass the same HTTPS/public-host guard; embedded URL credentials are refused.
Only `payRequest` responses proceed to payment.

Vault implementation boundaries: encryption and byte serialization live in
`services/vault/encryption.ts` and `serialization.ts`; account and imported-key
operations are constructed with capabilities from the private vault session.
The split does not export the mutable session or add another session instance.
Existing lock zeroing, copied-key cleanup, KDF migration and save behavior remain
in place. Signer queue/account rejection lives in `approvalQueue.ts`, while local
classic/PQ decryption lives in `localDecryption.ts`.

Wallet operations enforce lock state through `vault.requireUnlocked()`: it waits for the registered startup auto-unlock, then rejects if the vault remains locked. This never unlocks a password-protected vault on its own. Current failed UI vault reads still fail closed; only responses from retired reads are discarded.


### Custom derivation paths

BIP-32 paths are validated in both the UI and privileged generation handler:
hardened markers are normalized, indices must be 0..2147483647, and depth is
limited to 255. Derivation reuses @scure/bip32 and temporary seed/key bytes are
zeroed. Validation follows [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki).
Network hints use the [SLIP-44 registry](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
and Bitcoin purpose conventions; a recognized prefix does not promise wallet compatibility.

Existing accounts without path metadata retain their numeric PQ selector.
Paths in the extension's existing m/44'/1237'/0'/0/index sequence map to that same
numeric selector, preserving existing keys. Other paths use the canonical full
path under a separate path/ selector in the HKDF info string. This prevents
different paths sharing a last child index from reusing PQ keys. This custom-path
extension is documented in the local PQ draft; recovery in another implementation
requires that convention or an exported PQ key file. Status, export and decryption
all use the same selector. Classic and PQ recovery require the seed and exact path.

Removing a seed-derived account does not remove its seed from other derived
accounts, which each retain the mnemonic in the encrypted vault. Removing all
accounts carrying that seed removes its stored account copies from this extension;
it does not revoke identities or erase external backups.

### September 2026 audit remediation (A1–A7)

Every signing/crypto operation captures an account ID and vault session revision.
Lock, account changes (including A → B → A), account removal and wallet configuration
replacement invalidate old revisions. Local operations check immediately before key
use and before returning asynchronous results. Remote signer continuations also
check before dispatch after connection. Requests waiting for an initial unlock can
continue; a newer explicit lock cancels them. Session invalidation disposes wallet providers and remote signers. Vault lock
notifications also revoke approvals for both timed and manual locks.

Vault lifecycle writes share a mutex. Unlock/create/re-encryption validate their
revision before installing decrypted state, so an earlier operation cannot undo a
newer lock. Destruction waits for preceding storage writes before removing the vault.
A session revision is an in-memory cancellation capability, never a secret or a
persisted substitute for the vault key.

WebLN checks and remembered rules use the same captured account as the payment,
threshold and approval. An explicit account-specific deny wins. The final dispatch
checks account/session and provider identity; stale connection or LNURL resolution
cannot spend from a previous wallet. The configured threshold is both a **per-invoice limit** and a **rolling 24-hour automatic-payment budget** shared across origins. Failed or uncertain reservations still count; explicit approvals can exceed the automatic allowance. Payments already dispatched to a backend cannot be recalled.

Authenticated wallet/provisioning requests require HTTPS (only explicit localhost or
127.0.0.1 HTTP is permitted for development), reject redirects, and use a 15-second
whole-request deadline and 1 MiB streaming response limit. Validation occurs before
challenge signing or any provisioning request. LNbits/NWC disposal is permanent;
retained references cannot reconnect or spend, and disposal clears retained key
material and cancels pending work. JavaScript string copies cannot be reliably zeroed.

Page RPC work is bounded to 64 outstanding requests per origin and 256 globally,
shared across ports, tabs and runtime messages. Capacity is released on actual
settlement rather than disconnect, so reconnecting cannot evade the bound. Queue
tracking has the same overall bounds; the existing five actionable prompts per
origin remains. Unlock markers remain individually cancellable, with bounded
pollers/timers. Canceled remote UI requests continue occupying remote capacity until
the underlying bunker operation settles.

Canonical event input is capped at 1 MiB UTF-8 JSON, 10,000 tags and 1,024 values per
tag. Crypto plaintext is capped at 65,535 UTF-8 bytes; ciphertext has a 131,072-character
ingress cap and algorithm-specific encoded limits before decoding. Activity retention
is capped at 256 KiB per entry, 4 MiB total and 2,000 entries, in addition to the
200-per-domain limit. Activity and wallet display records use a separate encrypted store whose key is protected by the vault; these retention limits apply to their decrypted contents.

### Follow-up hardening

Safe account RPC responses use an explicit metadata allowlist, excluding wallet and remote-signer credentials; only dedicated background accessors retrieve them. Page permissions bind to scheme, hostname and port, and existing hostname grants retain their prior scope and continue without reconnection or reapproval. LNURL payment policy requires exact integer-msat equality and adds no metadata-hash requirement beyond current LUD-06; description-only invoices remain supported. GitHub Actions are pinned to verified commits and use contents:read. See [payment policy](payment-hardening.md), [origin migration](origin-permissions.md), and [safe account data](safe-account-data.md).

### Password-encrypted PQ key import

PQ key import accepts both plain key files and the password-encrypted export envelope.
Selecting or pasting an encrypted file reveals a password field. Decryption reuses
the AES-GCM backup implementation; authentication failures leave the file available
for retry and do not call the import RPC. The decrypted key file then passes through
the existing privileged key-pair validation. Neither the password nor decrypted
contents are persisted by the import form; both fields clear on success.

The account wizard also accepts this encrypted envelope for seed/private-key
backups, from a selected file or pasted text. After authenticated decryption it
uses the existing mnemonic/private-key validators. PQ-only JSON produces guidance
to restore the keys in Settings after creating/importing the classical account;
it cannot create a Nostr identity. A nested ncryptsec prompts for its own password.
The wizard clears imported text and the password after successful validation and
ignores retired async results after unmount.

### Experimental WoT (0.8.0)

WoT is opt-in and off by default, including upgrades. Queries require existing
site/identity consent and obey page-request budgets. Only menu RPCs configure
or sync it. Oracle settings disclose public-key transmission; HTTPS, no redirects,
no cookies, bounded bodies and timeouts apply. Account/settings changes and site
revocation prevent stale results. Public graph snapshots are account-scoped;
automatic refresh requires separate consent and runs only for the active account. See [WoT](wot.md) for limits and storage behavior.

Experimental WoT locally decrypts the active account’s private mute list when available. It does not persist or transmit the plaintext list. Score queries can reveal mute decisions indirectly; the opt-in notice discloses this. See `wot.md` for incomplete-list and oracle-path limitations.

The popup-only score explanation and database inventory/management RPCs are not part of the website WoT surface. Per-type remembered approval choices reuse existing origin, permission and account/global scoping; clicking an ordinary Approve/Reject action never saves a standing rule. See [the 0.8.0 audit](audits/2026-09-20.md) and [WoT proposal privacy semantics](../nips/wot/02-scoring-and-data.md).
