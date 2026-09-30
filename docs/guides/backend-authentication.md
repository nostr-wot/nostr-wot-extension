# Know which backend you are authenticating to

Nostr WoT separates permission to use your identity on a website from permission to
authenticate that identity to an HTTP service. A website and its API can live on
different domains. The approval must describe the service receiving the proof,
not assume that it is the website in your address bar.

This guide covers the authentication protections in Nostr WoT 0.8.7.

For WebSocket relay authentication, read the separate
[relay authentication guide](relay-authentication.md).

## Different domains are legitimate; permission still has a destination

Consider a fictional client at `https://client.example` whose API is
`https://api.client.example`. A request to authenticate a `POST` to
`https://api.client.example/session` can be legitimate. Blocking every different
hostname would break this architecture.

Instead, Nostr WoT keeps the requesting website and the signed destination
separate. A remembered HTTP approval is specific to:

| Permission boundary | Example |
| --- | --- |
| Your account | The account approving the request |
| Requesting website origin | `https://client.example` |
| Exact signed URL, including query text | `https://api.client.example/session` |
| HTTP method | `POST` |

That approval does not also authorize `/delete-account`, another method, another
port, another website or another account. A different query string requires its
own approval. Same-origin authentication follows the same rule. Older saved
origin-wide HTTP allows require consent again; older denials remain effective.

The [client/backend directory](../auth-client-registry.md) helps explain familiar
services. It is informational: adding an entry cannot authorize a backend or skip
consent. Contributors can [propose registry entries](../../CONTRIBUTING.md).

## What you see and control

The prompt identifies the requesting site and the authentication destination.
Use **Approve** or **Reject** for the current request. The arrow menu offers
**Approve always** for this exact site/account/URL/method, or **Reject always**.
HTTP authentication has no “all sites” allowance.

The code button opens the raw event for inspection. Ordinary bulk signing
approval excludes authentication requests so destination-specific consent is not
lost in a mixed queue. At the bottom of **Permissions**, the authentication table
shows remembered decisions for the active account and lets you revoke them.
Revoking permission prevents future use; it cannot recall a proof already sent or
log you out of a session the backend has already created.

## What the extension verifies

The requester comes from browser-provided document identity, not a website's
claimed origin parameter. Authentication requires a verified top-level frame;
embedded frames, opaque origins and inconsistent document origins are refused.
HTTPS is required outside explicit loopback development exceptions. An iframe
cannot borrow a trusted parent's authentication permission.

The event parser rejects ambiguous required tags, invalid URLs, unexpected
content and stale timestamps. Optional `origin` and `client-origin` tags must
match the actual requesting origin. General signing permission does not bypass
these authentication approvals. Site access, account-session validity and
permissions are rechecked after waiting for approval or unlock.

With a NIP-46 bunker, the returned signature must belong to the expected account
and match the approved event's kind, timestamp, content and ordered tags. A valid
signature on a different event is rejected.

## Extra protection for native wallet operations

The companion LNbits-proxy uses a stricter v2 contract for provisioning/recovering
a wallet and claiming/releasing an address. These are privileged operations, not
an ordinary website login. The extension's generic website signer refuses tokens
for the native wallet service's sensitive management paths.

In the dedicated wallet flow, the proof binds the exact URL, method and hash of
the exact request body. A backend-issued challenge lasts 60 seconds and can be
consumed once. A separate transaction token travels in its own header; only its
hash is signed. The server verifies these bindings and the signature before an
atomic nonce consumption. Changing the operation body invalidates the proof.

Browser requests use an exact configured HTTPS origin allowlist and a matching
signed client-origin value. The native flow still requires the proof and separate
transaction token. Public LNURL discovery retains its separate policy. This is
an application-specific contract, not a new requirement imposed on all Nostr APIs.
The [wire specification and rollout guide](../wallet-auth-v2.md) has the developer
details. Deploy the compatible backend before publishing the extension: retired
routes return HTTP 426, and the client deliberately does not downgrade.

## What this does—and does not—prove

[NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) binds a signed
HTTP proof to its URL and method; a conforming backend must check those values.
The wallet contract additionally requires body binding and one-use transactions.
For other backends, the extension cannot force the server to validate correctly.

A proof for backend A should not be accepted by backend B. However, someone who
holds a valid proof and any required transaction token can forward them to the
intended backend before their first use. CORS restricts browsers; it cannot stop
arbitrary server-to-server requests. An origin tag is not cryptographic browser
attestation, since another signer could sign a false claim.

Likewise, malicious code running inside a trusted top-level site shares that
site's authority. These controls reduce the scope of consent and reject concrete
forms of substitution and replay; they do not promise to eliminate phishing,
compromised sites, or every form of authentication forwarding.

## Inspect the implementation

- [Origin boundary](../../src/domain/signing/requestOrigin.ts), [event parser](../../src/domain/signing/authentication.ts), and [saved grants](../../src/services/permissions/authentication.ts).
- [Remote event verifier](../../src/services/signing/remoteEventVerifier.ts).
- [Authentication regression tests](../../tests/authentication.test.ts) and [remote signature tests](../../tests/remote-signer-integrity.test.ts).
- [Backend validator and tests](https://github.com/nostr-wot/LNbits-proxy): exact request binding, local HTTP integration, and nonce consumption across processes sharing the database.
