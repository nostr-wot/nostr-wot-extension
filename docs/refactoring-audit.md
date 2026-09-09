# Structure and reuse audit — 2026-09-09

Scope: source-module ownership, static runtime imports, component responsibilities,
shared UI controls, existing libraries, and regression coverage. This is a source
and automated-test audit; it does not certify every interactive browser flow.

## Completed

- Favicon network access, persistence and request deduplication moved from generic
  utilities to `services/media/favicon.ts`. `SiteIcon` still shares that cache.
- Public-key and sats formatters now live in their Nostr/wallet domains. Translated
  time and payment labels live in i18n services. Generic utilities no longer depend
  on application services, domain modules or browser/crypto adapters; tests guard it.
- `CopyButton` composes the existing clipboard hook and button primitives. Wallet
  connection/address and PQ/private-key/seed copy controls reuse it. Workflow-specific
  copy handlers remain where a successful copy changes backup completion state.
- Date/search inputs, dismissal-duration selection and PQ key paste reuse `Input`,
  `Select` and `Textarea`; specialized file/reveal controls retain native semantics.
- `KeyActionModal`: 309 → 94 lines. Three action-scoped panels own independent secret
  reveal, seed encryption and password-change state; inactive actions are unmounted.
- `SendDialog`: 317 → 201 lines. `PaymentPreview` renders confirmation fields without
  payment I/O. Its resolved-address contract projects the canonical LNURL fields.
- `PermissionsSection`: 315 → 242 lines. `PermissionRulesList` owns rule presentation
  and popover state; account bucket selection and persistence remain in the parent.
- Removed the empty mute-list preset feature and its duplicate import handler.
- Static runtime-import traversal found no cycles. This does not inspect dynamically
  constructed imports or prove the absence of runtime callback coupling.

## Remaining priorities

Scores use (impact + risk) × (6 − effort), each input on a 1–5 scale. Effort is a
relative estimate, not a commitment; changes below need their own focused validation.

| Priority | Area | Impact / risk / effort | Score | Next step and benefit |
|---|---|---|---|---|
| 1 | Interactive React lifecycle coverage | 5 / 4 / 3 | 27 | Add mounted tests for account switches, stale async results, clipboard feedback and secret-panel disposal. Current server-rendered checks cannot execute effects or clicks. |
| 2 | Hook dependency/lifetime warnings | 4 / 4 / 3 | 24 | Review the 10 existing warnings individually, separating intentional draft initialization from stale callbacks. Do not blindly add dependencies that restart network effects. |
| 3 | Signing service (1,061 lines) | 4 / 5 / 4 | 18 | Separate request queue, permission decisions and crypto dispatch behind explicit interfaces, preserving cancellation and cross-account rejection tests. |
| 4 | Onboarding handlers (812 lines) | 4 / 4 / 4 | 16 | Separate pending sessions, account creation and vault persistence; preserve expiry and add-account versus replace-vault safeguards. |
| 5 | Vault service (794 lines) | 4 / 5 / 5 | 9 | Separate encrypted persistence, unlock lifecycle and account operations while keeping key ownership/zeroing explicit. This is security-sensitive, not a file-size-only split. |

The remaining larger UI functions are roughly 200–250 lines, including profile,
wallet settings and activity. They already compose shared controls and domain
helpers. Extract further when an independent responsibility is identified; a line
limit alone would encourage large prop bags and hide ownership rather than improve it.

## Libraries and patterns

The project already uses React hooks/context, native browser form controls,
Tailwind with `tailwind-merge`, `@scure/base` for bech32, and Noble/Scure crypto.
This cleanup reuses those implementations; it adds no competing form, state,
clipboard, formatting or cryptographic dependency. Continue direct owner imports,
canonical domain contracts, pure decision helpers and action-scoped component state.

## Correction: shared wizard ownership

The initial audit accepted the existing top-level wizard exception without testing
it against the semantic directory rules. That was a missed finding. Account-creation
steps now live in `src/screens/Wizard/`; popup and onboarding import them through
`@screens`. The separate wizard alias is removed. Sharing across entry points does
not warrant a separate top-level category.
