# NWC protocol and payment outcomes

The NWC provider in [`src/services/wallet/nwc.ts`](../src/services/wallet/nwc.ts)
implements `get_info`, `get_balance`, `make_invoice`, `lookup_invoice`,
`list_transactions` and `pay_invoice` over signed NIP-47 events (kinds 23194/23195).
See [wallet setup and compatibility](nwc-compatibility.md) for connection permissions
and [the wallet reference](wallet.md) for WebLN consent and account isolation.

## Connection and encryption

Connection URIs contain the wallet public key, client secret and up to five distinct
relay URLs. The provider factory validates keys and injects the shared NIP-01,
NIP-04 and NIP-44 implementations. An uncached `get_info` probe must succeed before
setup replaces the saved wallet configuration. Failed setup or vault lock preserves
the previous configuration and disposes the temporary provider.

Signed kind-13194 capability discovery selects the newest valid wallet advertisement
received before EOSE or the 1.5-second discovery deadline. NIP-44 v2 is preferred;
missing info or encryption tags permit legacy NIP-04. Explicitly unsupported schemes
fail, and late advertisements cannot change the selected cipher.

Connection attempts share a 60-second budget across sequential URI relays. Fallback
is allowed only before publication. Requests also have a 60-second deadline; socket
close rejects outstanding requests. Reconnection never republishes a payment.
Disconnect and vault lock dispose providers and zero their client secret bytes.

## Response validation

Responses must come from the configured wallet public key, pass signature verification,
decrypt, identify the pending request and match its method through `result_type`.
Malformed tags, unrelated IDs, forged events and verification exceptions cannot consume
a valid pending response. An authenticated but malformed result rejects the request.

Required amounts are nonnegative safe integers in millisatoshis. The application-facing
provider uses sats; display conversion rounds to whole sats. Optional nullable provider
fields and signed history fees are normalized. History preserves pending/failed states.
Only a `NOT_FOUND` lookup response means unpaid; authorization and transport errors
propagate instead of masquerading as an unpaid invoice.

A successful payment requires a 32-byte hex preimage whose SHA-256 hash matches the
payment hash decoded from the **original requested BOLT11 invoice**, which must contain exactly one valid 52-word payment-hash field (32 bytes with zero padding). Missing, malformed
or mismatched proofs, including success for an undecodable/hashless invoice, cannot be
reported as payment success. This verifies the invoice's hash relation; it is not an
independent observation of Lightning network settlement.

## Unknown outcomes and retries

After `pay_invoice` publication, timeout, disconnect or an invalid success response
raises `PAYMENT_OUTCOME_UNKNOWN`: the extension cannot infer that funds did not move.
Definite wallet error responses and failures before publication retain their existing
error behavior. No payment is automatically replayed on another relay.

An LNURL payment intent with unknown outcome keeps a non-expiring metadata marker in
browser session storage. Reusing that intent cannot request a fresh invoice or send
again. Encrypted payment results and wallet display data remain separate from these
markers. Session markers survive worker restarts, but not a full browser-session reset.
Starting a new intent or reopening the Send dialog is a new flow; inspect wallet history
before doing so. The extension does not automatically reconcile new intents against it.

## Tests and limits

```sh
npm run test:nwc
npm run test:payments
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet-ui.test.ts
```

- `tests/wallet/nwc.test.ts` covers response validation, deadlines, provider lifetime,
  payment proof matching and unknown outcomes.
- `tests/wallet/nwc-integration.test.ts` uses `tests/helpers/nwc-wallet.ts`, an independent
  signed loopback wallet, for six-method encrypted round trips, negotiation, invalid
  responses and pre-publication relay fallback.
- `tests/wallet/payment-integration.test.ts` and `payment-intents.test.ts` cover production
  handlers, account/session guards, consent and unknown-intent replay suppression.
- `tests/wallet-ui.test.ts` covers setup, payment and receive interaction lifecycles.

Tests use synthetic credentials/invoices and do not move real funds. They do not certify
live providers, relay availability, browser worker survival, QR hardware or store packages.
Optional NWC extensions are not implemented. A negative relay `OK` for a pending event now rejects the request immediately with the relay reason; a positive `OK` only confirms relay acceptance, so the client still waits for the encrypted wallet response. A definite relay refusal is reported separately from a wallet-response timeout, including for payments.
