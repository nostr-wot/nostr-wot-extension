# Crypto Library -- `lib/crypto/`

Pure JavaScript implementations with no external dependencies. All cryptographic primitives are implemented from scratch using the Web Crypto API where available (PBKDF2, AES-GCM, HMAC-SHA512) and manual implementations where needed (secp256k1, Schnorr).

| File | Purpose |
|------|---------|
| `secp256k1.ts` | Elliptic curve operations on the secp256k1 curve. MSB-first windowed scalar multiplication for `scalarMulG`. Point addition, doubling, and public key derivation (`getPublicKey`). |
| `schnorr.ts` | BIP-340 Schnorr signature creation and verification. Used by NIP-01 for event signing. |
| `nip01.ts` | Nostr event ID computation (SHA-256 of serialized `[0, pubkey, created_at, kind, tags, content]`) and event signing via Schnorr. |
| `nip04.ts` | NIP-04 legacy encrypted direct messages. AES-256-CBC with a shared secret derived from ECDH on secp256k1. **Error normalization**: decrypt failures produce a generic `"Decryption failed"` message to prevent padding oracle attacks. |
| `nip44.ts` | NIP-44 v2 encryption. ChaCha20 stream cipher + HMAC-SHA256 authentication. Uses `hkdfExpand` (not full HKDF) for message key derivation. |
| `nip49.ts` | NIP-49 encrypted private key format (`ncryptsec`). Encode/decode with password-based encryption. **Zeroing**: input `privkeyBytes` are zeroed after encode; decrypted bytes are zeroed after hex extraction. |
| `bip32.ts` | Hierarchical deterministic key derivation (BIP-32). HMAC-SHA512 based. Master key from seed via `HMAC-SHA512(key="Bitcoin seed", data=seed)`. Supports both hardened (index >= 0x80000000) and non-hardened child derivation. Exports `NIP06_PATH = "m/44'/1237'/0'/0/0"`. |
| `pq.ts` | Post-quantum key derivation (ML-KEM-1024 per FIPS 203, ML-DSA-87 per FIPS 204 — the CNSA 2.0 parameter sets) over `@noble/post-quantum`. Derives both key pairs from the **BIP-39 seed**, as siblings of the secp256k1 key rather than from it — HKDF-SHA256 with domain-separated `info` strings (`nip-pqc/v1/<alg>/<account>`). This one-way relationship is the security property the scheme rests on: recovering the secp256k1 private key must not yield the seed, and therefore must not yield these keys. Also provides proof-of-possession signing/verification, ML-KEM encapsulate/decapsulate, and the `pqEncrypt`/`pqDecrypt`/`isPqEnvelope` message envelope. Wired into the vault via `lib/signer.ts` (which derives the keys from the unlocked seed) and onto the NIP-07 surface as the optional third argument to `nip44.encrypt` — see `docs/message-flow.md`. See `tests/crypto/pq.test.ts` for the derivation test vectors. |
| `../scripts/pqc-keygen.mjs` | CLI: `npm run pqc:keygen`. Derives post-quantum keys and prints a signed `kind:10203` attestation, entirely offline — the mnemonic is read from stdin and never written to disk. Refuses to derive from a 12-word mnemonic (128 bits would be the weakest link); such identities use `--independent` for a standalone key pair that is backed up separately. Covered by `tests/crypto/pqc-keygen.test.ts`. |
| `bip39.ts` | Mnemonic generation and seed derivation via PBKDF2-SHA512 (2048 iterations, salt `"mnemonic" + passphrase`). `generateMnemonic(strength)` defaults to 128-bit entropy (12 words); `generateNewAccount` in `lib/accounts.ts` requests 256-bit entropy (24 words) so that post-quantum keys can later be derived from the same seed without the seed being the weakest link. Both 12- and 24-word phrases remain valid for import. |
| `bech32.ts` | Bech32 and bech32m encoding/decoding for Nostr entities: `npubEncode`, `npubDecode`, `nsecEncode`, `nsecDecode`. |
| `bip39-wordlist.js` | BIP-39 English wordlist (2048 words). Plain JS, no TypeScript needed. |
| `utils.ts` | Hex-to-bytes and bytes-to-hex conversion utilities (`hexToBytes`, `bytesToHex`). |

## Post-quantum message sizes

The wire format and the reference implementation live in
[`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq). Measured
on the complete `kind:1059` gift wrap, as a relay sees it:

| message | classic NIP-17 | post-quantum | overhead | ratio |
|---|---|---|---|---|
| "hi" (2 chars) | 1,533 B | 4,605 B | +3,072 B | 3.0x |
| chat line (32) | 1,701 B | 4,605 B | +2,904 B | 2.7x |
| a tweet (280) | 2,213 B | 5,285 B | +3,072 B | 2.4x |
| a paragraph (1 KB) | 3,921 B | 7,333 B | +3,412 B | 1.9x |
| a long note (4 KB) | 11,429 B | 14,161 B | +2,732 B | 1.2x |
| a document (16 KB) | 38,737 B | 44,197 B | +5,460 B | 1.1x |

About **3 KB constant overhead**, almost all of it the 1568-byte ML-KEM ciphertext, which
base64 expands at every NIP-59 layer. At 100 messages a day that is +300 KB/day, or
+107 MB/year per conversation.

The `kind:10203` attestation itself is roughly 12 KB, but it is a replaceable event
published once per identity and only rewritten on key rotation.

Note that NIP-59 is already expensive on its own terms — a *classic* two-character "hi"
costs 1,533 bytes. Post-quantum raises that floor rather than creating it.

Placing the post-quantum envelope at the **seal** layer rather than inside the rumor saves
16-28%, because it removes one of the three base64 expansions the ML-KEM ciphertext would
otherwise pass through. That is a framing choice, not a cryptographic one.
