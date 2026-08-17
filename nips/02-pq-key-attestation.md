# 02 — Post-quantum key attestation (`kind:10203`)

`draft` `optional`

A replaceable event through which a pubkey publishes its post-quantum public keys
and proves it holds them.

## Motivation

ML-KEM is a key encapsulation mechanism: to send someone a post-quantum protected
message you need their encapsulation key first. Nothing in Nostr carries one.
Without a discovery mechanism the encryption in draft 03 is unreachable, because
a sender has nowhere to look up the key it needs.

That makes this the load-bearing draft. Encryption formats can be swapped later.
A key discovery event, once clients are reading it, is much harder to move.

## Event

```jsonc
{
  "kind": 10203,
  "pubkey": "<the identity this attests to>",
  "created_at": 1755432000,
  "content": "",
  "tags": [
    ["alg", "ml-kem-1024", "<base64 encapsulation public key, 1568 bytes>"],
    ["alg", "ml-dsa-87",   "<base64 signature public key, 2592 bytes>"],
    ["origin", "derived"],
    ["seed_strength", "256"],
    ["v", "nip-pqc/v1"],
    ["pop", "ml-dsa-87", "<base64 ML-DSA-87 signature, 4627 bytes>"]
  ],
  "id": "...",
  "sig": "..."
}
```

`10203` is in the replaceable range, so relays keep only the newest event per
pubkey. Rotation is therefore just republishing. `content` is empty and carries
no meaning; readers MUST ignore it.

### Tags

| Tag | Cardinality | Meaning |
|---|---|---|
| `alg` | 1 per algorithm | Algorithm identifier and its base64 public key. Exactly one `ml-kem-1024` and one `ml-dsa-87` are required. |
| `v` | 1 | Derivation and envelope profile. `nip-pqc/v1`. |
| `pop` | 1 | Proof of possession: algorithm that signed, and the base64 signature. |
| `origin` | 1 | `derived` if the keys come from the identity's BIP-39 seed per draft 01, `independent` if generated separately. |
| `seed_strength` | 0 or 1 | Entropy in bits of the seed the keys were derived from. Present only when `origin` is `derived`. |

`origin` and `seed_strength` are advisory. A publisher can put anything there,
so a reader MUST NOT treat them as security guarantees. They exist so a user can
be told what they are looking at: an `independent` key means the holder is
carrying a second backup, and a client that knows this can warn them before they
lose it.

Unknown tags MUST be ignored, so that future revisions can add them.

## Proof of possession

The event signature proves that the npub published this event. It proves nothing
about the post-quantum keys inside it, which are just bytes anyone could have
copied from someone else's attestation. Without a possession proof, one pubkey
could republish another's encapsulation key and silently redirect senders into
producing ciphertext only the third party can read.

The ML-DSA key signs a message that binds all three identities together:

```
pop_message = "nip-pqc/v1/pop:" || pubkey_hex || ":" || kem_pk_b64 || ":" || dsa_pk_b64
pop_sig     = ML-DSA-87.Sign(dsa_sk, pop_message)
```

`pubkey_hex` is the 64-character lowercase x-only pubkey. `kem_pk_b64` and
`dsa_pk_b64` are the exact strings that appear in the `alg` tags, not a
re-encoding of the decoded bytes, so that a base64 variation cannot make a valid
signature verify against a different string than the one published.

ML-KEM cannot sign, so the encapsulation key has no possession proof of its own.
Binding it into the ML-DSA-signed message is what gives it one, indirectly: a
publisher who can produce a valid `pop` holds the ML-DSA secret, and has stated
under that key which encapsulation key belongs with it.

### Verification

A reader MUST perform all of the following, and MUST reject the attestation
entirely if any fails. Partial acceptance, such as using the encapsulation key
after a failed `pop` check, defeats the purpose of the proof.

1. The event signature is valid for `pubkey` per NIP-01.
2. The `v` tag is present and recognised.
3. Exactly one `ml-kem-1024` and one `ml-dsa-87` `alg` tag are present.
4. Both public keys decode from base64 to exactly 1568 and 2592 bytes.
5. `pop_message` is rebuilt from `event.pubkey` and the two tag strings as
   published, and `ML-DSA-87.Verify(dsa_pk, pop_message, pop_sig)` returns true.

## What this does not protect against

**The binding is not itself post-quantum.** The attestation is authenticated by
its secp256k1 event signature. An adversary with a quantum computer can forge
that signature and publish a replacement attestation carrying their own
encapsulation key, and readers would accept it, because every check above would
pass on the forged event.

This is not a flaw that can be fixed inside this draft. It is a consequence of
Nostr event signatures being secp256k1, and it will remain until that changes
protocol-wide.

What this scheme does protect is confidentiality against **recording now,
decrypting later**, which is the threat that is real today: traffic captured
this year and decrypted whenever the machine arrives. An adversary who has a
quantum computer at the moment of the conversation is a different and later
threat, and defeats this the way they defeat everything else in Nostr.

Say this plainly to users. "Quantum secure" is the wrong claim; "the messages
being recorded today stay unreadable" is the right one.

## Client behaviour

**Publishing.** A client SHOULD publish the attestation to the user's write
relays. A user who holds post-quantum keys but has published nothing is
undiscoverable, and nobody can send to them. Copying JSON into another tool is
not a substitute.

**Checking.** A client SHOULD verify what is actually on relays rather than
trusting a local flag, so the state stays correct when the attestation was
published from another device or was never really accepted. It SHOULD also
compare the published encapsulation key with the current one, since a stale
attestation left after a key rotation causes senders to encrypt to a key the
recipient no longer holds. Published and current are two different questions.

**Reading.** A client that resolves a peer's attestation SHOULD cache it. Keys
rotate rarely, so a long time to live is appropriate for a successful lookup. A
failed lookup MUST NOT be cached for long: a peer who publishes an attestation
minutes after you looked should not be treated as post-quantum incapable for
hours. Absence and failure are the same observation here, and both are
temporary.

**Size.** The two public keys and the proof come to roughly 11.7 KB of base64,
which is far larger than a typical event. Relays with event size limits may
reject it. A client SHOULD surface a rejection rather than reporting success on
a publish that no relay accepted.

## Relationship to other NIPs

This does not change NIP-01, and requires nothing of relays beyond storing a
replaceable event. It is consumed by draft 03, which needs the encapsulation
key, and it is what makes the capability question in draft 04 answerable.

## Reference implementation

`lib/bg/pqc-handlers.ts` and `lib/crypto/pq.ts` in this repository. The
attestation-reading side is in
[Obelisk](https://github.com/obelisk-app/obelisk/blob/main/src/lib/pq/attestations.ts).
