# Draft: NIP-XX, Same-device signing on iOS

Status: experimental, unnumbered proposal. `draft` `optional`. It describes exactly what the Nostr WoT wallet's iOS signer extension implements today (`targets/signer-action/` in `nostr-wot/nostr-wot-wallet`) and what its reference client library implements (`clients/ios/NostrSameDeviceSigner/` there); where this document says "the signer" or "a client" it means a conforming one, and where it says "the reference signer" it reports a fact about that build. Not an accepted NIP, and not endorsed by any other signer.

## Abstract

A way for a Nostr client app on an iPhone or iPad to have a separate signer app on the same device sign events and encrypt or decrypt messages as the user's key, without the key leaving the signer, without a relay, a server or a network, and with the signer able to verify which app is asking. The methods, parameters and results are [NIP-55](55.md)'s (which are [NIP-46](46.md)'s), so a client that speaks either already knows the vocabulary; only the transport and the caller identity are new.

## Motivation

iOS has no equivalent of Android's intents and content providers: every form of inter-process communication Apple offers between apps of different developers is either a URL (an app switch, no return channel the user did not tap) or the system share sheet. [NIP-46](46.md) works on a phone but needs a relay, a client key pair, encryption between two processes that sit a centimetre apart, and a network. [NIP-55](55.md) is Android only. This proposal is NIP-55's method set over the one no-switch channel iOS does have, an **Action Extension** reached through the share sheet, with batching as the default shape (one tap signs many things), a **verified caller identity** from Apple's App Attest (the one thing iOS will not tell an extension is which app invoked it), and an optional **signing session** over loopback for a burst of work under one approval.

## Transport

The signer app ships an Action Extension (`NSExtensionPointIdentifier` `com.apple.ui-services`). The client builds one request as UTF-8 JSON bytes, puts them in one `NSExtensionItem` with one `NSItemProvider`, and presents a `UIActivityViewController`. The user taps the signer in the sheet. The extension runs in its own process over the client's context, shows what is about to be signed and asks the user about anything they have not decided before, releases the key with Face ID, Touch ID or the passcode, and returns one response through `completeRequest(returningItems:)`. There is no app switch and no silent path: the tap is the platform's, and this proposal does not claim one.

### The two uniform type identifiers

The signer app EXPORTS, and a client IMPORTS (`UTImportedTypeDeclarations`), two custom types under exactly these identifiers, both conforming to `public.json` and `public.data`:

| Identifier | Carries |
| --- | --- |
| `com.nostr-wot.signer.request` | one request JSON document |
| `com.nostr-wot.signer.response` | one response JSON document |

A custom type rather than `public.json` is what keeps the signer out of every JSON share on the device and every other JSON-capable extension out of the signer's sheet. A client detects an installed signer by resolving the response identifier with `UTType`: a type an installed app declares resolves to a declared, non-dynamic type, while an identifier nothing declares resolves to a `dyn.*` placeholder. Because the client imports the same identifier, `isDeclared` alone is true on every device; `isDynamic == false` is the signal.

### The activation rule

The extension's `NSExtensionActivationRule` accepts exactly one extension item every attachment of which conforms to the request type, with `NSExtensionActivationUsesStrictMatching` set:

```
SUBQUERY(extensionItems, $extensionItem,
  SUBQUERY($extensionItem.attachments, $attachment,
    ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "com.nostr-wot.signer.request"
  ).@count == $extensionItem.attachments.@count
).@count == 1
```

So the signer appears only when a client deliberately built a signing request, and never on an ordinary share.

### The request item and the response item

The client registers the request bytes as `NSItemProvider(item: bytes as NSData, typeIdentifier: "com.nostr-wot.signer.request")`. The signer loads the first attachment of the first item for that identifier and accepts `Data`, `NSData`, `String` (UTF-8) or a file `URL`; a URL is read only when it is a local file whose size is within the request byte cap, never fetched from a host. The response comes back as one `NSExtensionItem` with one `NSItemProvider` of the response type, and a client reads it under the same four representations with the same rule for a URL. On the client's side, `completionWithItemsHandler` with `completed == false` is the user dismissing the sheet or the signer cancelling the request; `completed == true` with no `NSExtensionItem` among `returnedItems` is a system activity that was not the signer.

The signer MUST NOT fetch any URL, from the request or from anywhere, and MUST NOT time the sheet out: the sheet is where the user decides, for as long as they take, and a refusal sentence stays until they close it. A client MUST NOT time the sheet out either.

## The request

```json
{
  "v": 1,
  "client": { "name": "Damus", "version": "1.14" },
  "current_user": "<64 lowercase hex, or omitted>",
  "requests": [
    { "id": "r1", "method": "get_public_key" },
    { "id": "r2", "method": "sign_event",    "payload": "<event JSON as text>" },
    { "id": "r3", "method": "nip44_encrypt", "payload": "<plaintext>", "pubkey": "<64 hex>" },
    { "id": "r4", "method": "nip44_decrypt", "payload": "<NIP-44 payload>", "pubkey": "<64 hex>" },
    { "id": "r5", "method": "nip04_encrypt", "payload": "<plaintext>", "pubkey": "<64 hex>" },
    { "id": "r6", "method": "nip04_decrypt", "payload": "<ciphertext?iv=iv>", "pubkey": "<64 hex>" },
    { "id": "r7", "method": "nip17_unwrap",  "payload": "<kind 1059 event JSON as text>" },
    { "id": "r8", "method": "nip17_seal",    "payload": "<unsigned kind 14 or 15 rumor as text>", "pubkey": "<64 hex recipient>", "created_at": 1760000000 }
  ]
}
```

| Field | Rule |
| --- | --- |
| `v` | `1`. Compared, never defaulted: a document of another version is refused whole. Members a signer does not know are ignored, so additions do not move it |
| `client.name`, `client.version` | Optional strings, whitespace folded, kept to 64 and 32 characters. The client's own words for itself: shown as a claim, never an identity |
| `current_user` | Optional. A hint only: the signer signs as its own active account and this selects nothing. A client compares the key it gets back. Folded to lowercase; a malformed value is dropped |
| `requests` | A non-empty array. Batch is the default shape: one request is one tap, so a single operation is a one-element array |
| `requests[].id` | A non-empty string, unique within the request. Every item is answered under it |
| `requests[].method` | One of the eight below. An unknown name refuses the whole request |
| `requests[].payload` | The event JSON as text for `sign_event`, the plaintext or ciphertext for the four message methods, the gift wrap for `nip17_unwrap`, the rumor for `nip17_seal`. Absent for `get_public_key`. A `sign_event` payload MUST be a JSON object with an integer `kind`; one that is not refuses the whole request |
| `requests[].pubkey` | The counterparty's x-only key, 64 lowercase hex, for the message methods and the recipient of a `nip17_seal` |
| `requests[].created_at` | `nip17_seal` only, optional: the seal's timestamp when the client chooses it, a positive integer. Absent, the signer picks one uniformly within the past two days (NIP-59) |
| `session` | Optional. Asks for a signing session (below) |
| `identity` | Optional, and when present the LAST member, written as the caller identity section says |

**Caps.** The reference signer accepts 256 items and 4 MiB per request, checked on the raw bytes before parsing and on the array before any item is read; builds before `caps` was on the response accepted 64 items and 1 MiB. A client plans against the `caps` the signer's last response stated, and against 64 items and 1 MiB until it has heard one, because an older signer refuses a 65th item for the whole request.

**The event is signed as the bytes it was sent.** The signer MUST sign the `payload` text of a `sign_event` as received and never a re-serialisation: key order changes the id. A client therefore serialises an event once and sends that text.

### Methods

The first six are NIP-55's names (NIP-46's as well), with NIP-55's parameters and results. The last two are compound operations that fold two dependent steps into one item, because on iOS two dependent requests are two taps.

| Method | `payload` | `pubkey` | `result` | `event` |
| --- | --- | --- | --- | --- |
| `get_public_key` | absent | absent | the account's public key, 64 lowercase hex | absent |
| `sign_event` | the unsigned event as JSON text | absent | the signed event as JSON text | the same signed event as JSON text |
| `nip04_encrypt` | plaintext | counterparty | NIP-04 ciphertext | absent |
| `nip04_decrypt` | NIP-04 ciphertext | counterparty | plaintext | absent |
| `nip44_encrypt` | plaintext | counterparty | NIP-44 v2 payload | absent |
| `nip44_decrypt` | NIP-44 v2 payload | counterparty | plaintext | absent |
| `nip17_unwrap` | a kind 1059 gift wrap as JSON text | absent | the rumor as JSON text | absent |
| `nip17_seal` | an unsigned kind 14 or 15 rumor as JSON text | the recipient | the signed kind 13 seal as JSON text | the same seal as JSON text |

`nip17_unwrap`: the signer decrypts the wrap's content with the account key and the wrap's `pubkey` (NIP-44), parses the kind 13 seal inside, VERIFIES the seal's id and signature, decrypts the seal's content with the account key and the seal's `pubkey`, parses the rumor, requires `rumor.pubkey == seal.pubkey`, and returns the rumor. The client learns the sender from the rumor's `pubkey`, on the signer's word: the two decrypts and the seal check happened inside the signer and cannot be repeated outside it.

`nip17_seal`: the signer NIP-44 encrypts the rumor text exactly as received to `pubkey`, builds the kind 13 seal with empty tags and the chosen or random timestamp, signs it, and returns it. Wrapping the seal into a kind 1059 event under an ephemeral key stays with the client: it needs no account key.

NIP-55's `decrypt_zap_event` and NIP-46's `get_relays`, `connect`, `ping`, `switch_relays` and `logout` are not part of this proposal and are refused as `unknown_method`.

A compound item that is not what its method says (an unwrap whose payload is not a kind 1059 event, a seal whose payload is not a kind 14 or 15 rumor, a `created_at` that is not a positive integer, a wrap or seal that does not open or verify) is THAT ITEM's `malformed`; the rest of the request is answered.

## The response

```json
{
  "v": 1,
  "signer": "com.nostrwot.wallet.signer-action",
  "methods": ["get_public_key", "sign_event", "nip04_encrypt", "nip04_decrypt", "nip44_encrypt", "nip44_decrypt", "nip17_unwrap", "nip17_seal"],
  "features": ["session", "session_tail"],
  "caps": { "max_items": 256, "max_bytes": 4194304 },
  "caller": { "status": "verified", "app_id": "ABCDE12345.com.example.client", "environment": "production" },
  "results": [
    { "id": "r1", "result": "<64 hex>" },
    { "id": "r2", "result": "<signed event JSON>", "event": "<signed event JSON>" },
    { "id": "r5", "rejected": true },
    { "id": "r6", "error": "unknown_method" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `v` | `1` |
| `signer` | The answering extension's bundle identifier |
| `methods` | The wire methods this signer build answers, in the order of the table above. Present on every response, a refusal included, so a client learns what the installed build can do from its first answer. Absent from builds before the field existed, which answered `unknown_method` to NIP-44 and the compound operations |
| `features` | Names of what the build can do beyond `methods`: `session` when it serves signing sessions, `session_tail` when the user allows one to outlive its sheet. Absent from builds before sessions |
| `caps` | `max_items` and `max_bytes`: the build's caps on one plain request. Absent from builds that enforced 64 and 1 MiB |
| `caller` | Who the signer took the client to be (below). Informational. Absent from builds that do not identify callers |
| `session` | What became of a requested session (below). Only on the answer to a request that carried a `session` member and got as far as trying |
| `results` | One entry per item, in request order, each exactly one of `result` (with `event` for `sign_event` and `nip17_seal`), `rejected: true`, or `error` |

**Every item gets an answer.** A response with nine answers to ten items leaves the client unable to tell which of its events exists. A client treats an item the response does not name as a transport failure for that item and never as performed.

**Reading rules.** `results` is read strictly: an entry with neither a result, a rejection nor an error, an empty id, or an error code the client does not know refuses the whole response, because a client that passed an unknown code through would read it as "some other failure" and retry something that means "stop". Everything else on the root (`methods`, `features`, `caps`, `caller`, `session`) is read leniently: an absent or unreadable field means "an older signer, plan as for one" and never costs the answers beside it. A client enables NIP-44 features only when BOTH `nip44_encrypt` and `nip44_decrypt` are listed, and sends a compound method only when it is listed.

**A request refused whole has no items to answer under.** When the signer cannot read the request at all (bytes that are not the contract's JSON, another `v`, an unknown method name, a duplicate id, a cap exceeded, a `sign_event` with no integer kind, a malformed `session` member), the reference signer cancels the request (`cancelRequest`), and the client sees `completed == false` with no response item. So `too_large` never reaches a client as an item code of a plain request, and `malformed` and `unknown_method` reach it only for an item that failed while the batch was being carried out, or inside a session frame.

### Error codes

| Code | Meaning | Scope | What a client does |
| --- | --- | --- | --- |
| `malformed` | The item could not be read or carried out as sent | item | Fix the request; the same bytes get the same answer |
| `unknown_method` | A method this build does not answer | item | Read `methods`; do not send it |
| `too_large` | Over the caps; in a session, every item of a frame whose ANSWER would pass the frame cap | item (sessions) | Split; plan a frame of `sign_event` items at half the cap |
| `no_account` | The signer has no account to sign as | every item | As `not_provisioned` |
| `needs_approval` | From an OLDER signer: no remembered decision covered the request and it was left for the signer's app | every item | Tell the user to open the signer app, then present again. Retrying at once gets the same answer |
| `not_provisioned` | The account is not switched on for apps on this device | every item | Offer one button that opens the connect link (below); present once more when the app comes back to the front |
| `locked` | The presence check (biometrics or passcode) failed or was dismissed | items not performed | Let the user try again |
| `unverified_caller` | No identity member, and the user has not allowed unverified apps | every item | Attach an identity, or tell the user where the switch is |
| `identity_invalid` | An identity member that failed a check; `caller.reason` names it | every item | A fault to fix, never a retry as unverified. Only `counter` is cleared by a new request |
| `identity_expired` | `issued_at` outside the window | every item | Build a NEW request with a new `issued_at` and assertion. The old bytes are dead |
| `attestation_required` | The signer does not know this key and the member carried no attestation | every item | Attach it. A client that always attaches it never sees this |
| `out_of_scope` | In a session only: outside the scope the session declared | item | Declare what you will ask for. Do not retry it in that session |
| `blocked` | A rule the user saved refuses this app connecting, with no sheet and no presence check | every item, or the `get_public_key` | Say so; do not retry. The user undoes it in the signer app |

`rejected: true` is the user's "no" to this item, on the sheet or by a saved rule, and it is per item: one response may hold results and rejections side by side. A client does not retry a rejected item and does not send the user to the signer app over it.

The reference signer answers `not_provisioned` in both cases the contract lets `no_account` cover (no active account, and an active account whose key is not in the shared keychain); clients MUST handle the two codes alike. `needs_approval` is never answered by the current reference build, which asks on its own sheet instead; it stays in the contract for older builds, and a client MUST keep handling it.

### Consent

Which items are performed is the user's decision, made in the signer, and this proposal does not standardise how a signer remembers them. What a client can rely on from the reference signer: the sheet shows the request grouped by permission, the user allows or rejects each group for this once or always, "always" is never offered to an unverified caller and never for the authentication kinds 22242 and 27235, a remembered decision answers the same verified app and no other, and switching an account on for apps on the device is consent to an app on the device reading its public key, so an identified app's first `get_public_key` is asked only for the presence check. Nothing is performed before the presence check, and the presence check is raised once per request.

## Caller identity

`NSExtensionContext` exposes the input items and nothing about the host app; `sourceApplication` is `nil` across developer teams. So a client proves which app it is, in the request itself, with Apple's **App Attest**, and the signer verifies the proof offline. A client that cannot attest (a simulator, code in an extension, `DCAppAttestService.isSupported` false) sends no identity member and is an **unverified caller**; whether those are served at all is the user's switch in the signer.

### The identity member

The client serialises the request to its final bytes `P`, which end in the object's closing `}` with nothing after it. It then replaces that final `}` with the member and a closing brace, written by CONCATENATION, so that `identity` is the last member of the top-level object introduced by exactly the twelve bytes `,"identity":` with no whitespace anywhere in them:

```
,"identity":{"app_id":"<TeamID>.<bundleID>","key_id":"<base64>","issued_at":<unix seconds>,"assertion":"<base64>","attestation":"<base64>"}}
```

| Field | Rule |
| --- | --- |
| `app_id` | `"<TeamID>.<bundleID>"`, the App ID as App Attest hashes it: ten uppercase letters or digits, a period, then a bundle identifier of letters, digits, hyphens and periods beginning and ending with a letter or digit; 12 to 166 characters |
| `key_id` | The App Attest key identifier exactly as `generateKey` returned it: standard base64 of 32 bytes in its one canonical padded spelling. A second spelling of the same bytes is refused, because the assertion signs the spelling |
| `issued_at` | Unix seconds on the device clock when the client built the request. A JSON integer above zero |
| `assertion` | Standard base64 of the CBOR assertion `generateAssertion` returned, 1 to 1024 bytes decoded |
| `attestation` | Standard base64 of the CBOR attestation object `attestKey` returned, 1 byte to 16 KiB decoded. Optional on the wire; a conforming client ALWAYS sends it, because the channel is one shot and `attestation_required` would cost a second tap |

The whole member is bounded at 48 KiB. The request's byte cap applies to the whole document, member included, so a client plans its batch against the cap less 48 KiB.

**The signer recovers `P` by cutting the document at the LAST occurrence of `,"identity":`**, putting a `{` in front of what follows and reading it as an object with exactly one member, and closing the bytes before the comma with one `}`. It verifies the assertion over those bytes and parses the request from them and from nothing else: there is no canonical form to agree on, no re-serialisation whose key order could differ, and no second reading of the request that the signature does not cover. The cut cannot land in the wrong place: the needle holds an unescaped quote, so it cannot occur inside a JSON string, and anywhere but the top level the bytes before it close one brace short of being JSON. If the parsed request still names an `identity` at its top level (written first, with whitespace, twice, or followed by another member) the request is refused `identity_invalid` with reason `placement`, never served as unverified.

### What the key signs

The client data of an attestation, a constant per app and not a server's challenge (there is no server), what `attestKey` is given:

```
SHA256( "nostr-wot:samedevice:attestation:1\n" app_id )
```

The client data of an assertion, what `generateAssertion` is given for each request:

```
SHA256( "nostr-wot:samedevice:assertion:1\n" app_id "\n" key_id "\n" issued_at "\n" || SHA256(P) )
```

The header is ASCII and newline-terminated, `key_id` enters as its base64 text and `issued_at` as decimal digits, none of the three can hold a newline, and `P` enters as its own 32-byte hash, so the framing is unambiguous. The two prefixes separate the only two hashes a client's key ever signs for this signer. Worked values, from the reference vectors (`caller-identity.json`): for `app_id` `ABCDE12345.ar.obelisk.app`, `key_id` `LHDhK3oGRvkiefQnx7OOczTY5Tic/xZ6HcMOc/gmtoM=`, `issued_at` `1790000000` and the 159-byte `P` `{"v":1,"client":{"name":"Obelisk","version":"1.0.0"},"requests":[{"id":"r1","method":"sign_event","payload":"{\"kind\":1,\"content\":\"hello\",\"tags\":[]}"}]}`, `SHA256(P)` is `09eb5f98d4a6b8a74553079ba7b3bc171aea0dad8a9ca5d09a628d09d068dcdd`, the assertion client data hash is `1b715b76a6ddcaa14b9ef8dc732b25283bb8191fda9664f5e72d076119799c94` and the attestation client data hash is `81ec5ecdc039a870efd7372377a2e66f59368347c389a09a46b9eca27a917353`.

### The key's life, on the client

1. `generateKey` once per install; keep the identifier. Write it down before anything else, so a key is never made and then forgotten.
2. `attestKey` once for that key, over the attestation client data hash. The one step that reaches Apple's servers. Cache the attestation beside the identifier: it is a certificate for a public key, not a secret.
3. `generateAssertion` per request, offline, immediately before presenting, and never present an older request after a newer one: the signer orders a key's assertions by their counter and serves a request only when its counter is above the last one it stored.
4. `DCError.serverUnavailable` from `attestKey`: keep the key and try again later. `DCError.invalidKey`, from `attestKey` or `generateAssertion` (a reinstall or a restore: the keychain record survived, the Secure Enclave key did not): discard the identifier and the attestation and start from 1.
5. Before sending, check what will be sent: a block the signer would refuse (a key identifier not in canonical spelling, an attestation whose authenticator data does not contain `SHA256(app_id)`, a field over its bound) is NOT sent; the request goes without identity instead. A request always goes.

### How the signer verifies

In this order, cheapest first and state last; nothing is stored for a request that fails, and each refusal carries a short reason the response reports in `caller.reason`.

1. **The window.** `issued_at` is at most 120 seconds behind the signer's clock and at most 30 seconds ahead; outside, `identity_expired`. Both processes read the same device clock: the past side is the time the user may take to tap the signer in the sheet, the future side a clock stepped back in between.
2. **The key.** A stored record for `key_id` is the authority: its app must equal the claimed `app_id` (`identity_invalid`, reason `app_id`), and an attestation sent alongside is not read again. No record and no attestation: `attestation_required`. Otherwise the attestation is verified (next list); a failure is `identity_invalid` with reason `attestation_` followed by the step.
3. **The assertion.** The CBOR holds `signature` and `authenticatorData` of at least 37 bytes (`format`). `nonce = SHA256(authenticatorData || clientDataHash)` with the client data computed by the signer from `P` and the member's fields; `signature` is a DER ECDSA P-256 signature over `nonce` as the message under the key's public half (`signature`); the first 32 bytes of the authenticator data equal `SHA256(app_id)` (`rp_id`). Reasons are `assertion_` followed by the step.
4. **The counter.** Bytes 33 to 36 of the authenticator data, big-endian, strictly greater than the counter stored for the key, and so greater than zero for a key seen for the first time (`identity_invalid`, reason `counter`).
5. **The write.** The record with the new counter is saved BEFORE the request is served; a write that fails refuses the request (reason `store`): a counter checked and not kept is a replay window.

**The attestation**, for a key seen for the first time, Apple's nine steps in Apple's order, with a CBOR reader that refuses indefinite lengths, tags, floats, trailing bytes and duplicate keys, `fmt` equal to `apple-appattest`, and `attStmt.x5c` of one to four certificates (`format`): (1) the chain is evaluated under the basic X.509 policy with Apple's App Attestation Root CA (SHA-256 of its DER `1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932`) as the ONLY anchor, the system trust store not consulted and network fetch off (`chain`); (2, 3) `nonce = SHA256(authData || clientDataHash)`; (4) the credential certificate's extension `1.2.840.113635.100.8.2` is exactly `SEQUENCE { [1] { OCTET STRING } }` and the octet string equals the nonce (`nonce`); (5) the certificate's public key, as a 65-byte uncompressed point, hashes to `key_id` (`key_id`); (6) the first 32 bytes of `authData` equal `SHA256(app_id)` (`rp_id`); (7) the counter in `authData` is zero (`counter`); (8) the `aaguid` is `appattestdevelop` or `appattest` followed by seven zero bytes (`environment`); (9) the credential id inside `authData` equals `key_id` (`credential_id`). Apple's fraud-risk receipt is not used: it needs Apple's server.

**Why offline verification is sound.** Apple describes a server that hands the client a fresh challenge so an attestation cannot be replayed. There is no server here and no way to speak to the caller before its request arrives, so the attestation's client data is a constant per app and an attestation is replayable; that is harmless, because it certifies a public key, public by nature and worthless without the Secure Enclave key that signs the assertion beside it. Freshness is carried by the assertion: it signs the exact request bytes and `issued_at`, the timestamp must be inside the window, and the counter must strictly rise and is stored before the request is served. The credential certificate is valid for a short window after issuance because Apple expects a server to check it at once; a signer may first meet it months later, so the chain is judged at now when now is inside the certificate's validity and otherwise one second inside its nearer end, with the root still pinned and nothing else relaxed. That is sound because what the certificate states is an event, not a standing permission: at issuance Apple saw this key generated in a genuine Secure Enclave for this app, time does not make that untrue, the key cannot leave the hardware, and no revocation service exists for these certificates that a fresher check would consult. What bounds an old key is the counter and the window.

### Who a verified app is

A verified caller's identity is `app_id` together with its environment: `development` (a build signed for development with the `appattest-environment` entitlement at `development`) or `production` (App Store and TestFlight, whatever the entitlement says). The two are different apps to the signer, with separate remembered decisions, because a development build is whatever its developer compiled this morning. A reinstall mints a new key and is the same app: decisions are keyed on `app_id`, not on the key. A different team identifier or bundle identifier is a different app.

### The `caller` report

Every response the signer can attribute says who it took the client to be: `{"status":"verified","app_id":"<TeamID>.<bundleID>","environment":"development"|"production"}`, `{"status":"unverified"}`, or `{"status":"refused","reason":"<the check that failed>"}`. It is INFORMATIONAL: it travels in a response with no signature of its own, so a client could have written it itself. A client shows it and logs it, never gates on it, never forwards it as proof of anything; a signer never reads one.

### Unverified callers

A request with no identity member is served only when the user has switched the signer's "allow unverified apps" setting on (off by default, and off is what anything unreadable is taken to mean). When served, every unverified app shares ONE set of remembered decisions, and the name such an app gives itself cannot be checked. A present identity member that fails any check is refused and NEVER downgraded to unverified: a client does not send a block it cannot back, so a broken one is somebody trying a name on.

## The connect link and the callback

When the signer answers `not_provisioned` or `no_account`, the account is not switched on for apps on this device, and the client cannot switch it on. What it can do, on the user's tap, is open the signer app on the screen where that is done:

```
nostrwotwallet://same-device                                    the settings screen, no parameter
nostrwotwallet://same-device?connect=<label>&callback=<url>     the connect prompt
nostrwotwallet://                                               the signer app (a blocked app, an older signer's needs_approval)
```

`connect` is a label for one sentence ("<label> wants to use <account>"): letters, digits, spaces, dots, hyphens and underscores, at most 32 characters, percent-encoded. It selects nothing: a link proves nothing about who opened it, so "Allow" switches on the signer's ACTIVE account for every app on the device and grants this app nothing, and "Always reject <label>" blocks the app the signer VERIFIED in the request it refused moments before, found through the name that app gave itself, never through the label alone. `callback` is optional: an absolute URL under the client's own custom scheme, with a non-empty body, no query, no fragment, no `@`, no `%`, no whitespace, and not one of the web's schemes (`http`, `https`, `ws`, `wss`, `ftp`, `file`), a WebView's (`javascript`, `data`, `blob`, `about`), `mailto`, `tel`, `sms`, the signer's own (`nostrwotwallet`, `lightning`) or another signer's or wallet's (`bitcoin`, `nostrsigner`, `nostrconnect`, `bunker`, `nostr+walletconnect`, `nostr`). A link that is not exactly one of the three shapes, with exactly these parameters each once, lands on the signer app's home screen.

After the user's choice the signer offers "Back to <label>", which opens `<callback>?status=enabled|declined|blocked` and nothing else. The return is untrusted like any link; the one thing a client does with it is present its request again, once.

## Signing sessions

A plain request is one sheet, one tap and one presence check. A session is one sheet and one presence check for up to 5 000 operations: the client listens on a loopback port, hands the signer a fresh secret inside the request the user approves, the signer's extension connects back over loopback and answers ordinary requests as sealed frames until either side closes. The signer's extension is alive only while its sheet is up (and, with the user's setting, for a bounded tail after it), so nothing signs in the background.

### The `session` member

A session-open request is an ordinary request with one more top-level member, written INSIDE the request bytes so a verified caller's assertion covers the port, the secret and the scope:

```json
"session": {
  "v": 1,
  "port": 51234,
  "secret": "<standard base64 of 32 random bytes, fresh for this session>",
  "intent": "Sync messages",
  "scope": { "methods": ["nip17_unwrap", "nip44_decrypt", "sign_event"], "kinds": [13] },
  "estimate": 500
}
```

| Field | Rule |
| --- | --- |
| `v` | `1` |
| `port` | The client's loopback listener, an integer 1024 to 65535. The signer connects to `127.0.0.1` on exactly this port and to nothing else: the member has no field a host could be named in |
| `secret` | 32 bytes from the system CSPRNG, standard base64 in its one canonical spelling. Never reused, logged or stored; it lives in the request item and in both processes' memory |
| `intent` | Optional. The client's own words for why, folded and capped at 64 characters. Shown as a claim |
| `scope.methods` | A non-empty list of DISTINCT wire methods. An unknown name refuses the request; a compound method is in scope by its own name only |
| `scope.kinds` | Required, non-empty, distinct, at most 64 entries of 0 to 65535, when `sign_event` is declared; refused when it is not |
| `estimate` | Optional positive integer: how many operations the client expects. Display only |

A member that is not exactly this is `malformed` for the WHOLE request. `requests` still holds at least one item: the session's first batch, inside the scope, answered as response frame 0. A signer from before sessions ignores the member and answers the request as the plain request it also is, with no `session` in its response.

**The scope is enforced.** An item, in the opening request or in any frame, whose method is outside `scope.methods`, or a `sign_event` whose kind is outside `scope.kinds`, is answered `out_of_scope`: not performed, and the session goes on.

### The listener

The client starts listening BEFORE presenting the sheet and stops when the session ends or the sheet is cancelled. It binds `127.0.0.1` only, never a wildcard address. Any app on the device can connect to a loopback port, so a connection is PENDING until its first frame authenticates as a `hello` under the signer-to-host key at counter 0, within 3 seconds and within 4096 buffered bytes; anything else (a wrong length, a failed tag, another frame type, silence) drops that connection without a word and costs the session nothing. At most 16 connections are pending at once, the oldest evicted for a new one. The first peer that authenticates wins: the listener is cancelled and every other pending connection is dropped. Without the secret a local app reads nothing and causes nothing; at worst it keeps the session from forming, which is the plain request.

The signer makes ONE TCP connection to `127.0.0.1` on the named port, on the loopback interface only, with a 3 second timeout and no retry. If it does not connect, or connects and is never answered by a frame that authenticates, there is no session: the opening request's items are performed as a plain request and the response says `"session": {"status": "unavailable", "reason": "connect" | "handshake"}`. Connected, the signer sends `hello`, then the answer to the opening items as response 0, then serves frames until the session ends.

### The wire

Key schedule, HKDF-SHA256:

```
prk   = HKDF-Extract(salt = "nostr-wot:samedevice:session:1", ikm = secret)
k_s2h = HKDF-Expand(prk, info = "signer->host", 32)    the signer sends under it
k_h2s = HKDF-Expand(prk, info = "host->signer", 32)    the client sends under it
```

A frame on the wire is `u32be length || sealed`, where `sealed = ChaCha20-Poly1305(key, nonce, type || body, aad)` as ciphertext followed by the 16-byte tag, `length` counts `sealed`, `nonce` is four zero bytes and a 64-bit big-endian counter starting at 0 per direction and rising by one per frame, `aad` is the direction label (`signer->host` or `host->signer`) as bytes, and `plaintext` is one type byte and the body. The receiver keeps its OWN counter and never reads one off the wire, so a frame replayed, dropped, reordered or injected fails its tag and ends the session; `aad` keeps a frame from being reflected at its sender. A length over the frame cap closes the connection before any byte of the body is buffered. No TLS: the frames are sealed and the connection is loopback.

| Type | Name | Who sends | Body (UTF-8 JSON) |
| --- | --- | --- | --- |
| `0x01` | hello | signer, first | `{"v":1,"signer":…,"methods":[…],"features":[…],"caps":{"max_items","max_frame_bytes","idle_ms","max_duration_ms","max_operations","tail_max_ms"},"caller":{…}}` |
| `0x02` | request | client | `{"id":<u32, strictly increasing from 1>,"request":{"v":1,"requests":[…]}}`; no `session`, no `identity` |
| `0x03` | response | signer | `{"id":<the same>,"response":<an ordinary response>}`; id 0 answers the opening request's items |
| `0x04` | close | either | `{"reason":"done"\|"stopped"\|"idle"\|"duration"\|"operations"\|"expired"\|"error","summary"?:{"operations","refused","tail_granted","tail_ms"}}`; the summary only from the signer |
| `0x05` | ping | client | empty; resets the idle timer and is answered by nothing |

A client plans from the `hello`'s `caps`, not from constants of its own: the item cap per frame, the frame cap in bytes, the idle time, the longest a session lasts, how many operations it will answer, and how long it may serve after its sheet closes (`tail_max_ms`, 0 when it will not). The reference signer's values: `max_items` 256, `max_frame_bytes` 4 MiB, `idle_ms` 5000, `max_duration_ms` 120000, `max_operations` 5000, `tail_max_ms` 28000 or 0. Reaching a cap ends the session with a `close` that names it; none is silent.

**Order.** Request frames are processed strictly in id order, one at a time, and a response frame answers exactly one request frame. A frame that does not parse, an id that repeats or goes back, a request that carries a `session` or `identity` member, ends the session with `close` and reason `error` on both sides.

**The unanswered-frame rule.** If the connection drops, every request frame without a response is UNANSWERED: the client assumes neither that it was performed nor that it was not. Operations safe to repeat (`get_public_key`, `nip04_decrypt`, `nip44_decrypt`, `nip17_unwrap`) are queued again; signing, sealing and encrypting are surfaced to their callers as a transport failure and repeated only by the caller's own rule, never blindly, because a second seal is a second message.

**The oversized-response rule.** A `sign_event` answer carries the signed event twice, so a request frame that fit can have an answer that does not. The signer never sends a frame over the cap: it answers that request frame with every item `too_large` and the session goes on. The client plans a frame of `sign_event` items at no more than half the cap.

### Deciding for a session

The declared scope becomes the groups the user decides on, on the sheet, BEFORE the presence check, with the opening request's items as previews and a line saying about how many more will follow unseen. A "once" holds for the whole session; an "always" is remembered as for a plain request. If every group is refused there is no session and the opening items come back `rejected`. In the session nothing more is asked: an allowed group is performed, a refused one is `rejected`, anything outside the scope is `out_of_scope`.

### The response to the opening request

| `session` | Meaning |
| --- | --- |
| absent | An older signer, or the user stopped before it connected. `results` is a plain answer |
| `{"status":"unavailable","reason":"connect"\|"handshake"\|"disabled"}` | No session formed; `results` answers the opening items as a plain request. `disabled` is defined for a build or a setting that does not serve sessions; the reference signer does not produce it |
| `{"status":"closed","reason":…,"operations":n,"refused":m,"tail_ms":t}` | The session ran and ended while the sheet was up. `results` is empty: the answers went in frames |
| `{"status":"tail"}` | The sheet closed early and the signer is STILL answering frames; the summary comes in its `close` |

### The tail

With the user's setting on (`session_tail` in `features`), after the presence check, the handshake and the first few operations answered without a refusal, the signer's sheet may close by itself and the extension goes on serving under a system-granted expiring activity for up to `tail_max_ms` (28 seconds in the reference signer, under the roughly 30 seconds observed from the grant), or until the client closes, the idle timer fires, or the system takes the time back (`close` with reason `expired`). iOS promises no such time: a client shows that a session is open and for how long, offers Stop (which sends `close` with reason `stopped`), treats a dropped connection as the end, and never designs a flow that needs the tail.

### Fallbacks, in order

A session with a tail; a session without one; plain requests under the signer's `caps`; plain requests under 64 items and 1 MiB with the two-step NIP-17 path (the wraps as `nip44_decrypt` in one request, the seals in the next, 32 wraps per request) where `methods` lists no compound operations. Each step down is something the signer said, in `features`, `caps`, `methods` or `session`, never something a client guesses.

## Security considerations

- **No private key leaves the signer.** The channel carries one request in and one response out; the signer's key is read inside its own process behind the device's presence check and zeroed afterwards. A client never holds, sees or caches any key material.
- **The share sheet proves nothing about who answered.** It is the system's, and the user may tap another extension. A client MUST verify every returned event's signature locally (BIP-340, with its own Nostr library), check that an event's `id` is its hash and the event is the one it asked for (kind, and for a seal: kind 13, empty tags, the account's `pubkey`, the chosen `created_at`), and treat a rumor that carries an id and does not hash to it as no answer. A decrypt cannot be re-checked.
- **Capture.** An identified request handed to another extension is a valid request for two minutes and can be presented to the real signer once, obtaining only the answer to exactly the request the genuine client built. A session-open request handed to another extension gives that extension the port and the secret: it can connect, be taken for the signer, and be sent everything the client then asks in that session, events to sign and the plaintext of every message to seal; it cannot make the signer sign anything, and the client verifies every signature it is handed back.
- **Relay.** App Attest proves that a genuine instance of the app, on some genuine Apple device, signed this request; it does not prove that instance is the one on this device. Bounded by the window and the counter; not closed.
- **Replay window.** Two minutes behind and thirty seconds ahead on `issued_at`, and a strictly rising per-key counter stored before the request is served. A signer that loses its records (a wipe, a bound of stored keys exceeded) reopens the two-minute window for that key and no more.
- **Development builds** are any code their developer compiled and are a separate identity with separate decisions. **Unverified callers**, when allowed, share one set of decisions and a name nobody can check.
- **The `caller` field is forgeable** by the client that reads it, so nothing is gated on it.
- **No URL fetches.** The signer reads a request only as bytes, a string or a local file within its cap, and never fetches anything from the request or elsewhere; a client reads the response the same way.
- **Loopback.** Any app on the device can connect to the client's port and race it; without the secret it authenticates nothing, reads nothing and causes nothing, and at worst the session does not form. The secret is never written to disk by either side; when the signer has to park a session-open request for its app it removes `secret` and `port` first.
- **One presence check covers a whole session**, up to 5 000 operations and two minutes, inside a declared scope the user saw. During the tail the key is in the signer's memory with no signer UI showing, for at most 28 seconds, bounded by the idle timer, the scope, the user's decisions and Stop; the user can switch the tail off.
- **An "always allow" for a verified app** covers every matching operation that app asks for from then on, in a request or a session, until revoked in the signer.
- **Memory.** An app extension's memory budget is far below an app's. The signer applies the byte cap before parsing and the item cap before reading items, and a client keeps its batches under the signer's stated caps.

## Rationale

**Why not NIP-46 on the same device.** A relay round trip, a client key pair, NIP-44 between two processes on one phone, and a network connection, to move bytes a centimetre; and nothing in NIP-46 can tell the signer which app is asking beyond unauthenticated metadata, where this proposal has Apple's signature over the app's identity. NIP-46 remains the answer across devices.

**Why NIP-55's methods.** The vocabulary exists and is shared with NIP-46; a client with an Android signer backend already has the types. What is new is forced by the platform: the share sheet as the only cross-team no-switch channel, batching as the default (one tap is the cost unit), the identity member (because iOS hides the host), compound NIP-17 operations (two dependent steps would be two taps), and sessions (a burst under one approval).

**Why the identity is appended by concatenation** and verified over the exact bytes: JSON has no canonical form the two sides would otherwise have to agree on, and a signature over a re-serialisation would cover bytes the signer never parses.

**Why a custom UTI**, strict matching and an exact activation rule: the signer must appear only for a signing request and no JSON-capable extension must appear for one.

**Why `v` stays 1** across every addition here (`methods`, `features`, `caps`, `caller`, `session`, the identity member): each is an optional member both parsers ignore when unknown, so an old client works with a new signer and a new client with an old one; a version bump would have made every existing request `malformed` to carry a signal the members carry for free.

## Reference implementations

- Signer: the Nostr WoT wallet's iOS Action Extension, `targets/signer-action/` in `nostr-wot/nostr-wot-wallet`; the written contract and its tests in `src/schemas/samedevice/` and `src/constants/samedevice*.ts` there; the shared vectors in `targets/signer-action-tests/vectors/` (`caller-identity.json`, `session-wire.json`, `nip17.json`, `roundtrip-requests.json`, `roundtrip-responses.json`).
- Client library: `clients/ios/NostrSameDeviceSigner/` in the same repository, Swift, Apple frameworks only, with tests over the same vectors.
- First client: Obelisk for iOS (`obelisk-app/obelisk-mobile`, `modules/signer-bridge/` and `src/services/signer/`), whose native module consumes the client library.

## Implementation limits of the reference signer, as of this draft

Interoperability requirements above are what any conforming signer and client do. These are facts about the reference build, not requirements: it signs as one account, the active one, and `current_user` selects nothing; it answers `not_provisioned` where `no_account` would also fit; it never answers `needs_approval`; it does not produce `unavailable` with reason `disabled`; it stores at most 64 client keys and drops the least recently seen; the raised caps of 256 items and 4 MiB rest on a measurement made on a Mac as a proxy for the extension; and the tail's duration is one observation on one device, not a contract.
