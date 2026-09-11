# 06 - Hybrid event authentication over NIP-01

`proposal` `optional` `not implemented` `cryptographic review required`

A candidate public-event format retaining the ordinary NIP-01 event signature
and adding an ML-DSA proof in a signed tag. Existing clients can still read the
content. Upgraded verifiers require both proofs and a trusted PQ key binding.
This is a design for review, not an allocated NIP or a production security claim.

## Preserve the existing event

Do not replace `sig`, change `pubkey`, change kinds or alter the NIP-01 hash
serialization. Do not add an unsigned top-level algorithm selector. Attach one
tag, placed last, before computing the normal event ID and BIP-340 signature:

```text
["pq", "nostr-wot/hybrid-event/1", "<attestation-event-id>", "<base64 proof>"]
proof bytes = suite:u8 || ML-DSA-signature
suite 0x01 = ML-DSA-87, pure signing mode, empty ML-DSA context
```

This suite byte belongs to this signature profile, independently of draft 03's
encryption suite byte. It is experimental and unallocated upstream. The profile
string is framing/version context, not repeated algorithm descriptions. No tag
is added to ordinary events. Exactly one tag of this name is allowed in this
profile, with exactly four string elements, and it must be last.

The attestation ID is 64 lowercase hex characters. The proof uses canonical padded
RFC 4648 base64 without whitespace. Suite 1's decoded proof is 4628 bytes: one
selector and a 4627-byte signature. Public keys stay in the referenced attestation,
avoiding their repetition in every event. Retrieval still needs bounded caching.

## Non-circular signing transcript

A signature inside a tag cannot sign the final event ID that contains itself.
Use the following exact order instead. Let `T` be the original ordered tags with
no `pq` tag, and let `A` be the referenced attestation ID:

```text
D = SHA256(UTF8(NIP01_SERIALIZE([0, pubkey, created_at, kind, T, content])))
M = UTF8("nostr-wot/hybrid-event/1") || 0x00 || 0x01 || HEX_DECODE(A) || D
S = ML-DSA-87.Sign(dsa_sk, M, context = empty)
proof = BASE64(0x01 || S)
final_tags = T || [["pq", "nostr-wot/hybrid-event/1", A, proof]]
final_id = ordinary NIP-01 hash using final_tags
sig = ordinary BIP-340 signature of final_id
```

`NIP01_SERIALIZE` means the exact serialization rules used for a NIP-01 event
hash; no extra nested array, whitespace, Unicode normalization or key ordering
step. Hash bytes and decoded attestation ID are each 32 bytes. ML-DSA signs `M`
in pure mode, not HashML-DSA. Use approved signing randomness for production.

This binds author, time, kind, all original tags, content, suite and attestation.
The final classical signature additionally binds the PQ signature bytes. The PQ
proof authenticates this logical event transcript, not every byte of the final
classical event ID. Verifiers must keep that distinction when exposing IDs.

## Verification and trusted identity state

1. Check the ordinary NIP-01 event and BIP-340 signature. Reject duplicate `pq`
   tags, wrong placement/arity, unsupported profile/suite and noncanonical encoding.
2. Resolve the exact attestation by ID; validate its event and possession proof
   under draft 02, and require its `pubkey` to equal this event's author.
3. Require the binding to agree with locally trusted/pinned identity state. A
   valid self-attestation alone does not establish continuity after a classical
   break. Unknown or conflicting bindings remain untrusted, not PQ-authenticated.
4. Remove only the single final proof tag, recompute `D` and `M`, and verify the
   ML-DSA proof with the bound key. Both signatures MUST pass; never accept either
   one as an alternative when the hybrid policy applies.
5. Apply replacement/deletion and application semantics only after verification.

A missing attestation is an unresolved dependency, not permission to accept the
proof. Relays may reject it pending resubmission; limit dependency fetches, avoid
arbitrary supplied URLs, and never label queued work accepted before verification.

## Pinning, rotation and downgrade resistance

Before a classical break, a verifier can establish a PQ binding through an
authenticated channel and retain it durably. Record author, exact PQ key,
attestation ID and minimum authentication policy. A new device needs an
authenticated transfer of that state. NIP-01 timestamps and a fetched
`kind:10203` event alone do not prove a binding was established before compromise.

Draft 02's replaceable discovery event is insufficient as a permanent rotation
history. Keep the exact referenced attestation and trust state; do not silently
substitute whichever attestation is newest. A later rotation protocol must bind
the old and new PQ keys, require authorization by the previously trusted PQ key,
and specify rollback/recovery rules. Until that protocol is specified and tested,
rotation requires an explicit authenticated re-pinning procedure. A new classical
signature alone MUST NOT reset a pin, revoke a PQ key or authorize recovery.

After a classical break an attacker can strip the proof and re-sign an event.
Pinned clients/relays therefore require hybrid proofs for the protected author;
accepting classical-only writes would defeat the migration. Legacy participants
remain vulnerable. The same requirement covers replacement and deletion events.

An attacker could also re-sign a previously PQ-authenticated transcript under a
different final event ID after a classical break. Track `(author, D)` as the
logical replay identity in addition to the normal event ID. Applications must
resolve this aliasing before claiming PQ-safe reply, deletion or reference
semantics. This draft does not replace NIP-01's SHA-256 event IDs or promise a
256-bit post-quantum security level for the whole protocol.

## Private messages are a separate authentication boundary

This tag is a PUBLIC-event proposal. Do not attach the sender's stable PQ key or
attestation reference to an ephemeral kind-1059 wrapper. Doing so would expose
sender identity. Nor should this proposal silently change kind-13 seal tags or
turn unsigned rumors into transferable signed messages.

A relay sees the wrapper, not the sender's encrypted seal. It cannot verify a
hidden sender proof. Future PQ sender authentication needs a separately specified
private envelope, recipient-side verification, identity binding and analysis of
deniability. Likewise, PQ wrapper spam controls and NIP-42 access authentication
need their own design. Draft 03 improves confidentiality independently of these.

## Review gates and negative vectors

Before deployment, publish deterministic serialization/signature vectors from two
independent implementations, then test modified author/time/kind/content/tags,
selector substitution, altered attestation, duplicate or moved proof tags,
invalid base64, unknown suites, missing keys, stripped proofs, stale rotations,
replacement/deletion downgrade and logical replay aliases. Benchmark verification
and cache-miss floods under the limits in draft 05.

These are required future checks, not tests claimed to have passed. Open work:
upstream tag allocation, authenticated rotation/recovery, stable reference
semantics under classical forgery, and independent cryptographic review.

## References

[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[draft 02](02-pq-key-attestation.md),
[draft 05](05-relay-crypto-agility.md),
[FIPS 204](https://doi.org/10.6028/NIST.FIPS.204).
