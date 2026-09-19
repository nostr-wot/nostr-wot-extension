# Remote signer compatibility

The integration suite covers protocol behaviors, not certification of every
third-party signer app. No real Amber device or production signer account is
used by these tests.

## Supported paths and regression coverage

| Path / behavior | Coverage |
| --- | --- |
| Pasted `bunker://` with a pairing secret | Real loopback NIP-46 handshake, identity lookup, vault save and subsequent signing |
| Client-generated `nostrconnect://` QR | Real encrypted secret acknowledgement, identity lookup, vault save and subsequent signing |
| Shared transport/user key (simple bunkers) | Both onboarding paths and verified signatures |
| Separate transport/user keys (Amber-style connections / hosted signers) | Both onboarding paths; the account identity comes from `get_public_key`, never the connection event author |
| Unavailable initial QR relay | A second available relay completes the handshake |
| QR signer-selected relays | Save the signer's current `bp.relays` rather than the wizard's original first relay |
| Multiple saved relays and encoded pairing secrets | Account serialization preserves every relay and the exact secret |
| Reconnection | Reuse the client key generated during pairing, then sign as the resolved user |
| Approvals | Delay, rejection, cancellation, concurrent out-of-order responses and pending-marker cleanup |
| Browser authorization challenge | `auth_url` during bunker onboarding and signing, followed by the final response on the same request ID; insecure onboarding auth URLs are not opened |
| Encryption operations | Remote NIP-04 and NIP-44 encrypt/decrypt and rejection |
| Identity lookup failure | Invalid public key, rejection and timeout cannot produce an account; temporary signer subscription closes |
| Vault/account isolation | Lock, unlock, disconnect and session invalidation coverage |

Tests live in `tests/nostr-connect-integration.test.ts`, with mocked persistence
and restart cases in `tests/signer.test.ts`. Run `npm run test:nostr-connect`.
The full suite and CI include these tests.

## Gaps and unsupported alternatives

- Amber's Android `nostrsigner://` intents and ContentProvider are **NIP-55**,
  not relay-based NIP-46. The extension does not implement that native interface.
- The wizard accepts a bunker URI or generates a QR URI. It does not accept a
  NIP-05 signer address or discover provider metadata using NIP-89.
- The pinned `nostr-tools` BunkerSigner uses NIP-44 for the NIP-46 transport.
  Legacy NIP-04-only transport is not supported. Calling the remote
  `nip04_encrypt` method is a different feature and does not test legacy transport.
- Actual Amber, nsec.app and self-hosted bunker UI/device workflows remain native
  interoperability checks. Relay AUTH requirements, provider-specific extensions,
  delayed relay migration after the library's initial switch window, and resuming
  a completed handshake after worker suspension need additional coverage.
- Accounts previously saved with the transport key as their identity need to be
  reconnected. This change does not silently migrate an existing identity or its
  permissions to a different public key.

## Fix found by this audit

Previously both onboarding paths saved the connection key as the user identity;
the integration fixture used one key for both, hiding the defect. QR onboarding
also discarded all but the first original relay. Setup now queries
`get_public_key`, keeps the current full bunker pointer and persists the pairing
client key. Requests continue to use the connection key for encrypted transport.

References:
- NIP-46: https://github.com/nostr-protocol/nips/blob/master/46.md
- Amber connection handling: https://github.com/greenart7c3/Amber/blob/master/app/src/main/java/com/greenart7c3/nostrsigner/service/BunkerRequestUtils.kt
- Amber interfaces: https://github.com/greenart7c3/Amber/blob/master/SECURITY.md
