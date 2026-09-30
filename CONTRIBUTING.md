# Contributing to Nostr WoT Extension

This extension provides NIP-07 signing, an encrypted identity vault, Lightning/WebLN
payments and an opt-in Web of Trust. Read the [Code of Conduct](CODE_OF_CONDUCT.md)
and search existing issues before opening a bug report or feature request.
Report security vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Development setup

Use **Node.js 24.15 or newer in the 24.x line** (recommended; CI uses Node 24).
The locked test dependencies also support Node 22.22.2+ in the 22.x line and
Node 26+. Earlier 22.x/24.x versions do not satisfy the complete toolchain's engines.
Install npm and a supported browser; Firefox packages require desktop 140+ or Android
142+. Chrome has no declared minimum version in the manifest; test your target version.

```sh
git clone https://github.com/nostr-wot/nostr-wot-extension.git
cd nostr-wot-extension
npm ci
npm run build
```

The project uses TypeScript, React, Vite and Tailwind. Load Chrome's unpacked extension
from **`dist/`**, not the source root. For Firefox, run `npm run package:firefox`, extract
`nostr-wot-firefox.zip` into a separate directory, then load that directory's
`manifest.json` through `about:debugging#/runtime/this-firefox`. Its background manifest
differs from Chrome's. See [deployment](DEPLOY.md) for packaging and Safari instructions.

## Project structure

- `background.ts`, `content.ts`, `inject.ts`: background dispatch, isolated bridge and page APIs.
- `src/entrypoints/`: popup, onboarding and prompt document shells.
- `src/screens/`, `src/components/`, `src/hooks/`: feature UI and reusable presentation/lifecycle code.
- `src/domain/`: feature contracts and pure decisions.
- `src/services/`: browser, network and persistence orchestration.
- `src/lib/`: cryptographic wrappers and browser compatibility.
- `docs/`, `nips/`, `tests/`: implementation references, protocol proposals and regression coverage.

Read [architecture](docs/architecture.md), [message flow](docs/message-flow.md) and the
relevant feature documentation before changing behavior. UI work follows
[component standards](docs/component-standards.md); security-sensitive work also follows
[the security model](docs/security.md).

## Issues and pull requests

Use the bug report template for reproducible failures and the feature template for
proposed behavior. Include the extension/browser/OS versions, installation method,
expected result and minimal reproduction. Never attach a seed phrase, nsec, NWC URI,
wallet API key, vault export, authentication token or unredacted private logs.
Use synthetic accounts and invoices in examples.

Fork the repository and work on a focused branch (`fix/`, `feat/` or `docs/`). Explain
the problem and resulting behavior in your PR and link related issues. Include UI
screenshots when useful, with private data removed. Keep commits focused and omit
agent attribution and co-author trailers.

Before adding an abstraction or dependency, search for an existing owner. Reuse shared
components, domain types and crypto wrappers. Do not commit generated archives, `dist/`,
secrets or local operational notes. Shared-core migrations must wait for required
packages to be published on npm; local tarballs are not a release substitute.

## Validation

```sh
npm run typecheck
npm run lint
npm run build
./tests/run.sh
```

Run targeted regressions while developing, then the full suite before submitting code.
The full runner builds first; some browser-mocked tests keep handles open briefly after
individual tests finish. Record command results and any checks you could not run in the
PR. See [testing](docs/testing.md) for suite registration and focused commands.

For UI changes, check collapsed/expanded states, keyboard interaction, account switching,
lock/unlock and the supported browsers you changed. Archive packaging and Chromium smoke
tests are separate release gates; install their browser with `npx playwright install chromium`.
Do not use customer funds or production credentials in tests.

## Security-sensitive changes

Validate page inputs at the existing message boundary and preserve internal-only method
gates. Keep signing/payment work tied to its captured account session and consent.
Access raw private keys through scoped vault helpers and preserve zeroing. Verify relay
event signatures and exact authentication audiences/bodies. Published payment ambiguity
must not trigger an automatic retry. Update the current behavior docs with the change.

## Client and backend registry

Contribute verified client origins and backend relationships in
[`src/data/auth-clients.json`](src/data/auth-clients.json), following the
[evidence requirements](docs/auth-client-registry.md). Unknown relationships must remain
unknown. Registry entries are informational and must never create signing permission.

```sh
node --import tsx --test tests/auth-client-registry.test.ts
```
