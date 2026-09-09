# Constants

Import the purpose-specific module through `@constants/…`. This folder owns fixed
configuration, storage keys, timeouts, limits, protocol parameters and lookup data.
It contains no runtime service or UI imports. Domain type-only imports are allowed.

- `relays.ts`: one default relay list; its CSV form is derived, never copied.
- `vault.ts`: password, lockout and vault-format policies. Active vault and legacy
  work factors are distinct. Backup/NIP-49 format parameters live under `crypto/`.
- `accounts.ts`, `wallet.ts`, `permissions.ts`, `pqc.ts`, etc.: feature configuration.
- `crypto/`: fixed cryptographic protocol values and wire-format sizes.

Mutable session state, renderer/dispatch functions and component-specific style
recipes stay in their owning modules. Shared types belong in `src/domain/`;
behavior belongs in domain rules, services or generic utilities, not this folder.
Import directly from the defining module. Do not add forwarding re-exports or
barrel files; consumers should make ownership explicit.
