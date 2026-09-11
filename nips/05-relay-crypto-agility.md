# 05 - Relay transport and crypto-agility discovery

`proposal` `optional` `not implemented`

Preserve NIP-01 events and relay commands while clients migrate confidentiality first and event authentication separately. This document proposes relay behavior and a namespaced NIP-11 extension. It has no allocated NIP number.

## Two independent capabilities

An encryption suite tells the recipient how to decrypt. A signature suite tells a verifier how to authenticate. Neither implies support for the other.

A relay can store an opaque encrypted payload without implementing its KEM or AEAD. It MUST NOT require recipient keys, decrypt DMs, or claim that accepting an event establishes the confidentiality of its content. Existing relay size, authorization and retention policies still apply.

An upgraded relay can additionally verify the public signature proof proposed in [draft 06](06-hybrid-event-authentication.md). That requires implementation and trusted key state; passing ordinary NIP-01 verification alone is insufficient.

## Compact payload selector

Reuse [draft 03](03-pq-nip44-envelope.md):

```text
base64(version:u8 || suite:u8 || suite-defined payload)
existing local pair: 0x01 0x01
```

The existing `alg` byte is the complete suite selector: ML-KEM-1024, the defined hybrid combiner, XChaCha20-Poly1305, padding and associated-data rules together. Changing any cryptographic semantics requires a new allocation or format version. A new byte value is a specification entry, not executable algorithm negotiation.

These are LOCAL identifiers within `nip-pqc/v1`, not allocations in NIP-44's version registry. Keep NIP-44 v2's `0x02` untouched. Detection applies only where the application explicitly accepts this experimental envelope, never to arbitrary base64-looking event content. Unknown versions/suites fail closed at the recipient; a parsing failure MUST NOT trigger a classical decryption retry or resend.

The existing header already contains both bytes. Add no universal event field, plaintext prefix or public DM tag. Ordinary events gain zero bytes. Within this format, suite selection costs one byte; version plus suite costs two. Base64 length is `4 * ceil(n / 3)`, so adding one binary byte changes encoded length by zero or four characters depending on alignment. KEM ciphertext and authentication proofs dominate the actual cost.

The selector is authenticated by draft 03's associated data, together with both parties and the KEM ciphertext. Do not duplicate it as an unsigned top-level `encryption` field: NIP-01's event hash would not bind such a field.

Future formats need fixed parameter sets, encoding, lengths, domain separation, key binding, downgrade rules and independent test vectors before allocation. Unknown values remain unsupported; there is no fallback meaning for zero or 255.

## DM placement and compatibility

The current SDK puts the hybrid envelope in the kind-13 seal's `content`, encrypting the entire unsigned rumor. The kind-1059 gift wrap remains ordinary NIP-44 v2 with a fresh ephemeral signing key. Keep the rumor content as text and retain the seal/rumor author equality check.

This preserves relay transport and event kinds. It is an experimental extension of NIP-17/NIP-59 encryption, not full legacy recipient interoperability: an older recipient cannot decrypt the hybrid seal. Discover signer and recipient support before sending. Required PQ confidentiality must fail visibly when unavailable; never publish a second classical copy as a delivery workaround. Apply this to sender backup copies and every group recipient too.

The classical outer wrap can eventually expose the seal's author and timestamp to a quantum adversary recording traffic, even if the inner message remains confidential. Do not claim post-quantum metadata protection or forward secrecy from this construction.

Keep recipient inbox routing and access controls from NIP-17. Do not add public sender attestations, suite tags or stable PQ identifiers to gift wraps. A larger payload is not authorization to fan out to additional relays.

## Proposed NIP-11 extension

Example only; these values do not describe a deployed relay:

```json
{
  "supported_nips": [1, 11],
  "limitation": {
    "max_message_length": 131072,
    "max_content_length": 98304,
    "restricted_writes": true
  },
  "org.nostr-wot.crypto": {
    "version": 1,
    "opaque_content": true,
    "event_auth": {
      "profiles": ["nostr-wot/hybrid-event/1"],
      "policy": "verify-present",
      "max_proofs_per_event": 1
    }
  }
}
```

`opaque_content: true` describes content handling, not unrestricted acceptance. Encryption-suite lists are intentionally absent: a relay cannot discover an inner encrypted selector, and does not need to support it to transport it. Recipient/signer capabilities belong in their own authenticated discovery.

`event_auth.profiles` lists public proof verifiers actually implemented. `verify-present` means reject invalid/unknown proofs when present, while ordinary classical events remain allowed except for locally pinned protected identities. A relay that requires a proof on every eligible write uses `require` and documents its supported kinds. A transport-only relay omits `event_auth`. Unsupported namespace versions are unknown capability, not proof support.

Keep numeric `supported_nips` for actual NIPs implemented; do not put local draft numbers 05 or 06 there. NIP-11 discovery can be absent, stale or dishonest. Clients verify proofs independently and enforce their own minimum policy. Discovery MUST NOT lower a pinned identity's security requirement.

## Relay processing

1. Bound incoming bytes before JSON parsing and bound tags, strings and proof counts before decoding or expensive cryptography. Rate-limit verification.
2. Validate normal NIP-01 structure, event ID and BIP-340 signature.
3. If a public proof is present and this verifier is advertised, perform all draft-06 checks. Apply pinned-identity requirements even when a proof is absent. A failed proof MUST NOT be retried as a classical event.
4. Only after validation, apply storage, replacement, deletion and access policy. Preserve signed content and tag order exactly. Never strip proofs on export.
5. Return ordinary NIP-01 `OK` results. Suggested failures are `invalid: hybrid proof failed`, `blocked: hybrid proof required`, and `rate-limited: verification budget exceeded`. An accepted event is not evidence that a DM was read.

Protect replacement and deletion consistently: an unprotected classical event must not overwrite or delete protected state for a pinned identity. Disallow unverified duplicate shortcuts that bypass these checks. NIP-42 classical AUTH also remains a separate migration problem; this proposal does not make inbox access control resistant to quantum impersonation.

Measure the final serialized WebSocket message, including nested JSON, base64, tags and signatures. NIP-11 content-character and message-byte limits differ. Report size rejection without changing the chosen suite or weakening inbox privacy.

## Required interoperability cases before implementation claims

| Case | Required result |
|---|---|
| Hybrid DM on a legacy relay within its limits | Can be transported; no PQ verification claim |
| Hybrid DM delivered to a legacy client | Unsupported encryption; no downgrade |
| Unknown inner suite | Recipient rejects; opaque relay need not parse it |
| Modified selector or KEM ciphertext | Recipient authentication failure |
| Public invalid/unknown proof on an advertising relay | Reject |
| No proof for a pinned identity | Reject under the pinned policy |
| NIP-11 unavailable or contradictory | Preserve client policy; report capability uncertainty |
| Oversized event | Reject without fallback publication |
| Group member lacks PQ support | Required-PQ send fails before any weaker copy is sent |

## Sources and implementation boundary

Reviewed 2026-09-11: [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md), [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md), [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md), [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md). Current composition: `nostr-wot-sdk/packages/dm/src/index.ts` (`sealAndGiftWrap`); current byte format: `nostr-wot-sdk/packages/pq/src/envelope.ts`. The namespace, relay policies and acceptance cases above are proposed, not shipped.
