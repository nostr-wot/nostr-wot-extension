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
./tests/run.sh
```

Tests use Node.js native `node:test` module with browser API mocks in `tests/helpers/`.

## Project Structure

```
├── background.ts          # Service-worker dispatcher
├── content.ts             # Isolated-world message bridge
├── inject.ts              # Page-facing Nostr and WebLN APIs
├── src/
│   ├── entrypoints/       # HTML, React mounts and document shells
│   │   ├── popup/
│   │   ├── onboarding/
│   │   └── prompt/
│   ├── screens/           # Feature UI, including Wizard and Prompt
│   ├── components/        # Shared UI controls and presentation
│   ├── hooks/             # React hooks
│   ├── context/           # App providers
│   ├── domain/            # Pure feature decisions and contracts
│   ├── services/          # Browser, network and persistence orchestration
│   ├── constants/         # Configuration and protocol values
│   ├── utils/             # Generic helpers
│   ├── lib/               # Crypto primitives and browser compatibility
│   ├── assets/            # React icons
│   ├── styles/            # Theme and shared styles
│   └── public/            # Packaged icons and translations
├── docs/                  # Technical documentation
└── tests/                 # Node.js test suite
```

## Types of Contributions

### Bug Fixes

1. Check existing issues first
2. Create a failing test case if possible
3. Fix the bug
4. Verify existing tests still pass: `./tests/run.sh`

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
./tests/run.sh
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
