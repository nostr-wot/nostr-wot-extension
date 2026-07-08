# Security

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately via GitHub's security advisory feature or by contacting the maintainers directly. Do not open a public issue.

## Threat Model

The extension handles sensitive cryptographic key material. The security design assumes:

- The user's device is not compromised
- The browser itself is trusted
- Web pages are untrusted and may be hostile

## Key Storage

Private keys are encrypted at rest using **AES-256-GCM**:

- Password-derived key via **PBKDF2** with SHA-256, **210,000 iterations**, and a random 32-byte salt
- Random 12-byte IV per encryption
- Stored in `browser.storage.local` as base64-encoded salt + IV + ciphertext

Keys are only decrypted in memory when the vault is explicitly unlocked.

## Auto-Lock

The vault auto-locks after a configurable period of inactivity (default: 15 minutes). On lock, all decrypted key material and the derived crypto key are set to `null`. On Chrome, service worker termination also clears memory.

## Private Key Zeroing

Every code path that accesses raw private key bytes follows a strict pattern:

```js
const privkey = vault.getPrivkey();
try {
    // use privkey
} finally {
    privkey.fill(0);
}
```

The `Uint8Array` is zeroed immediately after use, minimizing the window of exposure.

## Message Isolation

Three execution contexts with strict boundaries:

| Context | World | Access |
|---------|-------|--------|
| `inject.js` | MAIN (page) | Can only `postMessage` to content script |
| `content.js` | ISOLATED | Validates method names against allowlists before forwarding |
| `background.js` | Service worker | Handles all business logic, gated by sender verification |

Web pages cannot directly call background methods. All requests pass through the content script's method allowlist.

## Privileged Method Gating

Sensitive operations (vault, permissions, account management, sync, database operations) are restricted to internal extension pages:

```js
const isInternal = sender.id === browser.runtime.id && !sender.tab;
```

The `!sender.tab` check ensures the message originates from an extension page (popup, onboarding, prompt) and not from a content script running in a web page tab.

## Per-Account Isolation

Signing permissions and wallet configuration are keyed per account. Private keys and wallet secrets (LNbits admin key, NWC connection string) live only inside the AES-256-GCM vault and are stripped from the `SafeAccount` objects handed to the UI. Switching accounts clears any pending signer requests and the getPublicKey approval cooldown so one identity cannot inherit another's in-flight consent.

## NIP-07 Signing Permissions

Signing requests trigger a user-facing prompt window. Users can:

- Allow or deny individual requests
- Grant persistent permissions per domain, per method, or per event kind
- Revoke permissions at any time from the popup

Permission lookup follows a specificity cascade: kind-specific > method-level > domain wildcard > default (ask).

## Dependencies

The extension has **zero external runtime dependencies**. All cryptographic primitives (secp256k1, Schnorr, NIP-04, NIP-44, BIP-32, BIP-39) are implemented in pure JavaScript using the Web Crypto API where available.
