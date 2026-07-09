# Test Suite

Tests use **Node.js built-in test runner** (`node:test`, Node 20+) with the `tsx` loader for TypeScript. No build step required for testing.

## 1. Running Tests

```bash
# All tests
./tests/run.sh

# Crypto tests only (no browser mock needed)
node --import tsx --test tests/crypto/*.test.ts

# Wizard state machine + popup-gating tests (pure functions, no browser mock needed)
node --import tsx --test tests/wizardMachine.test.ts tests/openPopupForActiveTab.test.ts

# Module tests (need browser mock)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts

# Wallet tests (mix of pure functions and browser-mocked tests)
node --import tsx --test tests/wallet/bolt11.test.ts tests/inject-webln.test.ts
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/nwc.test.ts tests/wallet/lnbits.test.ts tests/wallet/lnbits-provision.test.ts tests/wallet/background-handlers.test.ts tests/wallet/permissions.test.ts tests/wallet/approval.test.ts tests/wallet/types.test.ts tests/wallet/index.test.ts
```

`tests/run.sh` runs these groups in sequence: crypto, wallet (no-mock),
wizardMachine + openPopupForActiveTab + safeUrl, then the browser-mocked module +
wallet group (vault, permissions, accounts, signer, security-hardening,
communication, wallet permissions/background-handlers, vault-wallet, relay,
publish-handlers). Some additional test files exist in the tree
(`domain-handlers`, `site-state`) that are not part of the default `run.sh`
sequence.

---

## 2. Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/crypto/secp256k1.test.ts` | Elliptic curve math, scalar multiplication, public key derivation |
| `tests/crypto/schnorr.test.ts` | BIP-340 Schnorr signature create/verify |
| `tests/crypto/nip01.test.ts` | Event ID computation, event signing |
| `tests/crypto/nip04.test.ts` | NIP-04 encrypt/decrypt, error normalization |
| `tests/crypto/nip44.test.ts` | NIP-44 v2 encrypt/decrypt |
| `tests/crypto/bip32.test.ts` | HD key derivation, hardened/non-hardened children |
| `tests/crypto/bip39.test.ts` | Mnemonic generation, seed derivation |
| `tests/crypto/bech32.test.ts` | Bech32 encoding/decoding, npub/nsec |
| `tests/crypto/utils.test.ts` | Hex/bytes conversion |
| `tests/crypto/security.test.ts` | Security-focused crypto tests |
| `tests/vault.test.ts` | Vault create/unlock/lock, encryption integrity, account management, private key security |
| `tests/permissions.test.ts` | Permission cascade, isolation, save/clear, NIP-07 methods |
| `tests/accounts.test.ts` | Account creation (mnemonic, nsec, npub, nip46), type coverage |
| `tests/signer.test.ts` | NIP-07 signing flow, permission checks, pending request lifecycle |
| `tests/security-hardening.test.ts` | NIP-49 zeroing, NIP-04 error normalization, vault reEncrypt, lock zeroing, batch 1-2 regression |
| `tests/communication.test.ts` | Full communication test suite (see below) |
| `tests/wizardMachine.test.ts` | Onboarding wizard state machine transitions |
| `tests/openPopupForActiveTab.test.ts` | Popup-opening gating (opens only for the active tab) |
| `tests/inject-webln.test.ts` | Injected `window.webln` provider surface |
| `tests/domain-handlers.test.ts` | Domain allowlist / identity-disable handlers (not in default `run.sh`) |
| `tests/relay.test.ts` | Relay utilities, liveQuery streaming, inbound event signature verification (forged events rejected), exhaustion when relays close without EOSE |
| `tests/rpc.test.ts` | Popup `rpc()` transport: envelope unwrapping, Chrome wakeup-rejection retry, Safari undefined-response retry (throws `RpcError` instead of resolving `undefined`) |
| `tests/delete-recreate.test.ts` | Delete last account / destroy vault → re-run onboarding (`onboarding_generateAccount` + `onboarding_createVault`), incl. simulated service-worker restart |
| `tests/publish-handlers.test.ts` | `checkRelayHealth` SSRF hardening (scheme allowlist, private-host rejection) |
| `tests/safeUrl.test.ts` | `safeImageUrl` sanitizer for untrusted profile image URLs |
| `tests/site-state.test.ts` | Per-site state helpers (not in default `run.sh`) |
| `tests/wallet/nwc.test.ts` | NWC provider: connection, balance, pay, make invoice (msats), response verification/DoS hardening |
| `tests/wallet/lnbits.test.ts` | LNbits provider: REST API calls, error handling, HTTPS enforcement |
| `tests/wallet/lnbits-provision.test.ts` | Auto-provisioning: challenge-response flow |
| `tests/wallet/bolt11.test.ts` | BOLT11 decoder: amount parsing, descriptions, expiry, networks |
| `tests/wallet/background-handlers.test.ts` | Wallet background RPC handlers |
| `tests/wallet/permissions.test.ts` | Wallet permission checks |
| `tests/wallet/approval.test.ts` | Payment approval flow |
| `tests/wallet/types.test.ts` | WalletConfig type guards |
| `tests/wallet/index.test.ts` | Provider factory and caching |

---

## 3. Communication Test Suite (`tests/communication.test.ts`)

The most comprehensive test file, with 117 tests across 22 suites covering 6 layers:

| Layer | Suites | Tests | What it covers |
|-------|--------|-------|----------------|
| 1. Content Script Validation | 3 | 13 | NIP-07/WebLN allowlists, HTTPS enforcement, method prefixing, channel isolation |
| 2. Background Handler | 2 | 23 | Privilege gate, `validateNip07Params` (event shape, pubkey format) |
| 3. End-to-End Flow | 4 | 10 | getPublicKey + signEvent round-trips, error propagation, message shapes |
| 4. Account Switching | 3 | 13 | Vault state transitions, pending rejection, pubkey/key after switch |
| 5. Vault Locked | 3 | 21 | All vault APIs when locked, signer behavior, pending request lifecycle |
| 6. Permissions x Lock | 4 | 29 | Full permission/lock matrix, kind/domain isolation, wildcard deny, cascade |

---

## 4. Test Infrastructure

| File | Purpose |
|------|---------|
| `tests/helpers/browser-mock.ts` | In-memory mock for `browser.storage.{local,sync,session}`, `browser.runtime`, `browser.action`, `browser.tabs` |
| `tests/helpers/register-mocks.ts` | Registers the browser mock via Node.js module loader hooks |
| `tests/helpers/loader-hooks.ts` | Custom loader that intercepts `lib/browser.ts` imports and redirects to the mock |
| `tests/run.sh` | Shell script to run all test groups in sequence |
