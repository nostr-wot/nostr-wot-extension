# LNbits app connections

Wallet Settings → App connections lists server-side active NWC grants and budget
usage. Users create multiple named connections with a positive spending limit per
24-hour period and expiry (1–365 days), reveal their locally held string/QR, or
confirm revocation. Grants allow pay/lookup/info; they do not expose balance/history.
Connections created elsewhere can be listed and revoked, but secrets cannot be
reconstructed. Custom LNbits servers require the LNbits-proxy management adapter.

`wallet_listAppConnections`, `wallet_createAppConnection`, `wallet_copyAppConnection`
and `wallet_revokeAppConnection` are privileged extension RPCs with explicit account
IDs and current wallet/session checks. The HTTP service uses the existing HTTPS,
redirect-refusal, timeout and response-size bounds. Fresh secrets are encrypted in
account/wallet-bound private storage before registration. A create request ID keeps
transport retries on the same grant. Refresh recovers a successful registration
whose response was lost. Secrets are never sent to the proxy; the string is assembled
locally from public provider metadata. Explicit disconnect/account deletion clears
local secrets but does not revoke server grants. Vault destruction erases the cache.

The API and deployment belong to [LNbits-proxy](https://github.com/nostr-wot/LNbits-proxy),
with rules in its AGENTS.md. Tests cover HTTP contract, multiple grants, request replay,
wallet/account isolation, encrypted storage, lost-response recovery and revocation;
mounted UI tests cover listing, secret reveal, confirmation and empty/create states.
