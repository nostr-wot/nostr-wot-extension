# NIP proposals

Draft specifications for implemented post-quantum messaging and proposed relay migration.

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

| [05 - Relay crypto-agility](05-relay-crypto-agility.md) | Compact envelope selectors, opaque transport, NIP-11 discovery and relay policy | NIP-01, NIP-11, NIP-17, 03 |
| [06 - Hybrid event authentication](06-hybrid-event-authentication.md) | Candidate dual-signature public events, trust pinning and downgrade handling | NIP-01, 02, 05 |

Drafts 01-04 describe existing work. Drafts 05-06 propose the next migration stage.

## Status

**None of these has a NIP number.** They are not submitted to
[nostr-protocol/nips](https://github.com/nostr-protocol/nips) yet, and the
numbers in the filenames are reading order, nothing more. The one number that is
claimed in the wild is the event kind `10203`, which is in use on relays today
and would need to change if it collides with something in flight.

Implementation status (05-06 are proposals, not shipped capabilities):

| Draft | Implementation |
|---|---|
| 01, 02 | `lib/crypto/pq.ts`, `services/background/pqc-handlers.ts` |
| 03 | `lib/crypto/pq.ts` (envelope section), [`@nostr-wot/pq`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/pq) |
| 04 | `inject.ts`, `services/signing/signer.ts`, [`@nostr-wot/signers`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/signers) |

Drafts 05-06 have no implementation or independent interoperability results yet.

A second implementation exists in [Obelisk](https://github.com/obelisk-app/obelisk),
which consumes all four through the SDK rather than reimplementing them. That is
one and a half implementations, not two, and it is not enough to call any of this
settled.

## Migration boundaries

Start with message confidentiality using the existing compact envelope. Relays
can carry it without understanding its encryption; legacy recipients still need
an upgraded decryptor. The classical outer gift wrap also means metadata is not
post-quantum protected. Draft 05 makes these boundaries explicit.

Event authentication needs separate verifier support and durable trusted key
bindings. Draft 06 explores an additive public proof while retaining NIP-01's
outer fields. It is not a completed protocol-wide identity migration. Encryption
and signature suite identifiers have separate namespaces and purposes.

No new byte is imposed on every Nostr event. Draft 03 already has a version byte
and an algorithm byte, and keeps its existing wire format. New signatures add
substantial proof bytes only to events that opt in.

## Feedback

Open an issue on this repository. Disagreement about the wire format is more
useful now than after a second client ships against it.
