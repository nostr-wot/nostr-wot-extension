# Nostr WoT Extension -- Documentation

## Overview

The Nostr WoT Extension is a Manifest V3 browser extension that provides an **NIP-07 Identity Provider** (signer), an encrypted key vault, profile and NIP-51 mute-list editing, NIP-65 relay-list management, and a built-in **WebLN Lightning wallet**. It targets Chrome and Firefox, built with Vite + TypeScript + React.

> The legacy Web-of-Trust trust-graph subsystem (oracles, follow-graph sync, trust scoring, page-injected trust badges, the `window.nostr.wot` page API, and the IndexedDB engine `lib/storage.ts` that backed them) has been removed.

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
| [NIP proposals](../nips/README.md) | Draft specs for the post-quantum work: key derivation, `kind:10203` attestation, the NIP-44 envelope, the NIP-07 capability marker |
| [Component Standards](component-standards.md) | Shared components, hooks, utilities, CSS patterns, import aliases |
| [Testing](testing.md) | Test runner, test files, communication test suite, infrastructure |

### Design records

| Document | Description |
|----------|-------------|
| [Specs](superpowers/specs/) | Point-in-time design documents, agreed before implementation and marked with their outcome |
| [Code Review](code-review.md) | March 2026 audit snapshot — historical, see its own note for what has since changed |

---

## Quick Reference

**Build**: `npm run build` (Vite + @crxjs/vite-plugin)

**Package**: `npm run package:chrome` / `npm run package:firefox` (builds + zips for store submission, see [DEPLOY.md](../DEPLOY.md))

**Test**: `./tests/run.sh` (Node.js built-in test runner + tsx)

**Key files**:
- `background.ts` -- service worker / background script (central coordinator)
- `content.ts` -- content script (ISOLATED world, message bridge)
- `inject.ts` -- page script (MAIN world, exposes `window.nostr`)
- `lib/vault.ts` -- encrypted key vault
- `lib/signer.ts` -- NIP-07 signing coordinator
- `lib/permissions.ts` -- per-domain/per-account permission cascade
- `lib/wallet/` -- wallet providers (NWC, LNbits), auto-provisioning, BOLT11 decoder
- `lib/types.ts` -- shared TypeScript interfaces

**Path aliases** (configured in `vite.config.ts`):
- `@components` -> `src/components`
- `@shared` -> `src/shared`
- `@lib` -> `lib`
- `@assets` -> `src/assets`
