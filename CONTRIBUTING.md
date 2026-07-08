# Contributing to Nostr WoT Extension

Thank you for your interest in contributing! This extension is a NIP-07 signer, encrypted key vault, Lightning/WebLN wallet, and profile/mute/relay manager for Nostr web clients.

## Getting Started

### Prerequisites

- Node.js 18+ (for running tests)
- Chrome or Firefox browser
- Basic familiarity with browser extension development (MV3)

### Setup

```bash
git clone https://github.com/user/nostr-wot-extension.git
cd nostr-wot-extension
```

No build step required — the extension uses plain ES modules with no bundler.

### Loading the Extension

**Chrome:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project directory

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in the project directory (e.g., `manifest.json`)

### Running Tests

```bash
node --test tests/
```

Tests use Node.js native `node:test` module with browser API mocks in `tests/helpers/`.

## Project Structure

```
├── background.ts          # Service worker — thin dispatcher over lib/bg/
├── content.ts             # Content script (ISOLATED world) — message bridge
├── inject.ts              # Page script (MAIN world) — window.nostr + window.webln
├── lib/
│   ├── bg/                # Background handler modules (nip07, vault, wallet, relay, profile, publish, …)
│   ├── crypto/            # Pure TS crypto (secp256k1, schnorr, NIPs, bip32/39)
│   ├── wallet/            # Lightning wallet providers (NWC, LNbits, provisioning)
│   ├── storage.ts         # IndexedDB relay-list cache + pubkey ID mapping
│   ├── vault.ts           # AES-256-GCM encrypted key vault
│   ├── signer.ts          # NIP-07 signing coordinator
│   ├── permissions.ts     # Per-domain / per-account permission storage
│   ├── accounts.ts        # Account creation/import
│   ├── relayUtils.ts      # Relay URL normalization
│   └── browser.ts         # Cross-browser compatibility shim
├── src/popup/             # Extension popup (tab-based UI)
├── src/onboarding/        # First-run setup wizard
├── src/prompt/            # Signing request approval popup
├── docs/                  # Technical documentation (see docs/README.md)
└── tests/                 # Node.js test suite
```

## Types of Contributions

### Bug Fixes

1. Check existing issues first
2. Create a failing test case if possible
3. Fix the bug
4. Verify existing tests still pass: `node --test tests/`

### New Features

1. Open an issue to discuss the feature first
2. Reference the relevant NIP if applicable
3. Follow existing patterns in the codebase
4. Add tests for new backend logic

## Pull Request Process

### 1. Fork and Branch

```bash
git checkout -b feature/my-change
```

Use these branch name prefixes:
- `feature/` — new functionality
- `fix/` — bug fixes
- `docs/` — documentation

### 2. Make Changes

- Follow existing code style (no linter configured — match surrounding code)
- Use plain ES modules, no build tools
- Use optional chaining (`?.`) for DOM access
- Zero private keys after use (`privkey.fill(0)` in `try/finally`)
- Gate privileged message handlers via `PRIVILEGED_METHODS` Set
- No external dependencies — the extension is self-contained

### 3. Test

```bash
node --test tests/
```

For UI changes, manually test in Chrome and Firefox:
- Open the popup and verify all tabs work
- Test dark mode (system preference)
- Test with 0 accounts, 1 account, and multiple accounts
- Test with both signing accounts and read-only accounts

### 4. Submit

- Write a clear PR title (e.g., "wallet: fix LNbits balance parsing")
- Describe what changed and why
- Include screenshots for UI changes
- Reference any related issues

## Architecture Notes

Read [docs/architecture.md](docs/architecture.md) for the full technical reference. Key points:

- **No build system** — files are loaded directly by the browser
- **Message passing** — inject.js → content.js → background.js via `postMessage` and `runtime.sendMessage`
- **Privileged methods** — vault, permission, and management operations are gated to internal extension pages via sender ID verification
- **Per-account isolation** — signing permissions and wallet configuration are keyed per account; keys and wallet secrets live only inside the encrypted vault

## Security Guidelines

- Never log or expose private keys
- Always zero `Uint8Array` private keys after use
- Validate all inputs from web pages (content script allowlists)
- Use `sender.id` checks for privileged operations
- Rate-limit external-facing API methods
- Verify event signatures before trusting relay data

## Code of Conduct

Be respectful, constructive, and focused on building great software. Technical disagreements are welcome; personal attacks are not.
