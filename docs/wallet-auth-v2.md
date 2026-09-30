# Wallet authentication v2

Wallet provisioning, username claiming and username release use a body-bound,
one-use transaction protocol shared with LNbits-proxy. This is a stricter local
contract built on signed NIP-98 events, not a change to generic NIP-98.

## Wire contract

1. Serialize the operation body once and SHA-256 hash its exact UTF-8 bytes.
2. POST `/api/v2/provision/challenge` with exactly `{url, method, payload}`.
   `url` is the absolute operation URL; `method` is `POST`; `payload` is its
   lowercase hexadecimal body hash. The server uses its configured public HTTPS
   origin, never the incoming Host or forwarding headers.
3. The response contains `version: 2`, a 64-character hexadecimal `challenge`,
   a separate 64-character hexadecimal `transactionToken`, and `expiresAt`
   (Unix seconds, 60-second lifetime).
4. Sign an empty-content kind 27235 event with current `created_at` and unique
   two-element tags: `u`, `method`, `payload`, `challenge`, and `transaction`.
   The transaction tag is SHA-256 of the UTF-8 token string. It is not the token.
5. Send the unchanged operation body with `Authorization: Nostr <base64 event>`
   and `X-Nostr-Transaction: <token>`. Never put the token in the event, URL,
   body, persistent storage, or logs.

| Operation | Path | Exact body fields |
| --- | --- | --- |
| Provision/recover wallet | `/api/v2/provision` | `name` |
| Claim address | `/api/v2/claim-username` | `username` |
| Release address | `/api/v2/release-username` | none (`{}`) |

Queries, duplicate/extra authentication tags, incorrect bodies, expired events,
wrong audiences and invalid signatures are rejected. SQLite stores challenges
bound to URL, method, body hash, transaction hash and client scope. An atomic
conditional delete permits a single consumption across server processes.
Malformed proofs do not consume an otherwise valid challenge.

## Browser and native scopes

An HTTPS browser Origin must match an explicitly configured backend allowlist
entry, and its signed `client-origin` tag must match that exact Origin. Native
extension origins and missing Origin use the native flow, without that tag; they
still require both the signature and separate transaction token. This distinction
is not client attestation. CORS cannot authenticate server-to-server callers.
Public LNURL endpoints and existing wallet-key API routes retain their separate
policies; the strict origin policy here covers v2 identity-based wallet mutations.

The extension signs these operations through its privileged wallet handler with
account-session guards. Generic website signing is refused for the native wallet
service's sensitive legacy and v2 paths. Custom provisioning servers must implement
v2; there is no automatic legacy fallback.

## Rollout and limits

Deploy and verify the compatible LNbits-proxy backend before publishing this
extension. Retired authentication endpoints return HTTP 426. If the backend is
not upgraded, the extension fails clearly instead of downgrading authentication.
Previously connected wallet-key operations are unaffected by this migration.

Exact signed URLs prevent a proof for one backend being accepted as a proof for
another. Body binding prevents substituting the operation data. One-use challenges
prevent replay after consumption. These controls do not prevent a holder of both
the proof and transaction token from forwarding them to their intended backend
before first use, nor can the extension force unrelated backends to validate them.
Do not describe CORS or origin tags as preventing all proxying or phishing.
