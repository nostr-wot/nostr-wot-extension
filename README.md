# Nostr WoT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

A browser extension for Nostr that manages your identity, signs events, and sends Lightning payments — all without leaving your browser. It is a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer, an encrypted key vault, a built-in Lightning/WebLN wallet, and a manager for your profile, mute list, and relays.

## Features

### Identity & Key Management

Create or import your Nostr identity and use it across any Nostr web client. The extension acts as a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer — sites request access, you approve or deny.

| Account Type | Description |
|--------------|-------------|
| **Generate new keys** | BIP-39 mnemonic with NIP-06 derivation — back up your seed phrase |
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
- **Relays (NIP-65 kind:10002)** — edit your read/write relay list (outbox model). Relay-aware clients can also read this via `window.nostr.wot.getRelayList` / `getRelayPool`.

### Multi-Account Support

Switch between multiple identities. Each account has its own permissions, wallet, and profile/relay/mute data. Switching accounts is instant.

### Per-Site Controls

- Allow or block sites from accessing your identity
- Disable identity on specific sites
- Manage signing permissions per domain. Permissions can be **shared across all accounts** (the default) or **isolated per account**.

---

## Relay-list API

The extension exposes a small `window.nostr.wot` surface so relay-aware web apps can read your stored NIP-65 relay data (the outbox model):

```javascript
if (window.nostr?.wot) {
  const relays = await window.nostr.wot.getRelayList(targetPubkey); // [{ url, read, write }, ...] or null
  const pool = await window.nostr.wot.getRelayPool();               // aggregated relay pool
}
```

> **Note:** Earlier versions shipped an experimental Web-of-Trust trust-graph layer (oracles, follow-graph sync, trust scoring, and page-injected trust badges). That subsystem has been removed. `window.nostr.wot` now exposes only the two relay-list helpers above.

---

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
- [Contributing](CONTRIBUTING.md) — How to contribute to the project
- [Security](SECURITY.md) — Security model and vulnerability reporting
- [Deployment](DEPLOY.md) — Building and publishing to browser stores
- [Changelog](CHANGELOG.md) — Version history

## License

MIT
