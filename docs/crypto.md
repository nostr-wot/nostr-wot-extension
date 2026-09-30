# Crypto Library -- `src/lib/crypto/`

The modules wrap the bundled Noble/Scure primitives and Web Crypto APIs. They are
not from-scratch curve or signature implementations. The committed lockfile pins
dependency versions; see [Security](../SECURITY.md) for supply-chain, key-erasure
and post-quantum limitations.

| File | Purpose |
|------|---------|
| `secp256k1.ts` | Public-key derivation, ECDH, private-key validation and x-coordinate lifting through `@noble/curves`. |
| `schnorr.ts` | BIP-340 Schnorr signature wrappers over `@noble/curves`; NIP-01 also uses its Schnorr implementation. |
| `nip01.ts` | Nostr event ID computation (SHA-256 of serialized `[0, pubkey, created_at, kind, tags, content]`) and event signing via Schnorr. |
| `nip04.ts` | NIP-04 legacy encrypted direct messages. AES-256-CBC with a shared secret derived from ECDH on secp256k1. **Error normalization**: decrypt failures produce a generic `"Decryption failed"` message to prevent padding oracle attacks. |
| `nip44.ts` | NIP-44 v2 encryption. ChaCha20 stream cipher + HMAC-SHA256 authentication. Uses `hkdfExpand` (not full HKDF) for message key derivation. |
| `nip49.ts` | NIP-49 encrypted private key format (`ncryptsec`). Encode/decode with password-based encryption. **Zeroing**: input `privkeyBytes` are zeroed after encode; decrypted bytes are zeroed after hex extraction. **`scryptMaxMem(logN)`** is the scrypt `maxmem` bound, budgeted as the `V` + `B` blocks plus four fixed scratch-space blocks rather than from the expression any one `@noble/hashes` version validates against — see [testing.md § Dependency ranges](testing.md#dependency-ranges) for why that distinction broke backups when dependencies were resolved without the lockfile. |
| `bip32.ts` | Hierarchical deterministic key derivation via `@scure/bip32` HDKey, with hardened and non-hardened paths. Derived HDKey instances are wiped after copying the required output. NIP-06 paths come from the crypto constants. |
| `pq.ts` | Post-quantum key derivation (ML-KEM-1024 per FIPS 203, ML-DSA-87 per FIPS 204 — the CNSA 2.0 parameter sets) over `@noble/post-quantum`. Derives both key pairs from the **BIP-39 seed**, as siblings of the secp256k1 key rather than from it — HKDF-SHA256 with domain-separated `info` strings (`nip-pqc/v1/<alg>/<account>`). This one-way relationship is the security property the scheme rests on: recovering the secp256k1 private key must not yield the seed, and therefore must not yield these keys. Also provides proof-of-possession signing/verification, ML-KEM encapsulate/decapsulate, the `pqEncrypt`/`pqDecrypt`/`isPqEnvelope` message envelope, and `parsePqKeyfile()` for importing externally generated keys. Wired into the vault via `src/services/signing/signer.ts` (which derives the keys from the unlocked seed per request and stores nothing — imported keys are the exception, and are held in the vault) and onto the NIP-07 surface as the optional third argument to `nip44.encrypt`, with support announced on `window.nostr.nip44.schemes` — see `docs/message-flow.md`. See `tests/crypto/pq.test.ts` for the derivation test vectors and `tests/crypto/pq-import.test.ts` for the key-file rules, and [`nips/`](../nips/pqc/README.md) for the wire formats. |
| `scripts/pqc-keygen.mjs` (repository root) | CLI: `npm run pqc:keygen`. Derives post-quantum keys and prints a signed `kind:10203` attestation, entirely offline — the mnemonic is read from stdin and never written to disk. Refuses to derive from a 12-word mnemonic (128 bits would be the weakest link); such identities use `--independent` for a standalone key pair that is backed up separately. `--keyfile <path>` writes that pair in the shape the extension imports (mode 0600); combined with `--independent` it needs no `--nsec`, because the extension signs the attestation with the account's own key. Covered by `tests/crypto/pqc-keygen.test.ts`. |
| `bip39.ts` | Mnemonic generation and seed derivation via PBKDF2-SHA512 (2048 iterations, salt `"mnemonic" + passphrase`). `generateMnemonic(strength)` defaults to 256-bit entropy (24 words), matching what `generateNewAccount` in `src/domain/accounts/creation.ts` requests so that post-quantum keys can later be derived from the same seed without the seed being the weakest link. Both 12- and 24-word phrases remain valid for import. |
| `bech32.ts` | Bech32 and bech32m encoding/decoding for Nostr entities: `npubEncode`, `npubDecode`, `nsecEncode`, `nsecDecode`. |
| `keyBackup.ts` | Password-encrypted backup envelope for seed/private-key and PQ imports/exports, using AES-GCM. |
| `utils.ts` | Hex-to-bytes and bytes-to-hex conversion utilities (`hexToBytes`, `bytesToHex`). |

## Post-quantum envelope and limits

The extension's optional PQ scheme combines classical agreement with ML-KEM-1024 and
uses ML-DSA-87 for attestation proof of possession. Derived keys require a 24-word seed;
imported independent keys need their own backup. Nostr event signatures remain classical.
Neither the envelope nor dependency choice is a guarantee against endpoint compromise,
implementation flaws or all future cryptanalysis.

The protocol references are in [the PQ drafts](../nips/pqc/README.md) and the
[`@nostr-wot/pq` reference implementation](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq).
Ciphertext size depends on padding, message size and wrapping layers; use the current
fixtures/implementation for measurements rather than treating an old benchmark as a
fixed overhead contract.

Run the crypto regressions with:

```sh
node --import tsx --test tests/crypto/*.test.ts
```
