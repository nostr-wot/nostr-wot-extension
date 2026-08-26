# Security

## 1. Vault -- `lib/vault.ts`

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

**Auto-lock**: Configurable timeout (default 15 minutes / 900,000ms). When the timer fires, `lock()` zeroes all in-memory key material and sets `_decrypted = null` and `_cryptoKey = null`. The background script also calls `clearWalletProviders()` on lock to disconnect and discard cached wallet provider instances. On Chrome, service worker termination also naturally clears memory. When the vault auto-locks, a full-screen overlay blocks all UI until the password is entered.

The configured interval is stored as `autoLockMs` in `browser.storage.local`, but `_autoLockMs` is module-level in-memory state that resets to the 15-minute default on every service-worker cold start. `restoreAutoLockSetting()` re-reads the persisted `autoLockMs` (defaulting to 15 min when absent) and re-arms the timer; it is called on background startup and after every successful `vault_unlock`, so the user's chosen interval — not the default — governs locking after the SW restarts (bug #10).

**"Never lock" auto-unlock and the cold-start window**: with `autoLockMs === 0` the vault is stored under an empty password and `background.ts` re-unlocks it on every service-worker cold start. That unlock is asynchronous — a storage read plus PBKDF2 at 210,000 iterations — so `isLocked()` reports **locked** for a few hundred milliseconds after every startup, and no keep-alive alarm is armed in this mode (`armKeepAlive()` returns early when `_autoLockMs <= 0`), so Chrome tears the worker down after ~30s idle and cold starts are routine. The startup sequence is therefore registered via `vault.beginStartupUnlock()`, and request paths (`waitForVaultUnlock()` in `lib/signer.ts`) `await vault.whenStartupUnlockSettled()` before concluding the vault is locked. Without that gate a `signEvent` arriving inside the window queued an unlock marker and auto-opened the action popup — showing an empty popup on requests the user's saved `allow` permission had already approved.

**Service-worker keep-alive**: On Chrome MV3 the service worker is torn down frequently (including around page refreshes), which wipes the in-memory decrypted key and makes a timed-mode vault appear locked well before the configured interval. While the vault is unlocked in timed-lock mode (`autoLockMs > 0`), `vault.ts` arms a periodic `browser.alarms` keep-alive (`'vault-keepalive'`, ~30s period — Chrome clamps the minimum). The `onAlarm` listener in `background.ts` does a trivial async storage read on each tick, resetting the SW idle timer so the worker stays alive until the auto-lock actually fires. The alarm is cleared on every `lock()` and is **never** used to persist the decrypted key — it only holds the worker open, preserving the security model. It is a graceful no-op where `browser.alarms` is unavailable (Safari's persistent background page, tests).

**Brute-force protection**: Two layers with the same escalation schedule (every 5 consecutive failures: 1 min, 5 min, 15 min, 30 min cap):

1. **Popup-side** — the `useVaultUnlock` hook displays the countdown and disables the input during lockout. Module-level state, so remounting components does not reset it; it does reset on full page reload.
2. **Background-side (authoritative)** — the `vault_unlock` handler (`lib/bg/vault-handlers.ts`) keeps a persisted failure counter in `browser.storage.local` under `vaultUnlockGuard { failures, lockedUntil }`. While `lockedUntil` is in the future, `vault_unlock` throws `Too many failed attempts. Try again in Ns` without attempting decryption — even for the correct password. A failed attempt increments the counter; a successful unlock removes the guard; `vault_destroy` clears it. Because it is persisted, popup reloads and service-worker restarts do not reset it.

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

The same try/finally discipline applies in `lib/accounts.ts` and the vault handlers:

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

## 5. NIP-49 Zeroing (`lib/crypto/nip49.ts`)

- **`ncryptsecEncode`**: The input `privkeyBytes` is zeroed in a `finally` block after encryption.
- **`ncryptsecDecode`**: The decrypted `Uint8Array` view is zeroed after extracting the hex string.

---

## 6. NIP-04 Error Normalization (`lib/crypto/nip04.ts`)

AES-CBC decrypt errors are caught and re-thrown as a generic `"Decryption failed"` message. This prevents padding oracle attacks where different error messages for "wrong padding" vs "wrong key" would leak information about the plaintext.

---

## 7. NIP-46 Connect Secret (`lib/nip46.ts`)

The `nostrconnect://` QR code flow includes a `connectSecret` parameter:
- A random 16-byte hex string is generated and included in the QR URI
- The `Nip46Client` validates that the incoming connect request's `params[1]` matches the secret
- After successful validation, the secret is cleared (one-time use)
- Requests with wrong or missing secrets are silently ignored

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

## 8d. Post-Quantum Key Derivation (`lib/bg/pqc-handlers.ts`)

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

- **Per-origin pending-request cap** (`lib/signer.ts`): an origin may have at most 5 actionable signer prompts pending at once (`MAX_PENDING_PER_ORIGIN`). Further `queueRequest` calls from that origin throw `Too many pending requests from this origin`, blunting popup-spam / DoS from a connected tab. NIP-46 in-flight tracking entries and unlock markers are exempt (they need no user action); resolving prompts frees capacity.
- **`vault_unlock`** is protected by the privilege gate (only callable from extension pages), PBKDF2's 600,000 iterations (~600ms per attempt), and the persisted background-side failed-attempt lockout described in [§1 Brute-force protection](#1-vault----libvaultts).

### 9b. Permission Resolution Is Deny-Wins

`permissions.check()` consults the kind-specific key, the method-level key, and the `*` wildcard. An explicit `deny` at ANY of those levels short-circuits to `deny` — a kind-specific or wildcard `allow` can never override a `deny` at another level. When no level denies, the most specific defined value wins. See [signer.md §5](signer.md#5-permission-cascade----libpermissionsts).

### 9c. Pending Onboarding TTL

The redacted pending-onboarding account is persisted to `browser.storage.session` together with a `_pendingOnboardingCreatedAt` timestamp. The 5-minute TTL is enforced **on read** in `getPendingOnboardingAccount()` — not only via the in-memory `setTimeout`, which dies with the MV3 service worker. Expired (or timestamp-less pre-upgrade) entries are wiped from session storage and never returned.

## Connecting a site

Connecting is one decision, made in one place. The "Connect this site" card calls the `connectDomain` RPC, which is the **only** writer of `allowedDomains` — and `allowedDomains` is what every consumer reads: the NIP-07 gate in `background.ts`, the identity shortcut in `lib/signer.ts`, the account-change broadcast, and the popup's own site state. One writer and one reader-of-record is what makes the list trustworthy.

The extension asks the browser for no host permissions. Up to 0.5.0 the Connect flow additionally requested `*://<site>/*`, which gated nothing — identity release is decided by the allowlist, and no NIP-07 path consults `permissions.contains` — while causing two bugs of its own: the browser's dialog dismissed the popup and lost the click, and recording the click before the dialog released the identity while it was still unanswered. The request is gone, and `releaseLegacyHostGrants()` hands back on startup whatever earlier versions were granted, so the browser stops listing those sites as ones this extension can read.

What remains is the install-time content-script declaration at `<all_urls>`. That is what puts `window.nostr` on the page, and it is the reason a site can reach the extension rather than the other way around; without it a Nostr client cannot tell the extension from one that is not installed. It is also the source of the "read and change all your data on all websites" warning at install — removing the runtime request does not change that warning, and nothing in the codebase reads page content.

**Disconnecting is a full revocation.** `removeAllowedDomain` clears the allowlist entry, the WebLN consent, and every stored signing rule for that domain across all account buckets. Leaving the rules behind used to make Disconnect a suggestion: the popup treated any site with stored permissions as connected and silently re-added it, and because the check counted any entry at all, a site whose only record was an explicit `deny` could be reconnected on a mere popup render.

**Declining a site has a lifetime the user picks.** "Not now" used to mean never, silently and invisibly: the domain went into a plain array, `background.ts` rejected it before the connect gate forever, nothing in the UI listed it, and the only escape was discovering that connecting cleared it. A dismissal now carries an expiry — the configured duration, `'session'` (kept in `storage.session`, so it ends with the browser), or `'never'` from the explicit Never button — and every one of them, permanent included, is listed in Settings → Permissions with an undo. Permanence is a visible state rather than folklore. Records written by older builds are migrated with their clock starting at migration rather than expiring instantly, so a site silenced yesterday is not resurrected by an upgrade.

**Wallet access is a separate consent and is asked for separately.** A site connected over NIP-07 has agreed to share an identity, not a balance. `webln_enable` grants wallet access only when the user answered a prompt raised by that call — either the Connect card shown because of it, or an explicit approval when the site was already connected. An already-connected site used to fall straight through and record consent silently.

**S-6 covers every secret, not just the privkey.** The account's `privkey`, `mnemonic`, and `nip46Config.localPrivkey` are collected into one blob, XOR-split against a random pad, and stored as `_pendingOnboardingSecrets` + `_pendingOnboardingSecretsPad`, with all three fields nulled on the stored account. Earlier builds split the privkey alone and wrote the mnemonic beside it in the clear — the more valuable secret of the two, since it restores every derived account. That mattered most on Safari, where `storage.session` is shimmed onto `storage.local` (`lib/browser.ts`) and therefore lands on disk. Records in the old privkey-only shape are treated as expired rather than read back.

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

## 12. Relay Event Integrity (`lib/relay.ts`)

Relays are untrusted. Every inbound event consumed through `liveQuery` is
schnorr-signature-verified with `verifyEvent()` (`lib/crypto/nip01.ts` —
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

---

## 13. NWC Response Hardening (`lib/wallet/nwc.ts`)

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

## 14. Relay Health Check SSRF Guard (`lib/bg/publish-handlers.ts`)

`checkRelayHealth` only probes URLs that start with `ws://`/`wss://` and whose
host is not private: `localhost`, `*.local`, `[::1]`, `0.0.0.0/8`,
`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and
`169.254.0.0/16` are all rejected (`isPrivateHost()`) before any fetch, so the
handler cannot be used to probe the local machine or internal network. The
probe keeps its 5-second timeout.

---

## 15. LNbits Transport Security (`lib/wallet/lnbits.ts`)

Every LNbits request calls `assertSecureUrl()` first: the admin key
(`X-Api-Key`) is only ever sent over `https://`, with a development exception
for `http://localhost` / `http://127.0.0.1` (exact hostname match). Any other
non-HTTPS instance URL throws instead of leaking the key in cleartext.

---

## 16. Untrusted Image URLs (`src/shared/safeUrl.ts`)

Relay-supplied profile metadata (`picture`, `banner`) is sanitized with
`safeImageUrl()` before being rendered in an `<img src>`: only absolute
`http:`/`https:` URLs pass; `javascript:`, `data:`, `blob:`, `vbscript:`,
relative paths, and obfuscated-scheme tricks return `undefined` (the WHATWG URL
parser normalizes case/whitespace/control characters first). Applied centrally
in the `Avatar` component plus the direct `<img>` sites (`ProfilePreview`
banner, `EditProfileOverlay`). Locally-created `blob:` object URLs used for
upload previews are exempt because they never come from relay data.

---

## 17. LNURL-pay Hardening (`lib/wallet/lnurl.ts`)

Paying a Lightning Address makes the background service worker — the context
holding the wallet's admin key — fetch a URL derived from user input, then a
second URL chosen by that first server. Both are treated as untrusted:

- **`assertPublicHttpsUrl()`** runs on the well-known URL *and* on the callback
  the endpoint returns. `https://` only (no localhost exception here — unlike
  LNbits, there is no development target to reach), and it rejects `localhost`,
  `*.local`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`,
  `fe80::/10`, and bare IP literals. A pasted "address" cannot be used to probe
  the local machine or the user's network, and the endpoint cannot redirect the
  second hop inward.
- **The user's amount is the amount.** The invoice returned by the callback is
  decoded and its amount compared to the approved amount; a mismatch, an
  undecodable invoice, or an amountless invoice throws and nothing is paid. A
  hostile or compromised LNURL server therefore cannot set the price.
- **Range and comment limits** come from the endpoint's own `minSendable`,
  `maxSendable`, and `commentAllowed`, enforced client-side before any callback
  request; `commentAllowed` is itself capped at 1000 characters.
- **Bounded responses**: 64 KB cap on the body, JSON-object shape required,
  LUD-06 `{ status: "ERROR", reason }` surfaced (truncated to 200 chars).
- **No callback in the popup's hands.** `wallet_resolveLightningAddress`
  returns display fields only, and `wallet_payToLightningAddress` re-resolves
  the address itself, so the endpoint that was shown is the endpoint that is
  paid.

Both handlers are privileged (extension pages only) — the port listener still
rejects everything that is not `nip07_`/`webln_`, so a page cannot reach them.
