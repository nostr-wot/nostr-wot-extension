# Security

## 1. Vault -- `lib/vault.ts`

The vault encrypts sensitive account data (private keys, mnemonics) at rest using Web Crypto APIs.

**Encryption scheme:**

1. User password fed to PBKDF2 with SHA-256, 210,000 iterations, random 32-byte salt, producing a 256-bit AES key.
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

On `unlock()`, hex strings are converted to `Uint8Array` via `toMemoryAccount()`. On `lock()`, every account's `privkeyBytes` and `mnemonicBytes` are zeroed with `.fill(0)` (`zeroDecryptedKeys()`) before the reference is nulled. This prevents hex strings (which are immutable JS strings and cannot be zeroed) from lingering in the GC heap.

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

This avoids the old `getDecryptedPayload()` + `lock()` + `create()` pattern which created an intermediate JSON copy with hex private key strings.

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
- **`vault_unlock`** is protected by the privilege gate (only callable from extension pages), PBKDF2's 210,000 iterations (~200ms per attempt), and the persisted background-side failed-attempt lockout described in [§1 Brute-force protection](#1-vault----libvaultts).

### 9b. Permission Resolution Is Deny-Wins

`permissions.check()` consults the kind-specific key, the method-level key, and the `*` wildcard. An explicit `deny` at ANY of those levels short-circuits to `deny` — a kind-specific or wildcard `allow` can never override a `deny` at another level. When no level denies, the most specific defined value wins. See [signer.md §5](signer.md#5-permission-cascade----libpermissionsts).

### 9c. Pending Onboarding TTL

The redacted pending-onboarding account (XOR-split privkey, S-6) is persisted to `browser.storage.session` together with a `_pendingOnboardingCreatedAt` timestamp. The 5-minute TTL is enforced **on read** in `getPendingOnboardingAccount()` — not only via the in-memory `setTimeout`, which dies with the MV3 service worker. Expired (or timestamp-less pre-upgrade) entries are wiped from session storage and never returned.

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
