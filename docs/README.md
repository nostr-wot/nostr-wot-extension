# Nostr WoT Extension -- Documentation

## Overview

The Nostr WoT Extension is a Manifest V3 browser extension that provides an **NIP-07 Identity Provider** (signer), an encrypted key vault, profile and NIP-51 mute-list editing, NIP-65 relay-list management, and a built-in **WebLN Lightning wallet**. It targets Chrome and Firefox, built with Vite + TypeScript + React.

> The Web-of-Trust API returns in 0.8.0 as a menu-only, opt-in experiment.
> See [Web of Trust](wot.md) for modes, disclosure, limits and API compatibility.
> Compact graphs use a new IndexedDB snapshot service; page badges remain removed. Automatic refresh requires a separate opt-in.

---

## Documentation Index

### Core Architecture

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | Extension structure, entry points, manifest, type system |
| [Message Flow](message-flow.md) | Page-to-background communication, validation layers, channel isolation |
| [Storage](storage.md) | browser.storage layout, encrypted vault, wallet storage |

### Identity & Security

| Document | Description |
|----------|-------------|
| [Security](security.md) | Vault encryption, key handling, MemoryVaultPayload, zeroing, error normalization |
| [Accounts](accounts.md) | Account types, registry, switching |
| [Signer](signer.md) | NIP-07 signing flow, permission cascade, prompt system, NIP-46 |

### Lightning Wallet

| Document | Description |
|----------|-------------|
| [Wallet](wallet.md) | Providers (NWC/LNbits), auto-provisioning, WebLN API, permissions, BOLT11 decoder, UI |

### Configuration & Infrastructure

| Document | Description |
|----------|-------------|
| [Configuration](configuration.md) | Config storage, default relays, profile metadata caching |
| [Crypto Library](crypto.md) | Pure JS crypto: secp256k1, Schnorr, NIP-04/44/49, BIP-32/39, bech32 |
| [NIP proposals](../nips/README.md) | PQC canonical-draft shortcuts and experimental browser WoT API/scoring proposals |
| [Component Standards](component-standards.md) | Shared components, hooks, utilities, CSS patterns, import aliases |
| [Testing](testing.md) | Test runner, test files, communication test suite, infrastructure |
| [Deployment](deployment.md) | Store-by-store release notes: build requirements, data-consent declarations, past rejections and their fixes |

---

## Quick Reference

**Build**: `npm run build` (Vite + @crxjs/vite-plugin)

**Package**: `npm run package:chrome` / `npm run package:firefox` (builds + zips for store submission, see [DEPLOY.md](../DEPLOY.md))

**Test**: `./tests/run.sh` (Node.js built-in test runner + tsx)

**Key files**:
- `background.ts` -- service worker / background script (central coordinator)
- `content.ts` -- content script (ISOLATED world, message bridge)
- `inject.ts` -- page script (MAIN world, exposes `window.nostr`)
- `src/services/vault/vault.ts` -- encrypted key vault
- `src/services/signing/signer.ts` -- NIP-07 signing coordinator
- `src/services/permissions/permissions.ts` -- per-domain/per-account permission cascade
- `src/services/wallet/` -- wallet providers (NWC, LNbits), auto-provisioning and LNURL requests
- `src/domain/` -- feature-owned contracts, types and pure rules

**Path aliases** (configured in `vite.config.ts`):
- `@components` -> `src/components` — shared UI
- `@screens` -> `src/screens` — one folder per popup screen
- `@domain` -> `src/domain` — feature logic, one folder per module, pure and tested
- `@services` -> `src/services` — the things that talk to something (`rpc`, `blossom`)
- `@context` -> `src/context` — the eight React contexts
- `@hooks` -> `src/hooks`, `@utils` -> `src/utils` (no domain knowledge), `@styles` -> `src/styles`
- `@constants` -> `src/constants` — shared configuration and protocol data
- `@lib` -> `src/lib` — cryptographic primitives and the browser compatibility shim, never React
- `@assets` -> `src/assets`
- Browser document shells live in `src/entrypoints/`; the shared wizard lives at `src/screens/Wizard/` — `@models` and `@shared` no longer exist; `models/` was merged into `domain/` and `shared/` was split into `domain/`, `services/` and `utils/`
