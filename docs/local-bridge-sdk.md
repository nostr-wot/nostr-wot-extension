# Proposed shared local bridge SDK

Status: extraction design, not a published package. Suggested name: `@nostr-wot/local-bridge`, in the existing `nostr-wot-sdk` monorepo.

## Goal

Let independently maintained clients and signers implement the local bridge without copying Nostr WoT application code. Preserve the current `nwlan/2` bytes while consolidating duplicated protocol logic. The experimental NIP draft is the compatibility contract; any intentional breaking wire change needs a new protocol version.

## Package boundaries

| Export | Responsibility | Excluded |
| --- | --- | --- |
| Root/core | Typed frames, canonical codecs, offer parsing, transcript generation, limits, replay guard, BLE frame encoder/decoder | Browser globals, React, Expo, storage |
| Client | Handshake and request state machine over an injected transport; host/identity pinning and response correlation | Website permission UI, account selection |
| Host | Admission and session state machine with injected approval, clock, randomness, peer store and signer | Wallet vault, remembered-policy database, notification service |
| Browser adapters | WebSocket and Web Bluetooth transports with bounded queues and explicit cancellation | Native GATT peripheral implementation |

Use the existing SDK signer contracts and audited NIP-44/BIP-340/HKDF dependencies. Do not implement new primitives or copy permission decisions. A host adapter calls the application's signer pipeline; an extension adapter applies its site policy before forwarding. Unsupported methods remain explicit errors.

Native Swift/Kotlin peripherals remain thin transport adapters in their platform modules. Keep native dependencies out of the core npm import graph. Expose bytes/frames, start/stop, disconnect and backpressure contracts rather than a second signing implementation.

## Extraction sequence

1. Freeze public vectors and compare the draft against both current implementations. Correct the host nonce-retention boundary and add a test using a hello timestamp 90 seconds in the future, replayed 91 seconds after acceptance. Keep it rejected until that timestamp's full validity period ends.
2. Extract codecs, transcripts, framing and limits into a prerelease package. Test canonical encodings, malformed frames, oversized lengths, fragmentation and session key vectors without browser or native mocks.
3. Move the client session machine behind injected transport and crypto dependencies. Exercise wrong host keys, invalid signatures, sequence/ID mismatches, late replies, timeouts and cancellation. No automatic retry of effectful requests and no fallback signer.
4. Move host session logic behind existing signer/approval/storage interfaces. Exercise pairing/reconnect, revocation, account switching, concurrent admission and resource exhaustion.
5. Migrate browser and wallet on isolated branches, using the same vectors and cross-implementation test suite. Verify that every duplicated transcript/codec implementation has been removed or reduced to an adapter.
6. Run physical Wi-Fi and BLE tests on iOS and Android, then test against an independently maintained peer. Publish an explicitly experimental npm version only after verifying packed exports, license and dependencies. Integrate release consumers only after that exact version exists on npm.

## Public API direction

Prefer a transport interface with `open()`, `send(frame)`, `close()`, `onMessage(handler)` and `onClose(handler)`, matching the existing browser client. Keep construction options explicit: pinned host key, peer transport key provider, supported methods, clock and timeout policy. Avoid a global singleton, implicit discovery, silent pairing or a default identity key. The package should never receive a user's mnemonic merely to establish a transport session.

## Release gates

The package is experimental until physical radio behavior, replay boundaries, cancellation and independent interoperability are verified. The current protocol does not provide forward secrecy or authenticated website origins through an untrusted broker. Document those limits in the package README and the NIP; do not imply the SDK changes them. Confirm a compatible open-source license for extracted source before npm publication.
