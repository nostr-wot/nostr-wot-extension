# 01 — Post-quantum key derivation from a BIP-39 seed

`draft` `optional`

Derives an ML-KEM-1024 encapsulation key pair and an ML-DSA-87 signature key pair
from the BIP-39 seed a NIP-06 identity already has, so that one mnemonic restores
both the classic and the post-quantum halves of an identity.

## Motivation

A user who already has a Nostr identity has a mnemonic, a backup routine, and a
mental model of what that phrase protects. Handing them a second, unrelated key
file to store means most people end up protecting neither properly.

Derivation is not free of risk, though, and the shape of it matters more than the
fact of it. Get the relationship between the keys wrong and the post-quantum key
inherits the exact weakness it exists to remove.

## The rule that everything rests on

**Post-quantum keys are siblings of the secp256k1 key, never children of it.**

Both are derived from the seed, independently. Neither is derived from the other.

```
                 BIP-39 seed
                 /         \
          BIP-32            HKDF
            |              /    \
       secp256k1     ML-KEM    ML-DSA
```

The reason is Shor's algorithm. A quantum adversary who sees a published Nostr
pubkey can recover the corresponding secp256k1 private key. If the post-quantum
key were derived from that private key, as `pq = KDF(nsec)`, the adversary would
recover the private key, run the same KDF, and hold the post-quantum key too. The
construction would be circular and worth nothing.

Deriving from the seed instead means the adversary would have to invert BIP-32 to
get from the private key back to the seed. That direction is one-way, so the
post-quantum keys stay out of reach.

An implementation MUST NOT accept a private key as derivation input. Implementers
who find `derivePqKeys(seed)` awkward to plumb, because the seed is held further
from the crypto than the private key is, should be aware that passing the private
key instead is the single mistake that silently voids the entire scheme.

## Seed strength

The seed is now the limiting factor for both halves of the identity, so it has to
match the post-quantum target.

A 24-word BIP-39 mnemonic carries 256 bits of entropy. A 12-word mnemonic carries
128. ML-KEM-1024 and ML-DSA-87 are chosen for a 256-bit security target, so
deriving them from 128 bits produces keys that are the right size and the wrong
strength, and look identical from the outside.

Implementations MUST refuse to derive from a mnemonic shorter than 24 words, and
MUST say why rather than silently deriving something weaker than advertised. Such
accounts can still hold post-quantum keys by generating them independently, at the
cost of a second backup. Draft 02 records which of the two happened, in the
`origin` tag.

## Derivation

Let `seed` be the 64-byte BIP-39 seed from `mnemonicToSeed(mnemonic, "")`, and
`account` the NIP-06 account index of the secp256k1 key (the `a` in
`m/44'/1237'/a'/0/0`), so the two halves stay aligned when a user holds several
identities in one mnemonic.

```
PROFILE = "nip-pqc/v1"

PRK      = HKDF-Extract(SHA-256, salt = "", IKM = seed)

kem_seed = HKDF-Expand(SHA-256, PRK, info = PROFILE || "/ml-kem-1024/" || account, L = 64)
dsa_seed = HKDF-Expand(SHA-256, PRK, info = PROFILE || "/ml-dsa-87/"   || account, L = 32)

(kem_pk, kem_sk) = ML-KEM-1024.KeyGen(kem_seed)     # 64 bytes: d || z
(dsa_pk, dsa_sk) = ML-DSA-87.KeyGen(dsa_seed)       # 32 bytes: xi
```

`account` is the decimal integer with no padding, so index 0 gives
`nip-pqc/v1/ml-kem-1024/0`.

The salt is empty because the BIP-39 seed is already uniformly high-entropy;
HKDF-Extract is here for domain separation, not for entropy concentration.

The `info` strings are what keep the two algorithms' seeds independent of each
other and of the BIP-32 path. They MUST be reproduced byte for byte, including
the profile prefix and the separators, or two implementations will derive
different keys from the same mnemonic and neither will be able to tell why.

### Sizes

| | ML-KEM-1024 | ML-DSA-87 |
|---|---|---|
| Public key | 1568 bytes | 2592 bytes |
| Signature | n/a | 4627 bytes |
| Ciphertext | 1568 bytes | n/a |

Per FIPS 203 and FIPS 204. Implementations SHOULD reject public keys of any other
length before using them, since a length check is the cheapest way to catch a
malformed or truncated attestation.

## Versioning

`PROFILE` is `nip-pqc/v1`. It appears in every `info` string, in the
attestation's `v` tag (draft 02) and in the envelope's associated data (draft 03).

Any change to the derivation, the algorithms, or the parameter sets MUST bump the
profile. A reader that does not recognise a profile MUST treat the keys as
unusable rather than guessing, because the failure mode of guessing is encrypting
to a key the recipient cannot decrypt with.

## Storage

Derived keys need not be stored. They are a pure function of material the wallet
already holds, so they can be recomputed on demand in a few milliseconds. Not
storing them means no vault migration and no additional secret at rest.

Independently generated keys MUST be stored, since there is nothing to recompute
them from, and MUST be backed up separately from the mnemonic. A user with an
independent post-quantum key who backs up only their mnemonic will restore an
identity that can no longer read its own message history.

Secret key material SHOULD be zeroed as soon as an operation finishes.

## Reference implementation

`lib/crypto/pq.ts` in this repository, and
[`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq).

## Test vector

Using the 24-word mnemonic published in NIP-06, with an empty passphrase, at
account index 0:

```
mnemonic  what bleak badge arrange retreat wolf trade produce cricket blur
          garlic valid proud rude strong choose busy staff weather area
          salt hollow arm fade

secp256k1 c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add

SHA-256(kem_pk)  f15e1a31adc3198a3e09f1d473aa0f2cd3e28392b77f1e350468bae15dfa251b
SHA-256(dsa_pk)  6912f6f1dd8f8e6c1d9e7d349d75ef1b582ccf2aa95636bf2445b0e22be18e16
```

The public keys are hashed rather than printed because they are 1568 and 2592
bytes. The secp256k1 key is included so an implementation can confirm it is
starting from the right seed before blaming the post-quantum half.

Pinned in `tests/crypto/pq.test.ts`. A full vector file should accompany this
draft before it is submitted anywhere.
