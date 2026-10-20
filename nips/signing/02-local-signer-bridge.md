# Draft: NIP-XX, Local signer bridge over Wi-Fi and Bluetooth

`draft` `optional`

Status: experimental, unnumbered proposal. This is the `nwlan/2` protocol implemented by Nostr WoT, not an accepted NIP. The version, URI scheme, path and UUIDs below describe the current interoperability profile; an upstream number has not been assigned. Physical BLE testing and an implementation maintained independently of Nostr WoT remain outstanding.

## Purpose and relationship to other NIPs

A client can ask a nearby signer to sign Nostr events or perform encryption operations without transferring the user's identity secret or using a public relay for the signing connection. This proposal specifies authenticated pairing, encrypted sessions and two transports: local WebSocket and Bluetooth Low Energy GATT.

The application request and response objects reuse [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md). They are carried directly inside an encrypted session, rather than inside kind 24133 relay events. This is a separate transport profile, not wire compatibility with a `bunker://` connection. An extension may expose the resulting signer through [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md). Local transport does not bypass approval or grant additional methods.

[NIP-BE](https://github.com/nostr-protocol/nips/blob/master/BE.md) describes NIP-01 client/relay traffic over BLE, with different discovery, compression and framing. This proposal is for a client/signer relationship, does not use that framing or its UUIDs, and makes no claim of compatibility with it.

## Roles and keys

The **host** runs the listener and controls the identity used for approved operations. The **peer** initiates the connection. The host can be a phone, desktop or dedicated signer. UI labels and operating systems are outside the protocol.

The identity key, host transport key and peer transport key MUST be separate. Transport keys are secp256k1 keys with 32-byte x-only public keys, represented as 64 lowercase hexadecimal characters. They authenticate the session; they are not the user's signing identity. A pairing secret (PSK) is 32 cryptographically random bytes, used only to admit a new peer while pairing is explicitly enabled.

A host stores an approved peer's public key and authorization policy. A client MAY persist its transport secret for reconnects, using secure storage, or use a memory-only key and pair again after closing. A host MUST NOT treat an IP address, Bluetooth address, device name or caller-supplied website origin as authenticated identity. Peer labels are untrusted display text.

## Pairing offer

The host shows a QR code or copyable URI through a channel the user trusts:

```text
nwlan://<host-public-key>?v=2&transport=wifi&addr=192.168.1.12%3A49152&psk=<secret>&name=Phone
nwlan://<host-public-key>?v=2&transport=ble&psk=<secret>&name=Phone
```

The authority is the host transport public key, which the peer pins before connecting. `v=2` is required. `transport` is `wifi` or `ble`; omission means `wifi` for existing offers. `psk` is canonical unpadded base64url encoding of exactly 32 bytes. `name` is optional and at most 64 characters. Wi-Fi offers contain one to four `addr` fields, tried in order. BLE offers contain no `addr`. Duplicate `v`, `transport`, `psk` or `name` parameters are invalid. Credentials, fragments, ports on the authority, and paths other than empty or `/` are invalid. Offers are capped at 2,048 characters.

An address is a literal IP plus a port from 1 through 65,535; IPv6 literals are bracketed. The current local profile permits IPv4 private, loopback and link-local ranges, and IPv6 loopback, unique-local and link-local ranges. DNS names and public IP destinations are rejected. The host advertises the selected listening port rather than requiring a fixed port. A new offer is needed when that endpoint changes.

Possession of the offer permits a request to pair, not silent authorization to sign. The host MUST verify the pairing proofs and obtain approval before admitting an unknown peer. Closing pairing invalidates its offered PSK. A known peer reconnects by proving its transport key and does not need the PSK. Implementations MUST NOT persist pairing secrets as reconnect credentials or write them to logs.

## Transport mappings

### Local WebSocket

The peer opens `ws://<addr>/nwlan2`. Each WebSocket text message contains one JSON protocol frame. Binary application messages are rejected. WebSocket ping/pong may maintain the connection. Payload confidentiality and peer authentication are supplied by the session protocol below; the socket itself is not TLS-protected. Hosts should bind only the intended local interface and listen only while enabled by the user.

### Bluetooth Low Energy

The host is the GATT peripheral/server and the peer is the central/client. The current experimental profile uses:

| Item | UUID | Behavior |
| --- | --- | --- |
| Service | `8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1200` | Advertised while listening |
| RX | `8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1201` | Peer writes with response |
| TX | `8f93b5a0-6d7c-4d9f-8b01-9d7a6b0e1202` | Host sends notifications |

The peer subscribes to TX before sending its hello. Both directions encode a frame as an unsigned four-byte big-endian byte length followed by exactly that many UTF-8 bytes. Length MUST be between 1 and 65,536. Receivers reassemble across arbitrary chunk boundaries, including split length headers, and reject invalid UTF-8. A frame is never DEFLATE-compressed. Senders serialize writes and MUST NOT interleave frames. The browser reference client uses 20-byte writes for compatibility; native notifications use the central's supported update size. Implementations bound pending queues and release partial frames on disconnect.

OS-level Bluetooth pairing and device chooser selection do not authenticate the signer. The same pinned-key handshake and user authorization used for Wi-Fi are required. Browsers without Web Bluetooth cannot use this adapter. Applications MUST respect platform foreground/background limits and report suspension or disconnect instead of promising continuous availability.

## Encoding and frames

Frames are UTF-8 JSON objects, capped at 65,536 bytes including the envelope. Check the size before parsing or allocating an announced BLE body. Every frame contains integer `v: 2` and a recognized `t`. Unknown optional fields may be ignored. An unsupported version MUST NOT trigger a downgrade. Reject malformed field values before cryptographic processing. Nonces and session identifiers are canonical unpadded base64url encodings of 16 random bytes; signatures encode 64 bytes and MACs encode 32 bytes in the same alphabet. Timestamps are integer Unix seconds. Sequence numbers are positive safe integers.

```jsonc
// Peer -> host, first frame. mac is required for a new pairing.
{"v":2,"t":"hello","peer":"<peer-public-key>","nonce":"<nonce>","ts":1790000000,"sig":"<signature>","mac":"<pairing-mac>","name":"Laptop"}
// Host -> peer, only after authentication and admission.
{"v":2,"t":"welcome","host":"<host-public-key>","session":"<session-id>","sig":"<signature>"}
// Peer -> host.
{"v":2,"t":"req","seq":1,"payload":"<NIP-44-v2-payload>","mac":"<mac>"}
// Host -> peer. seq matches the request answered.
{"v":2,"t":"res","seq":1,"payload":"<NIP-44-v2-payload>","mac":"<mac>"}
// Either direction, immediately followed by closing the transport.
{"v":2,"t":"bye","reason":"denied"}
```

`bye` reasons are `version`, `unauthorized`, `denied`, `replay`, `too-large`, `malformed`, `busy`, `stopped` or `revoked`. A `bye` is unauthenticated and conveys no authority beyond terminating the connection. Its reason MUST NOT be used to alter trusted identity, permissions or keys.

## Authentication and session keys

Let `join` concatenate fields with the single byte `0x1f` (ASCII unit separator). Fields use their canonical wire representation; numeric values use base-10 integer notation. The listed fields cannot contain the separator. All transcript strings are encoded as UTF-8.

| Transcript | Fields in order |
| --- | --- |
| Hello | `nwlan/2/hello`, host public key, peer public key, peer nonce, timestamp |
| Welcome | `nwlan/2/welcome`, host public key, peer public key, peer nonce, session ID |
| Session | `nwlan/2/session`, host public key, peer public key, peer nonce, session ID |
| Request | `nwlan/2/req`, sequence, encrypted payload |
| Response | `nwlan/2/res`, sequence, encrypted payload |

The peer signs `SHA256(hello transcript)` using BIP-340 and its transport secret. An unknown peer also supplies `HMAC-SHA256(PSK, hello transcript)`. The host verifies the offered PSK MAC and peer signature before prompting. For an already approved peer, the signature is required and any supplied PSK MAC is ignored. The host accepts no operation before admission.

The host generates a fresh session ID and signs `SHA256(welcome transcript)` using its transport secret. The peer verifies the returned host key equals the pinned offer key, then verifies this signature against its current handshake nonce. It MUST NOT send operations if either check fails.

Both sides calculate the NIP-44 v2 conversation key from their transport secret and the other transport public key, then derive:

```text
PRK = HKDF-Extract-SHA256(salt = UTF8(session transcript), IKM = conversationKey)
K   = HKDF-Expand-SHA256(PRK, info = UTF8("nwlan/2/mac"), L = 32)
P   = HKDF-Expand-SHA256(PRK, info = UTF8("nwlan/2/payload"), L = 32)
```

Encrypt each application JSON object using the NIP-44 v2 payload construction with `P` as its 32-byte conversation-key input and fresh encryption randomness. The payload retains NIP-44's standard base64 encoding, including padding; it is not base64url. Do not encrypt directly under the pre-session conversation key. Compute the request/response envelope MAC as `HMAC-SHA256(K, corresponding transcript)`, encoded as unpadded base64url. Compare fixed-length MACs in constant time. Verify the envelope before decrypting. Cryptographic failures close the connection.

## Freshness, correlation and lifecycle

A host accepts a hello only when the timestamp differs from its clock by at most 90 seconds and `(peer, nonce)` has not already been accepted. Claim the nonce after proof verification and before asynchronous approval. Retain it until the last instant that timestamp could still pass the clock check. A bounded cache MUST fail closed when full instead of evicting still-valid nonces. The reference host permits 512 entries, eight connections, two unauthenticated connections, and five seconds for the first hello; applications may impose stricter resource limits.

Request sequences start at 1 and increase strictly within each session. Repeated or decreasing sequences close the connection. Responses echo their request sequence and may complete out of order. A peer matches each response to an outstanding sequence, verifies its response MAC, decrypts it and checks the application request ID. Replayed, unsolicited or mismatched responses MUST NOT complete another request. Sequence exhaustion requires a new session.

Timeout or disconnect leaves an operation's outcome uncertain. Clients MUST NOT automatically resubmit signing or other effectful requests. They reject outstanding calls visibly and require a deliberate retry. Stop, revoke, account switch or loss of the selected signer invalidates sessions and prevents late results from being delivered under another identity. A client MUST NOT silently fall back to another account or a locally held identity key.

## Application requests and permissions

Use NIP-46-shaped objects such as `{"id":"1","method":"get_public_key","params":[]}` and responses with the corresponding `id` and a string `result` or `error`. The current reference bridge supports `get_public_key`, `sign_event`, `nip04_encrypt`, `nip04_decrypt`, `nip44_encrypt` and `nip44_decrypt`; unsupported methods return an error, never an implicit grant. NIP-04 is a legacy interoperability option, not the session encryption scheme. This proposal does not standardize batch requests, wallet payments, post-quantum signing, or every NIP-46 extension.

Pairing authenticates the peer transport key. Authorization remains the host's policy for that peer and active identity. A broker's claimed website origin is not independently proven by this handshake; hosts must not treat it as stronger than the broker's assertion. An extension may additionally apply its own per-site permissions before forwarding, but that does not replace host approval.

The peer obtains the identity with an authorized `get_public_key` call and pins the expected identity for the session. Before accepting a `sign_event` result, it verifies the NIP-01 event ID, Schnorr signature, expected author and that the signed fields match the approved template. Pre-signed events presented as signed inputs must be verified; unsigned signing templates are not required to contain a signature. Invalid results produce a visible error and must not be published. Activity records should contain the rejection reason without secrets or decrypted content.

## Security and privacy limits

The pairing URI is sensitive while enabled. A person who obtains it can request pairing with their own transport key; possession does not impersonate a previously paired key. Do not embed identity secrets in offers. Authenticate endpoints by pinned keys, not proximity, names, addresses or BLE UUIDs.

Per-session derivation provides session separation, not forward secrecy. The profile has no ephemeral Diffie-Hellman exchange: recorded traffic can be decrypted after compromise of either retained transport secret. The reference browser discards its peer key on tab closure, which limits retention but is not a substitute for a forward-secret handshake.

Observers can learn transport public keys, endpoints, connection duration and traffic timing/size. Neither local Wi-Fi nor BLE proves physical proximity against a relay attacker. Attackers can disrupt connections, and authenticated peers can submit the same application request twice with fresh sequences. Hosts need approval policies, rate limits, bounded queues, revocation and resource cleanup in addition to cryptography.

## Reference implementations, vectors and adoption gates

- [Nostr WoT browser client](https://github.com/nostr-wot/nostr-wot-extension/tree/main/src/services/signing/localBridge): protocol, client state machine, WebSocket and Web Bluetooth adapters.
- [Client/wallet interoperability tests](https://github.com/nostr-wot/nostr-wot-extension/blob/main/tests/local-bridge-wallet-interop.test.mjs): the browser client against the actual wallet session, with approval, signing, encryption and revocation.
- [Protocol vectors](local-bridge-vectors.json): reproducible transport-key handshake and HKDF examples extracted from the wallet's handshake tests. Secret keys in this fixture are public test data and MUST NOT be used for real identities.
- [Implementation guide](../../docs/local-bridge.md): current setup and platform constraints.

Before recommending wider adoption: validate on physical iOS and Android devices, implement a second client or signer independently, run the vectors across implementations, review replay/cache boundaries and resource exhaustion, and review whether upstream prefers a NIP-46 transport extension or a separate NIP. The URI scheme and BLE UUID allocation remain review topics. Breaking changes require a new wire version; this draft must not silently change the bytes of deployed `nwlan/2` sessions.

### Known implementation gap: replay-cache retention

The current wallet `HandshakeReplayGuard.claim` stores acceptance time and expires entries after 90 seconds. A hello timestamp up to 90 seconds ahead can still pass `withinSkew` after that entry expires. The normative retention rule above is stricter: retain until `hello.ts + 90` inclusive, or conservatively for 180 seconds after acceptance. A fresh-session welcome still protects session ciphertexts; the gap concerns replay of admission hellos. Fix and test the boundary before claiming full conformance or recommending external adoption.
