# Nostr WoT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

Use your Nostr identity across compatible web apps. Nostr WoT is a browser
extension for signing requests, managing accounts, and sending Lightning payments,
with an optional Web of Trust for exploring your social graph.

Websites request access through NIP-07 and WebLN. You control their permissions;
locally managed identity keys stay in the extension's signing flow.

## Install

- **Chrome:** [Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)
- **Firefox:** [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/nostr-wot-extension/)
- **Source builds and Safari:** [Build and installation instructions](DEPLOY.md)

## Get started

1. Open the extension and create an account, import an existing identity, or connect
   a remote signer. Back up a newly generated seed phrase and choose a vault password.
2. Visit a compatible Nostr client and choose its browser-extension sign-in option.
   Review the site's connection and signing requests in the extension.
3. Open the extension to switch accounts, manage permissions, or edit your profile,
   mute list and relays. Connect a wallet when you want to use Lightning payments.

## Features

- **Account Archive:** Save an encrypted local copy of your events, sync selected relays manually or automatically, export/import encrypted files, and migrate eligible events to another relay. See [Archive](docs/archive.md).
- **Identity and signing:** Create a 24-word seed, import an existing key or seed,
  connect a NIP-46 remote signer, or add a watch-only account. Use NIP-07 signing
  and encrypted-message operations with compatible clients.
- **Multiple accounts:** Switch identities and their wallets, profiles and relay
  lists. Ordinary signing permissions can be shared or isolated per account;
  authentication permissions are account-specific.
- **Lightning payments:** Connect an NWC or LNbits wallet, or use Quick Setup.
  Send and receive payments, inspect transactions, and approve WebLN requests.
  See [wallet setup and compatibility](docs/nwc-compatibility.md).
- **Profile, mutes and relays:** Publish profile changes, manage your mute list,
  and configure read/write relays from the popup.
- **Site permissions:** Review signing requests and backend/relay authentication
  destinations. Manage remembered permissions and revoke site access.
- **Optional Web of Trust:** Explore social distance and trust scores using local,
  remote or hybrid queries. This experimental feature is disabled by default and
  is not required for signing or payments. See the [WoT guide](docs/wot.md).
- **Experimental post-quantum encryption:** Derive or import additional keys for
  compatible clients. This uses an opt-in hybrid protocol; it does not replace
  Nostr event signatures or protect old ciphertext. See [cryptography](docs/crypto.md)
  and the [protocol drafts](nips/pqc/README.md).

## Security and privacy

Password-protected vaults encrypt locally managed keys and wallet credentials.
Auto-lock is configurable; **Never lock** uses an empty password and does not
provide meaningful password protection. Remote signers retain custody of their
own identity keys.

The extension implements no tracking analytics or telemetry. Requested features
still communicate with relays, wallets, remote signers and other services. For
example, favicon requests disclose site domains to Google's favicon service.
Read the [security policy](SECURITY.md) and [data transmission disclosures](docs/deployment.md#data-transmission-and-consent)
for the trust boundaries and destinations.

Report vulnerabilities through [private security reporting](https://github.com/nostr-wot/nostr-wot-extension/security/advisories/new),
not public issues. Never include real keys, seed phrases or wallet credentials.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for supported Node versions, development
setup and required checks. With those prerequisites installed:

```sh
git clone https://github.com/nostr-wot/nostr-wot-extension.git
cd nostr-wot-extension
npm ci
npm run build
```

For Chrome, open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select `dist/`. Firefox and Safari require their own packaging
steps in the [build guide](DEPLOY.md).

## Documentation and support

- [Documentation index](docs/README.md) — user guides, architecture and API details
- [Changelog](CHANGELOG.md) — changes by version
- [Issues](https://github.com/nostr-wot/nostr-wot-extension/issues) — bug reports and feature requests
- [Contributing](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) — contribution and community guidelines

Maintained by the [Nostr WoT project](https://github.com/nostr-wot).

## License

[MIT](LICENSE)
