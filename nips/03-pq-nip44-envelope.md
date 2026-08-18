# 03 — Post-quantum envelope for NIP-44 payloads

`draft` `optional`

A payload format that combines an ML-KEM-1024 encapsulation with the NIP-44
conversation key, so that a message stays confidential against an adversary
recording it today and decrypting it after secp256k1 falls.

## Motivation

NIP-44's conversation key is a secp256k1 ECDH product. Every message encrypted
under it is recoverable by anyone who can solve discrete log on that curve, which
is what Shor's algorithm does. Traffic captured now is decryptable then, and no
change made later helps the messages already recorded.

## Hybrid first

The ML-KEM shared secret is mixed **with** the NIP-44 conversation key, never used
instead of it.

```
shared_secret   = ML-KEM-1024.Encapsulate(recipient_kem_pk)      # 32 bytes
conversation_key = NIP-44 v2 conversation key                    # 32 bytes

PRK = HKDF-Extract(SHA-256, salt = "", IKM = shared_secret || conversation_key)
key = HKDF-Expand(SHA-256, PRK, info = "nip-pqc/v1/hybrid", L = 32)
```

An implementation of **this profile** MUST NOT use either input alone.

That is a statement about `nip-pqc/v1`, not a position on where Nostr should end
up. Replacing the classic key exchange outright is the better destination, and it
is one no single client can reach: it needs relays, signers and every other client
to move together. Hybrid is what can be deployed unilaterally in the meantime,
and it closes harvest-now-decrypt-later, which is the half of the problem that
cannot be fixed retroactively and therefore cannot wait for that coordination.

Being incremental costs little. Lattice cryptography is young by comparison with
elliptic curves, and if ML-KEM is broken tomorrow the hybrid degrades to exactly
NIP-44, which is where every Nostr client already is. A KEM-only construction
would trade that floor away for a smaller payload, which is a poor trade while
the ecosystem is still deciding.

A future profile that drops the classic input is expected, and the version and
algorithm bytes exist so it can be introduced without breaking this one.

The ordering `shared_secret || conversation_key` is fixed and MUST be preserved.

## Wire format

```
+---------+-----+------------------+-----------+---------------------------+
| version | alg |  KEM ciphertext  |   nonce   |  XChaCha20-Poly1305 output |
|  1 byte | 1 B |    1568 bytes    |  24 bytes |     padded plaintext + tag |
+---------+-----+------------------+-----------+---------------------------+
```

Base64 encoded for transport, exactly like a NIP-44 payload.

| Field | Value |
|---|---|
| `version` | `0x01` |
| `alg` | `0x01`, meaning ML-KEM-1024 with XChaCha20-Poly1305 |
| KEM ciphertext | Output of `ML-KEM-1024.Encapsulate`, 1568 bytes |
| nonce | 24 random bytes, fresh per message |
| ciphertext | AEAD output over the padded plaintext, including the 16-byte tag |

The header is 1594 bytes. With the smallest padded plaintext (34 bytes) and the
tag, the shortest possible envelope is 1644 bytes before base64.

### Self-describing on purpose

The version and algorithm bytes lead the payload so that a decrypting signer can
route on the payload itself rather than being told which scheme was used. This is
why decryption in draft 04 takes no flag and cannot be got wrong by a caller.

It follows that any future scheme MUST be distinguishable by these two leading
bytes. A new scheme that reuses `0x01 0x01` with different semantics breaks every
existing reader.

A classic NIP-44 v2 payload begins with the version byte `0x02`, so the two are
distinguishable and no NIP-44 payload can be mistaken for an envelope.
Implementations SHOULD test this explicitly, since a false positive in that
direction would break ordinary traffic rather than just post-quantum traffic.

### Associated data

```
AD = "nip-pqc/v1/env:" || version || ":" || alg || ":" || sender || ":" || recipient || ":" || kem_ciphertext
```

`version` and `alg` are decimal integers, so version 1 with algorithm 1 gives the
prefix `nip-pqc/v1/env:1:1:`. `sender` and `recipient` are 64-character lowercase
x-only pubkey hex.

Binding both pubkeys means a ciphertext cannot be replayed into a different
conversation. Binding the version and algorithm means it cannot be presented as
having used a weaker scheme. Binding the KEM ciphertext means the encapsulation
cannot be swapped for another.

**Both pubkeys MUST be validated as 64 lowercase hex characters before use.** The
fields are joined with `:`, so unvalidated input allows two different party pairs
to produce identical associated data: a sender of `aaaa:bbbb` with recipient
`cccc` yields the same string as a sender of `aaaa` with recipient `bbbb:cccc`.
This was a real defect in an early implementation of this format, fixed in
`@nostr-wot/pq@0.2.1`.

### Padding

The plaintext is padded exactly as NIP-44 v2 pads, with a two-byte big-endian
length prefix ahead of the padded body. Minimum padded length is 32 bytes and
maximum plaintext is 65535 bytes.

Reusing NIP-44's scheme rather than inventing one keeps the length leakage
characteristics identical to what Nostr clients already accept, and means one
padding implementation serves both paths.

The KEM ciphertext adds a fixed 1568 bytes to every message, which dominates the
cost of the format. The overhead is constant rather than proportional, so it
falls hardest on short messages, which is most messages. Measured end to end on a
`kind:1059` gift wrap it works out at about 3 KB constant, or 2.7x on a one-line
chat message; the tables are in the repository README and in `@nostr-wot/pq`.

## Decryption

```
1. Base64 decode. Reject if shorter than the minimum length.
2. Reject if version != 0x01 or alg != 0x01.
3. shared_secret = ML-KEM-1024.Decapsulate(kem_ciphertext, our_kem_sk)
4. key = hybrid(shared_secret, conversation_key)
5. Verify and decrypt with AD rebuilt from the sender and recipient.
6. Unpad.
```

**Every failure MUST produce one indistinguishable error.** A malformed payload,
a failed tag check, a bad padding length and a decapsulation failure must not be
separable by the caller, by error message or by timing. Distinguishing them turns
the decryptor into an oracle.

Note that ML-KEM decapsulation does not fail on a bad ciphertext; it returns an
unrelated shared secret by design. The failure therefore surfaces at the AEAD tag
check, which is the intended behaviour and not something to special-case.

## Key material requirements

Encryption needs the raw NIP-44 conversation key. Decryption needs the ML-KEM
secret key. Neither is exposed by NIP-07 or by NIP-46, which return finished
ciphertext and nothing else.

**This construction can therefore only be performed by the component that holds
the key material.** In a browser extension that is the signer, not the page. A
client library cannot implement this on top of a signer's public interface, no
matter how it is layered, and an architecture that tries will end up either
exporting the conversation key or reimplementing the signer.

This is the constraint that produces draft 04: since the page cannot do the work
itself, the signer has to do it, and the page has to be able to find out whether
this particular signer will.

## Reference implementation

`lib/crypto/pq.ts` in this repository, and
[`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq),
which is the normative one for the wire format.
