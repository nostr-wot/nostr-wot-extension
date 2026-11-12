# Implement NIP-46 events on a local signer

The optional `nip46-event` profile carries a complete [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) event inside an authenticated local bridge frame. The extension supports this experimental profile on Wi-Fi and Bluetooth. A phone must implement and advertise it to activate it. A relay-only bunker needs a local transport adapter. The base [local bridge specification](../nips/signing/02-local-signer-bridge.md) defines the handshake, cryptographic encodings, BLE characteristics and frame limits used below.

## Offer and select the profile

- **Wi-Fi QR or paste.** Add `profile=nip46-event` to the phone's existing `nwlan://<host>?v=2&addr=<local-IP:port>&psk=<secret>` offer. Use the same local WebSocket path `/nwlan2`. For sound pairing, use byte 2 (zero-based) of the existing NW bootstrap packet as the format version. Value 2 selects the event profile and value 1 selects the original format. The other bytes have the same layout.
- **Direct Bluetooth.** The extension sends the existing discovery commitment plus `"profiles":["nip46-event"]`. An updated phone selects the profile by including `"profile":"nip46-event"` in its offer alongside the host and challenge. Use the existing BLE service, length prefix and chunking. Pin the selected profile on the phone for this offer. If offering an event-only session, reject missing capability or mismatched hello, including on reconnect. Initial discovery is unauthenticated, so deployments that require the event profile must enforce that policy on the phone.
- **Existing phones.** An offer without a profile selects the legacy encoding. After selecting the event profile, either endpoint must close on mismatched proofs or profile. Never reinterpret the frame as a legacy request or resend a pending request on a relay.

## Bind the profile to pairing

The client includes `"profile":"nip46-event"` in hello. The phone sets the same field in welcome. Use these exact ordered fields for the event profile. Each row starts with the indicated ASCII label and joins all fields with U+001F, then encodes the string as UTF-8.

| Label | Ordered fields after label |
| --- | --- |
| `nwlan/2/hello` | host, peer, nonce, nip46-event, decimal timestamp |
| `nwlan/2/confirm` | host, peer, nonce, nip46-event, challenge |
| `nwlan/2/welcome` | host, peer, nonce, nip46-event, session |
| `nwlan/2/session` | host, peer, nonce, nip46-event, session |

Use the base protocol's Schnorr signatures, hello PSK MAC when applicable, six-digit confirmation and HKDF session MAC key. The initial BLE discovery commitment still covers peer and nonce. With legacy offers, omit the profile field entirely from frames and transcripts. Always verify hello and require the normal pairing approval before dispatching any signing request.

## Receive one request

1. Read the existing JSON request frame with fields `v:2`, `t:"req"`, `seq`, `payload` and `mac`. Enforce the 65,536-byte UTF-8 frame limit and the session's strictly increasing request sequence.
2. Here `payload` is a **string containing the JSON of the signed event**. Verify the MAC using the existing request transcript over the sequence and the exact payload string received. Parsing and reserializing the event before checking the MAC can change those bytes.
3. Parse the event. Require kind 24133, a valid event ID and signature, the paired computer's pubkey as author, and exactly one `p` tag addressed to the phone's paired host key. The outer MAC binds the event to this live connection. Handle local events only on an authenticated session.
4. Decrypt `event.content` with standard NIP-44 v2 using the phone's **host transport secret** and the paired computer's public key. The result is ordinary NIP-46 request JSON. For example, the first request is `{"id":"<opaque-id>","method":"get_public_key","params":[]}`. Website calls may also include the existing encrypted `site` field. The paired extension asserts this origin. Apply the wallet's site permission checks before processing its request. A signer unable to honor site scoping should reject scoped requests.
5. Dispatch through the current local signer handler. It already calls the shared NIP-46 request planner and the phone's approval pipeline. Return the active **account** pubkey for `get_public_key`. Sign the requested user event with the account key, which can differ from the host transport key.

## Return the result

Encode a terminal NIP-46 response with the same request ID and a string result or error. For `sign_event` the result string contains the signed user event. Encrypt the response JSON with the same NIP-44 conversation key, set the outer event's kind to 24133, timestamp to the current Unix time in seconds, and tags to `[["p","<computer-pubkey>"]]`. Finalize that outer event with the host transport secret. Serialize it once to form the response payload string.

Send `{v:2,t:"res",seq,payload,mac}`, echoing the request sequence. Calculate the MAC over the base response transcript and the exact payload string. An event profile frame uses NIP-44 encryption inside the event and a session MAC around it. It does not apply the legacy session payload encryption a second time. The event author and recipient are visible on the local link. Use fresh client transport keys and keep local interface traffic off relays.

Responses may finish out of order. Match both the sequence and decrypted request ID. A denied request returns a terminal error. Keep approval on the phone; this profile uses a terminal response for each request. Drop pending work on disconnect or revocation. If the connection disappears after approval, treat the outcome as unknown and require a new user action before retrying.

## Where to change the Nostr WoT signer

Paths below are relative to the wallet repository.

| Files | Change |
| --- | --- |
| `src/types/lan/{model,frames}.ts`, `src/schemas/lan/{pairing,frames}.ts` | Represent the advertised and selected profile. Accept event JSON strings in request/response payloads for the selected profile. Apply byte limits before parsing. Preserve legacy payload validation. |
| `src/domain/lan/{handshake,transcript}.ts`, `src/services/transports/lan/confirmation.ts` | Pin the profile on each peer and build the four bound transcripts. Retain replay checks and number confirmation. |
| `src/services/transports/lan/session.ts`, `crypto.ts` in the same directory | Advertise the profile, verify the event and open its content before invoking the existing LAN handler. Wrap terminal results in signed response events after checking revocation. |
| `src/services/transports/lan/handler.ts` | Reuse its request planning, active account, site authorization, cancellation and approval handling. Local pairing supplies the connection handshake. |
| `src/services/transports/lan/sound.ts` | Use the event profile bootstrap version when the corresponding Wi-Fi offer selects it. |

## Verify the signer implementation

The extension's [transport test](../tests/local-bridge-transport.test.ts) includes a device-side implementation using nostr-tools. It constructs the handshake and frames independently of the client, checks the request event, and returns a signed response. Run it with `node --import tsx --test tests/local-bridge-transport.test.ts`.

For physical acceptance, pair by Wi-Fi QR and direct BLE, call `get_public_key`, then approve one `sign_event` request and verify its signature against that account. Repeat with a denial, an interrupted approval, and a response large enough for multiple BLE writes. Confirm a legacy phone still pairs. The in-memory transport tests do not measure radio behavior or native permission prompts.
