# Nostr WoT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

A browser extension for Nostr that manages your identity, signs events, and sends Lightning payments — all without leaving your browser. It is a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer, an encrypted key vault, a built-in Lightning/WebLN wallet, and a manager for your profile, mute list, and relays.

## Features

### Identity & Key Management

Create or import your Nostr identity and use it across any Nostr web client. The extension acts as a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer — sites request access, you approve or deny.

| Account Type | Description |
|--------------|-------------|
| **Generate new keys** | 24-word BIP-39 mnemonic with NIP-06 derivation — back up your seed phrase |
| **Import nsec** | Bring your existing private key |
| **Watch-only (npub)** | View-only — no signing |
| **NIP-46 Bunker** | Remote signing via `bunker://` URL |
| **External signer** | Delegate to another NIP-07 extension |

Signing requests show a permission prompt. Grant access once, per-domain, per-method, or per-event-kind.

### Encrypted Vault

Your private keys never leave the extension. They're encrypted at rest with **AES-256-GCM** (PBKDF2-SHA-256, 600,000 iterations) and only decrypted in memory when the vault is unlocked. An auto-lock timer clears everything after 15 minutes of inactivity (configurable, or set to "never"). Key bytes are zeroed immediately after each signing operation.

### Lightning Wallet & Zaps

Send and receive Lightning payments directly from the extension.

**Quick Setup** — One click provisions a Lightning wallet via [zaps.nostr-wot.com](https://zaps.nostr-wot.com). No registration — the extension authenticates with your Nostr identity.

**Manual Setup** — Connect your own wallet with a `nostr+walletconnect://` URI (NWC) or an LNbits instance URL + admin key.

Once connected:
- View your balance and transaction history
- Generate deposit invoices with QR codes
- Send payments by pasting a BOLT11 invoice
- Claim a Lightning Address like `you@zaps.nostr-wot.com`
- Copy your NWC connection URI to use in other apps
- Set an auto-approve threshold for small zaps

The extension exposes a standard [WebLN](https://www.webln.dev/) provider (`window.webln`), so Nostr clients that support zaps (like Primal) work out of the box.

### Profile, Mutes & Relays

From the popup you can manage the account-level data that follows you across clients:

- **Profile (kind:0)** — edit your display name, picture, and other NIP-01 metadata and publish it.
- **Mute list (NIP-51 kind:10000)** — manage your *own* mute list: mute people, words, and hashtags. The extension fetches your existing list from your relays, lets you edit it, and publishes a signed replaceable event. Private (NIP-44-encrypted) entries in the list content are preserved verbatim.
- **Relays (NIP-65 kind:10002)** — edit your read/write relay list (outbox model). Relay-aware clients read this through the standard NIP-07 `window.nostr.getRelays()`.

### Multi-Account Support

Switch between multiple identities. Each account has its own permissions, wallet, and profile/relay/mute data. Switching accounts is instant.

### Per-Site Controls

- Allow or block sites from accessing your identity
- Disable identity on specific sites
- Manage signing permissions per domain. Permissions can be **shared across all accounts** (the default) or **isolated per account**.

> **Note:** Earlier versions shipped an experimental Web-of-Trust trust-graph layer (oracles, follow-graph sync, trust scoring, a page-injected `window.nostr.wot` API, and trust badges). That subsystem has been removed. The extension now injects only the standard NIP-07 `window.nostr` and WebLN `window.webln` providers; relay data is read via `window.nostr.getRelays()`.

---

### Post-Quantum Keys

Nostr public keys are published to every relay they touch, and Shor's algorithm recovers a
private key from a public key. That means every encrypted DM sent today can be decrypted
later by anyone who archived it — the damage is already accruing.

The extension derives **ML-KEM-1024** and **ML-DSA-87** keys ([FIPS 203] / [FIPS 204]) from
the same 24-word seed phrase your Nostr key comes from. Crucially they are derived as
*siblings* of the secp256k1 key, never *from* it: recovering your Nostr private key reveals
nothing about the seed, so messages encrypted to your post-quantum key stay confidential
permanently. One mnemonic still restores everything — nothing extra to back up.

Open **Menu → Security → Post-quantum key** to see your keys and copy a ready-to-publish
`kind:10203` attestation. Or generate one offline:

```bash
npm run pqc:keygen
```

Requires a 24-word phrase. A 12-word phrase carries only 128 bits of entropy, which would
become the weakest link, so the extension refuses to label such keys as seed-derived and
explains the alternative instead.

**What this does not do:** it does not stop a quantum adversary forging events in your
name — events are still signed with secp256k1. It makes *past* messages permanently
confidential, which is the only half of the problem that cannot be fixed after the fact.

Message cost, measured on the full `kind:1059` gift wrap:

| message | classic NIP-17 | post-quantum | ratio |
|---|---|---|---|
| chat line (32 chars) | 1,701 B | 4,605 B | 2.7x |
| a tweet (280) | 2,213 B | 5,285 B | 2.4x |
| a paragraph (1 KB) | 3,921 B | 7,333 B | 1.9x |

About **3 KB constant overhead**, almost all of it the ML-KEM ciphertext. Encryption takes
~1.3 ms. See [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq)
for the wire format, the full size tables and the reference implementation.

[FIPS 203]: https://csrc.nist.gov/pubs/fips/203/final
[FIPS 204]: https://csrc.nist.gov/pubs/fips/204/final

---

## Seed Generation

This extension creates the seed phrase your entire identity rests on, so the path from randomness to words should be short enough to read in full and check yourself. It is:

1. `generateNewAccount()` calls `generateMnemonic(256)` ([`lib/accounts.ts`](lib/accounts.ts)) — always 256 bits, always 24 words.
2. `@scure/bip39` implements that as `entropyToMnemonic(randomBytes(32), wordlist)` — 32 raw bytes, no stretching, no mixing, no intermediate PRNG.
3. `randomBytes` (`@noble/hashes`) is a direct call to `globalThis.crypto.getRandomValues`, and **throws** if WebCrypto is missing. There is no fallback path, weak or otherwise.
4. Bytes become words through the standard BIP-39 checksum and base-2048 encoding — deterministic and bias-free. The bundled English wordlist is byte-identical to the official BIP-39 list (2048 words, SHA-256 `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`), verified both in `node_modules` and in the built `dist/` bundle.
5. Seed derivation is PBKDF2-HMAC-SHA512, 2048 iterations, salt `NFKD("mnemonic" + passphrase)`, exactly per spec — this is the BIP-39 figure and is fixed by the standard, unrelated to the vault's own 600,000-iteration password KDF. Keys derive at NIP-06's `m/44'/1237'/0'/0/0`, and both official NIP-06 test vectors are asserted end-to-end in the test suite.

`Math.random` appears nowhere on a key path. Post-quantum key seeds consume no additional randomness: they are HKDF-SHA256-derived from the same BIP-39 seed with versioned domain separation, as siblings of the secp256k1 key rather than from it.

Two things we cannot verify from this repository, and therefore do not claim: the browser's own `crypto.getRandomValues` implementation, and the npm supply chain beyond the lockfile's integrity hashes.

## Cryptographic Dependencies

Every cryptographic operation resolves to one of seven packages from the [noble/scure](https://paulmillr.com/noble/) family, plus `nostr-tools` for NIP-46 protocol plumbing. Nothing is vendored, forked, or patched — every file in `lib/crypto/` is a thin wrapper over an imported implementation, so what ships is what was published upstream.

`package.json` uses caret ranges; the exact versions below are held by the committed `package-lock.json` (lockfileVersion 3, a sha512 integrity hash on every entry, everything resolved from registry.npmjs.org), and CI installs with `npm ci`, which fails on any lockfile mismatch. **That lockfile is the pin — build with `npm ci`, not `npm install`.** No runtime dependency runs an install-time script.

| Package | Version | Role | Deps |
|---|---|---|---|
| `@scure/bip39` | 2.0.1 | Mnemonic generation and seed derivation — **the seed source** | 2 (same family) |
| `@scure/bip32` | 2.0.1 | NIP-06 HD derivation (`m/44'/1237'/…`) | 3 (same family) |
| `@scure/base` | 2.0.0 | bech32 encoding (`npub`/`nsec`/`ncryptsec`) | 0 |
| `@noble/hashes` | 2.0.1 | SHA-256, HMAC, HKDF, scrypt, and the `randomBytes` CSPRNG wrapper | 0 |
| `@noble/curves` | 2.0.1 | secp256k1 ECDSA + BIP-340 Schnorr | 1 |
| `@noble/ciphers` | 2.1.1 | ChaCha20 (NIP-44), XChaCha20-Poly1305 (NIP-49, PQ envelope) | 0 |
| `@noble/post-quantum` | 0.6.1 | ML-KEM-1024, ML-DSA-87 (FIPS 203/204) | 3 |
| `nostr-tools` | 2.23.3 | NIP-46 bunker / nostr-connect protocol only | 7 (6 dedupe to the rows above) |

**Why these.** `@scure/bip39`, `@scure/bip32`, `@scure/base` and `@noble/hashes` were audited
by Cure53 in January 2022, funded by the Ethereum Foundation and Nomic Labs ([report](https://cure53.de/pentest-report_hashing-libs.pdf)). `@noble/curves` has three independent audits: Trail of Bits at v0.7.3 ([report](https://github.com/trailofbits/publications/blob/master/reviews/2023-01-ryanshea-noblecurveslibrary-securityreview.pdf)) — the only one whose scope covers the secp256k1/weierstrass code this extension actually uses — Kudelski Security at v1.2.0, and Cure53 at v1.6.0, funded by OpenSats ([report](https://cure53.de/audit-report_noble-crypto-libs.pdf)), whose scope is ed25519/bls rather than secp256k1. `@noble/ciphers` is covered by that same 2024 Cure53 report. Every other JS option we considered (crypto-js, hash.js, elliptic) is unaudited, heavier, or both.

One caveat that applies to the whole family, stated plainly because it is easy to gloss over:
**the audits above cover earlier versions than what is installed.** The 2.x line is a
post-audit major revision. "Audited" here means an earlier version was audited, not that these exact bytes were.

**`@noble/post-quantum` has no independent audit at all.** Its own README says so: "The
library has not been independently audited yet … at version 0.6.1 it was audited by ourselves (self-audited)", and "There is no protection against side-channel attacks." We use it anyway, and the reasons are these rather than optimism: no independently audited pure-JS ML-KEM/ML-DSA implementation exists today; it is the reference JS implementation, from the same author and process as the audited packages, tested against NIST ACVP vectors; and the post-quantum keys are derived *from* the BIP-39 seed through the audited `@noble/hashes` HKDF, so a flaw here cannot weaken the seed or your secp256k1 identity. Post-quantum encryption is additive to the classical path, never a replacement — the hybrid envelope key requires breaking **both** ML-KEM-1024 and secp256k1 ECDH. We track [upstream](https://github.com/paulmillr/noble-post-quantum) and will move when an independently audited release lands.

**`nostr-tools`** (by fiatjaf, the Nostr creator) is used only for the NIP-46 remote-signer
protocol and implements no cryptography of its own in our bundle: its crypto dependencies dedupe to the audited noble/scure versions above, and its optional `nostr-wasm` accelerator is verified absent from the built `dist/`. The lockfile's integrity hash is the control here.

The remaining runtime dependencies are `qrcode-generator` (zero dependencies, renders QR codes locally) and React for the popup UI. Neither touches a key. `npm audit --omit=dev` reports **0 vulnerabilities**; the advisories `npm audit` does report are all in build and test tooling.

## Install

**Chrome Web Store:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)

**Firefox Add-ons:** [Install from Firefox Add-ons](https://addons.mozilla.org/addon/nostr-wot-extension/)

**Manual:**
1. Clone this repo
2. `npm install && npm run build`
3. Go to `chrome://extensions`, enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` folder

## Getting Started

1. Install the extension and follow the onboarding wizard to set up your account
2. Click the extension icon to manage your identity, wallet, profile, mutes, and relays
3. Visit any Nostr web client — the extension handles signing and Lightning payments automatically

## Privacy

- All identity and configuration data stays in your browser (encrypted vault + local storage)
- Relay and profile data is fetched from the relays you configure
- **No tracking, no analytics, no telemetry**

## Documentation

- [Architecture Reference](docs/architecture.md) — Technical deep dive into the extension's internals
- [Wallet & Lightning](docs/wallet.md) — Wallet providers, WebLN API, auto-provisioning, permissions
- [Cryptography](docs/crypto.md) — Primitives, key derivation, and post-quantum keys
- [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq) — The post-quantum wire format and reference library
- [Contributing](CONTRIBUTING.md) — How to contribute to the project
- [Security](SECURITY.md) — Security model and vulnerability reporting
- [Deployment](DEPLOY.md) — Building and publishing to browser stores
- [Changelog](CHANGELOG.md) — Version history

## License

MIT
