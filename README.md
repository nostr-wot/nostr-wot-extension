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

Your private keys never leave the extension. They're encrypted at rest with **AES-256-GCM** (PBKDF2, 210,000 iterations) and only decrypted in memory when the vault is unlocked. An auto-lock timer clears everything after 15 minutes of inactivity (configurable, or set to "never"). Key bytes are zeroed immediately after each signing operation.

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

None of this is a standard yet. The drafts are in [`nips/`](nips/README.md), written so a
second implementation can interoperate without reading this source, and feedback on them is
more useful now than after another client ships.

[FIPS 203]: https://csrc.nist.gov/pubs/fips/203/final
[FIPS 204]: https://csrc.nist.gov/pubs/fips/204/final

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
