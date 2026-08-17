# NIP proposals

Draft specifications for the post-quantum work this extension implements.

Nostr has no post-quantum story yet. This extension shipped one anyway, because
harvest-now-decrypt-later is the half of the problem that has to be fixed *before*
a cryptographically relevant quantum computer exists, not after. Everything
encrypted under secp256k1 today and captured by a relay today is decryptable the
day that machine arrives. Nothing done later helps those messages.

Shipping first is a choice with a cost: an implementation that nobody else can
talk to is a private protocol wearing Nostr's clothes. These drafts are the
attempt to pay that cost down. They describe what is already running, in enough
detail that a second implementation can interoperate without reading our source.

## The drafts

| Draft | What it covers | Depends on |
|---|---|---|
| [01 — Key derivation](01-pq-key-derivation.md) | Deriving ML-KEM and ML-DSA keys from the BIP-39 seed a Nostr identity already has | NIP-06 |
| [02 — Key attestation](02-pq-key-attestation.md) | `kind:10203`, how a pubkey publishes its post-quantum keys and proves it holds them | NIP-01, 01 |
| [03 — NIP-44 post-quantum envelope](03-pq-nip44-envelope.md) | The hybrid ML-KEM + NIP-44 payload format | NIP-44, 02 |
| [04 — Signer capability](04-nip07-encryption-capability.md) | `window.nostr.nip44.schemes`, so a client can ask a signer instead of guessing | NIP-07, 03 |

Read them in order. Each one assumes the one before it.

## Status

**None of these has a NIP number.** They are not submitted to
[nostr-protocol/nips](https://github.com/nostr-protocol/nips) yet, and the
numbers in the filenames are reading order, nothing more. The one number that is
claimed in the wild is the event kind `10203`, which is in use on relays today
and would need to change if it collides with something in flight.

Everything here is implemented and running:

| Draft | Implementation |
|---|---|
| 01, 02 | `lib/crypto/pq.ts`, `lib/bg/pqc-handlers.ts` |
| 03 | `lib/crypto/pq.ts` (envelope section), [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq) |
| 04 | `inject.ts`, `lib/signer.ts`, [`@nostr-wot/signers`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/signers) |

A second implementation exists in [Obelisk](https://github.com/obelisk-app/obelisk),
which consumes all four through the SDK rather than reimplementing them. That is
one and a half implementations, not two, and it is not enough to call any of this
settled.

## What these drafts deliberately do not do

**They do not make Nostr post-quantum.** Event signatures are still secp256k1,
and that is a protocol-wide change no client can make alone. What is protected
here is message *confidentiality* against an adversary recording traffic now.
Authenticity, identity and the attestation binding itself all still rest on
secp256k1. Draft 02 says where that bites.

**They do not replace NIP-44.** The post-quantum key is mixed *with* the
classic conversation key, never instead of it. If ML-KEM turns out to be broken,
the result is exactly NIP-44, which is where we started. That property is worth
more than the smaller payloads a KEM-only construction would give.

**They do not cover metadata.** Who talks to whom is NIP-17's problem, and
NIP-17 is not affected by any of this. See
[Obelisk's notes](https://github.com/obelisk-app/obelisk/blob/main/docs/dm-metadata-privacy.md)
on how easy that guarantee is to throw away by accident.

## Feedback

Open an issue on this repository. Disagreement about the wire format is more
useful now than after a second client ships against it.
