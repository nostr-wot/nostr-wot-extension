# Nostr WoT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

A browser extension for Nostr that manages your identity, signs events, and sends Lightning payments — all without leaving your browser. It is a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer, an encrypted key vault, a built-in Lightning/WebLN wallet, and a manager for your profile, mute list, and relays.

## Authentication protections in 0.8.7

Version 0.8.7 separates permission to use your identity on a website from
permission to authenticate it to a particular backend or relay. HTTP approvals
bind the exact URL and method to the requesting site and account. Relay approvals
can cover one site or, explicitly, all connected sites for that account and relay.
Browser-derived origin checks reject authentication from embedded frames; remote
signatures must match the event you approved.

Two community guides explain the controls, examples, compatibility and limits:

- **[Backend authentication: know which API you are authenticating to](docs/guides/backend-authentication.md)** — separate API domains, exact endpoint consent, native wallet transactions, and what CORS cannot guarantee.
- **[Relay authentication: choose which relays can authenticate your account](docs/guides/relay-authentication.md)** — NIP-42, all-sites relay grants, revocation, and connection-challenge responsibilities.

See the [changelog](CHANGELOG.md) for the complete 0.8.7 changes.

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

Locally managed identity keys are encrypted at rest with **AES-256-GCM** and PBKDF2-SHA-256 (600,000 iterations for password-protected vaults). Scoped operations zero their temporary key bytes; JavaScript cannot guarantee erasure of every copy. Auto-lock defaults to 15 minutes. **Never lock** uses an empty-password vault and provides no meaningful password protection. NIP-46 accounts keep their identity key at the remote signer; wallet connections carry separate spending credentials. See [Security](SECURITY.md) for custody and lock limits.

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
- Manage ordinary signing permissions per domain. These can be **shared across all accounts** (the default) or **isolated per account**.
- Authentication permissions remain tied to the approving account. Review and revoke them at the bottom of Permissions, including a separate popup for all-sites relay grants.

### Experimental Web of Trust

Version 0.8.0 restores `window.nostr.wot` as a menu-only opt-in, disabled by default. Choose local, remote or hybrid queries; sync follow graphs manually or daily, apply account mutes, customize scores, inspect an npub’s calculation and manage account databases. Websites need existing connection and identity permissions. See the [feature guide](docs/wot.md) and [WoT proposals](nips/wot/README.md).

---

### Post-Quantum Keys

Nostr public keys are published to every relay they touch, and Shor's algorithm recovers a
private key from a public key. That means every encrypted DM sent today can be decrypted
later by anyone who archived it — the damage is already accruing.

The extension derives **ML-KEM-1024** and **ML-DSA-87** keys ([FIPS 203] / [FIPS 204]) from
the same 24-word seed phrase your Nostr key comes from. Crucially they are derived as
*siblings* of the secp256k1 key, never *from* it: recovering your Nostr private key reveals
nothing about the seed, so recovering the secp256k1 key alone does not recover those post-quantum keys.
Confidentiality still depends on the algorithms, implementation and endpoint security. One mnemonic still restores everything — nothing extra to back up.

Open **Menu → Security → Post-quantum key** to see your keys and copy a ready-to-publish
`kind:10203` attestation. Or generate one offline:

```bash
npm run pqc:keygen
```

Requires a 24-word phrase. A 12-word phrase carries only 128 bits of entropy, which would become the weakest link, so the extension refuses to label such keys as seed-derived.

**Accounts that cannot derive can import a key instead.** An account imported from an nsec, or one on a 12-word phrase, has no 24-word seed to derive from — so it can generate a standalone pair offline and import it under Menu → Security → Post-quantum key:

```bash
npm run pqc:keygen -- --independent --keyfile keys.json
```

The extension validates the file by round trip — encapsulate/decapsulate for ML-KEM, sign/verify for ML-DSA — rather than trusting its lengths, then signs and publishes the attestation with the account's own key. The generator is [`scripts/pqc-keygen.mjs`](scripts/pqc-keygen.mjs), and the panel links to it so you can read the source before running it. An imported key is **not** recoverable from your seed phrase: back up the key file separately, or the messages sent to it become permanently unreadable.

**What this does not do:** it does not stop a quantum adversary forging events in your
name — events are still signed with secp256k1. The hybrid encryption path is intended to protect archived ciphertext against a future
attack on classical key agreement. It does not promise permanent confidentiality or protect
plaintext on compromised endpoints.

Message cost, measured on the full `kind:1059` gift wrap:

| message | classic NIP-17 | post-quantum | ratio |
|---|---|---|---|
| chat line (32 chars) | 1,701 B | 4,605 B | 2.7x |
| a tweet (280) | 2,213 B | 5,285 B | 2.4x |
| a paragraph (1 KB) | 3,921 B | 7,333 B | 1.9x |

About **3 KB constant overhead**, almost all of it the ML-KEM ciphertext. Encryption takes
~1.3 ms. See [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq)
for the wire format, the full size tables and the reference implementation.

**Clients can ask whether a signer supports this.** Post-quantum rides an optional third
argument to `nip44.encrypt`, so a signer that supports it and one that has never heard of
it look identical — the unaware one ignores the argument and returns ordinary ciphertext,
which a client would then badge as post-quantum. That silent downgrade is worse than not
offering the feature, so support is announced rather than inferred:

```js
window.nostr.nip44.schemes                  // ['nip44', 'pq']
window.nostr.nip44.encrypt(pubkey, text, { scheme: 'pq', recipientKemKey })
```

Decryption needs no flag: the envelope is self-describing. A request the active account
cannot perform is refused with a reason, never answered classically.

None of this is a standard yet. The drafts are in [`nips/`](nips/pqc/README.md), written so a
second implementation can interoperate without reading this source, and feedback on them is
more useful now than after another client ships.

[FIPS 203]: https://csrc.nist.gov/pubs/fips/203/final
[FIPS 204]: https://csrc.nist.gov/pubs/fips/204/final

---

## Seed Generation

This extension creates the seed phrase your entire identity rests on, so the path from randomness to words should be short enough to read in full and check yourself. It is:

1. `generateNewAccount()` calls `generateMnemonic(256)` ([`src/domain/accounts/creation.ts`](src/domain/accounts/creation.ts)) — always 256 bits, always 24 words.
2. `@scure/bip39` implements that as `entropyToMnemonic(randomBytes(32), wordlist)` — 32 raw bytes, no stretching, no mixing, no intermediate PRNG.
3. `randomBytes` (`@noble/hashes`) is a direct call to `globalThis.crypto.getRandomValues`, and **throws** if WebCrypto is missing. There is no fallback path, weak or otherwise.
4. Bytes become words through the standard BIP-39 checksum and base-2048 encoding — deterministic and bias-free. The bundled English wordlist is byte-identical to the official BIP-39 list (2048 words, SHA-256 `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`), verified both in `node_modules` and in the built `dist/` bundle.
5. Seed derivation is PBKDF2-HMAC-SHA512, 2048 iterations, salt `NFKD("mnemonic" + passphrase)`, exactly per spec — this is the BIP-39 figure and is fixed by the standard, unrelated to the vault's own 600,000-iteration password KDF. Keys derive at NIP-06's `m/44'/1237'/0'/0/0`, and both official NIP-06 test vectors are asserted end-to-end in the test suite.

`Math.random` appears nowhere on a key path. Post-quantum key seeds consume no additional randomness: they are HKDF-SHA256-derived from the same BIP-39 seed with versioned domain separation, as siblings of the secp256k1 key rather than from it.

Two things we cannot verify from this repository, and therefore do not claim: the browser's own `crypto.getRandomValues` implementation, and the npm supply chain beyond the lockfile's integrity hashes.

## Cryptographic Dependencies

Every cryptographic operation resolves to one of seven packages from the [noble/scure](https://paulmillr.com/noble/) family, plus `nostr-tools` for NIP-46 protocol plumbing. Nothing is vendored, forked, or patched — every file in `src/lib/crypto/` is a thin wrapper over an imported implementation, so what ships is what was published upstream.

`package.json` declares version ranges; the exact versions below are held by the committed `package-lock.json` (lockfileVersion 3, a sha512 integrity hash on every entry, everything resolved from registry.npmjs.org), and CI installs with `npm ci`, which fails on any lockfile mismatch. **That lockfile is the pin — build with `npm ci`, not `npm install`.** No runtime dependency runs an install-time script.

The lockfile protects anyone who installs with it, including a plain `npm install`. The declared ranges are a separate promise — that the code works with anything they admit — and that promise is what a second CI job (`crypto-latest-deps`) checks, by installing with the lockfile ignored and re-running the crypto, vault, signer and transport suites. It has caught two real breakages: a `@noble/hashes` release that raised scrypt's internal memory accounting and broke every NIP-49 encrypted-key backup, and a `nostr-tools` release whose WebSocket error handler recursed until the stack was gone. See [docs/testing.md § Dependency ranges](docs/testing.md#dependency-ranges).

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

The dependencies are bundled at build time. Noble/Scure provide the cryptographic
primitives; `nostr-tools` supplies NIP-46 protocol plumbing. React, React DOM,
`tailwind-merge` and `qrcode-generator` support the UI. Dependency audits and upstream
security reviews have version-specific scope and do not certify this extension or every
locked package. Run `npm audit` against the current lockfile rather than relying on a
historic advisory count. See [cryptography](docs/crypto.md) and [security](SECURITY.md)
for the implementation and post-quantum limitations.

## Install

**Chrome Web Store:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)

**Firefox Add-ons:** [Install from Firefox Add-ons](https://addons.mozilla.org/addon/nostr-wot-extension/)

**Manual:**
1. Clone this repo
2. Use Node 24.15+ in 24.x (recommended), 22.22.2+ in 22.x, or 26+; run `npm ci && npm run build`
3. Go to `chrome://extensions`, enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` folder

## Getting Started

1. Install the extension and follow the onboarding wizard to set up your account
2. Click the extension icon to manage your identity, wallet, profile, mutes, and relays
3. Visit any Nostr web client — the extension handles signing and Lightning payments automatically

## Privacy

- Local keys and wallet configuration are stored in the encrypted vault; public settings/caches use browser storage and IndexedDB.
- Features transmit the data they need: signed events to relays, requests/credentials to the configured wallet, remote-signing content to the selected signer, and public WoT queries to a configured oracle.
- Icon requests disclose site domains to Google's favicon service; avatar uploads and profile/image fetching also use network services.
- The extension implements no tracking analytics or telemetry. See [data destinations](docs/deployment.md#data-transmission-and-consent) for the complete disclosure categories.

## Documentation

- [Backend Authentication Guide](docs/guides/backend-authentication.md) — Website/API boundaries and native wallet protections
- [Relay Authentication Guide](docs/guides/relay-authentication.md) — Consent scopes, identity and revocation
- [Wallet Authentication v2](docs/wallet-auth-v2.md) — Exact client/backend wire contract and rollout

- [Architecture Reference](docs/architecture.md) — Technical deep dive into the extension's internals
- [NWC Protocol](docs/nwc-protocol.md) — Encryption, response verification and payment outcome limits
- [Wallet & Lightning](docs/wallet.md) — Wallet providers, WebLN API, auto-provisioning, permissions
- [Cryptography](docs/crypto.md) — Primitives, key derivation, and post-quantum keys
- [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq) — The post-quantum wire format and reference library
- [Contributing](CONTRIBUTING.md) — Development setup, issues and pull requests
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community standards and reporting
- [Security](SECURITY.md) — Security model and vulnerability reporting
- [Deployment](DEPLOY.md) — Building and publishing to browser stores
- [Changelog](CHANGELOG.md) — Version history

## License

MIT
