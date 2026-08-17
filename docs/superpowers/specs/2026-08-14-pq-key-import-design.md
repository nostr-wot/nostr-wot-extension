# Importing post-quantum keys for accounts that cannot derive them

Status: approved and implemented 2026-08-14.

Built as specified, with one addition found during implementation: every `SafeAccount` accessor in `lib/vault.ts` destructured only `privkeyBytes` and `mnemonicBytes`, so the new memory fields would have leaked through three functions the spec did not name. All three now strip them, and a test asserts it.

## Problem

`pqc_getStatus` refuses to produce post-quantum keys for four kinds of account, reporting a `PqcBlockReason`: `read-only`, `remote-signer`, `no-seed`, and `short-seed`. For two of them the refusal is correct and permanent. For the other two the account holds a perfectly good secp256k1 key and simply has no 24-word mnemonic to derive from — and today it is offered nothing but an explanation.

`scripts/pqc-keygen.mjs --independent` already generates a standalone ML-KEM-1024 / ML-DSA-87 pair for exactly this case. Nothing in the extension can consume its output.

## Scope

Let an account that cannot derive import an externally generated key pair, and link users to the generator.

| Blocked reason | Import offered | Reason |
|---|---|---|
| `short-seed` (12 words) | Yes | The case `--independent` exists for |
| `no-seed` (nsec import) | Yes | Holds a local secp256k1 key, just no mnemonic |
| `read-only` (npub) | No | Cannot sign an attestation, and post-quantum decryption needs the classical private key for the hybrid conversation key |
| `remote-signer` (NIP-46) | No | `handleCryptoRequest` routes nip44 to the bunker, which knows nothing about the post-quantum envelope — imported keys would unlock nothing |

Accounts that *can* derive are not offered an override. Derived keys are recoverable from the seed alone, which is strictly better, and supporting both provenances per account would mean deciding which one an attestation advertises.

## The import artifact

A JSON keyfile, accepted by paste or file picker — both feed one parser, so there is one format to validate and one to test.

```json
{ "v": "nip-pqc/v1", "origin": "independent",
  "alg": { "kem": "ml-kem-1024", "dsa": "ml-dsa-87" },
  "kem": { "public": "<b64 1568B>", "secret": "<b64 3168B>" },
  "dsa": { "public": "<b64 2592B>", "secret": "<b64 4896B>" } }
```

`scripts/pqc-keygen.mjs` gains `--keyfile <path>` to emit it, and stops requiring `--nsec` when only a keyfile is requested: the extension signs the attestation with the account's own key, so the generator never needs the identity key for this flow.

The panel links to `github.com/nostr-wot/nostr-wot-extension` → `scripts/pqc-keygen.mjs`, showing the command inline so the user can read the code before running it.

## Validation

Length checks alone would accept a truncated paste. Before anything is stored, both pairs must prove themselves:

- **ML-KEM**: `encapsulate(public)` then `decapsulate(ct, secret)`; the shared secrets must match.
- **ML-DSA**: `signPop(testMessage, secret)` then `verifyPop(sig, testMessage, public)` must pass.

Failure is reported per algorithm, not as one generic error.

## Storage

`Account.pqKeys?: PqImportedKeys | null`, inside the encrypted vault payload. **`'pqKeys'` must be added to the `SafeAccount` Omit in `lib/types.ts`** — that type is `Omit<Account, 'privkey' | 'mnemonic' | 'walletConfig'>`, so without this the secret halves would ride out on every `SafeAccount` the UI already receives.

In memory the secrets become `pqKemSecretBytes` / `pqDsaSecretBytes` (`Uint8Array`), zeroed by `zeroDecryptedKeys()` next to `privkeyBytes` and `mnemonicBytes`; `toMemoryAccount` / `toStorageAccount` convert. Public halves stay base64 strings — they are public.

Key presence is exposed only through `pqc_getStatus` (`source: 'derived' | 'imported'`), never through the account list.

## Behaviour once imported

- `pqc_getStatus` returns keys and an attestation tagged `['origin','independent']` with **no** `seed_strength` tag, matching the generator's own vocabulary so a relay reader can distinguish the two provenances.
- `pqc_publishAttestation` and `pqc_checkPublished` work unchanged.
- `activePqKeys()` (`lib/signer.ts`) prefers imported keys and falls back to seed derivation. This is what makes `nip44Decrypt` of a post-quantum envelope work on these accounts.
- A **Remove** action, so an account that imported the wrong keyfile is not stuck advertising keys it cannot use.

## UI

The blocked branch of `PqcSection.tsx` splits: eligible reasons keep the existing explanation and gain an import panel; `read-only` and `remote-signer` keep today's copy unchanged. Roughly ten new strings across six locales.

Imported keys are **not** recoverable from the seed phrase, so the backup story differs for these accounts. That is a persistent warning in the panel, not a one-time dialog.

## Testing

- `tests/crypto/pq-import.test.ts` — parser and round-trip validation, including rejection of a truncated key and of a mismatched pair.
- `tests/pqc-handlers.test.ts` — status, attestation shape, and removal on an imported account.
- A `SafeAccount` leak test asserting imported secrets never appear in the account list.

## Out of scope

Override for derivable accounts; NIP-46 and read-only support; key rotation; syncing imported keys between devices.
