# NWC audit — 23 September 2026

Scope: the extension's existing NWC wallet flows, from setup and WebLN consent to
signed relay requests, balance/history, receive invoices, payment approval and
provider disposal. Tests use disposable keys, synthetic invoices, mock browser
storage and a loopback WebSocket wallet. No external wallet, public relay,
production secret or real payment was used.

## Protocol scope

The implementation supports `get_info`, `get_balance`, `make_invoice`,
`lookup_invoice`, `list_transactions` and `pay_invoice` using kind 23194/23195,
NIP-01 signatures and negotiated **NIP-44 v2 or legacy NIP-04 encryption**.
A bounded signed kind-13194 read selects the newest wallet advertisement before
EOSE, preferring NIP-44 v2. Missing info/encryption tags use NIP-04; an explicitly
unsupported scheme fails. Up to five distinct URI relays are tried sequentially
before request publication, within one 60-second connection budget. This is not a
claim of complete NWC extension coverage or live provider certification.

The [official NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md)
was checked during the audit: responses must identify the requested method;
amounts use millisatoshis; multiple relays and NIP-44 negotiation are specified.
The extension supports both cipher modes, including NIP-44-only advertisements.
It does not implement optional NWC extensions or replay a published request on
another relay. Capability discovery waits at most 1.5 seconds; advertisements
arriving after discovery finishes cannot change the selected cipher. See the
[provider compatibility matrix](nwc-compatibility.md) for vendor-specific setup
and observed response shapes.

## Confirmed defects and fixes

- A silent socket handshake could hang indefinitely. Connection attempts now have
  the existing 60-second NWC deadline, close abandoned sockets and permit a new
  attempt. Concurrent callers still share one attempt.
- Network close left published requests waiting for their request deadline.
  It now rejects outstanding work immediately. Reconnection never republishes it.
- `result_type` was ignored and absent results became `{}`, allowing a payment
  to return apparent success with an undefined preimage. Responses now require
  the matching method and an object result. Expected numeric/string fields are
  validated, including nonnegative safe integer millisatoshis and 32-byte hex
  payment hashes/preimages. Malformed relay tags and verifier exceptions cannot
  escape as unhandled rejections or consume a valid pending response.
- Lookup swallowed every failure as unpaid. Only `NOT_FOUND` maps to unpaid;
  authorization, timeout, transport and malformed-result errors propagate.
- History could treat missing transactions as empty and pending/failed entries
  as settled. Missing/malformed history fails; returned rows preserve pending and
  failed status, so existing paging/filtering can exclude pending invoices.
- A payment published before a transport or invalid-response failure has an
  **unknown outcome**, rather than proof of failure. It now returns
  `PAYMENT_OUTCOME_UNKNOWN`. An LNURL payment intent with this outcome retains a
  non-expiring marker; repeating that intent cannot resolve the address, create
  another invoice or publish another payment. Definite wallet rejections and
  failures before publication remain retryable. A new intent is still a new
  payment; check wallet history before deliberately starting one.
- Setup previously saved a replacement before proving wallet access. The real
  `wallet_connect` handler now probes an uncached candidate through `get_info`
  before saving. Authentication failure or vault lock during the probe preserves
  the existing configuration, and the probe's temporary provider is disposed.
- Receive amounts previously used integer truncation. Fractional/invalid amounts
  now fail validation. Every send-dialog close route stays blocked while paying;
  an unknown outcome shows a localized history-check message and blocks another
  payment within that dialog.

## Coverage matrix

| Area | Executed test coverage |
|---|---|
| URI and factory | URI fields/first relay, malformed keys, per-account cache, uncached construction via setup, removal/reconstruction |
| Connection lifetime | Open/error/remote close, shared attempts, silent handshake deadline, late open, disposal during connect/encrypt/sign/decrypt, credential zeroing |
| Wire protocol | Independent nostr-tools wallet verifies extension signatures and decrypts requests; all six methods round-trip with NIP-04 and NIP-44 v2 |
| Negotiation/failover | Newest signed info, forged/wrong-author info rejection, bounded discovery, late info ignored, unsupported scheme refusal, URI relay cap, connection fallback without payment replay |
| Authentication | Wrong author, forged signature, undecryptable content, malformed tags, verifier exception, unrelated request ID, wrong result method |
| Balance/info | Alias and granted methods, millisatoshi conversion, malformed values, backend-aware WebLN capabilities without identity disclosure |
| Receiving | Invoice amount/memo conversion, unsafe amounts, invoice/hash validation, pending/paid/not-found lookup, propagated errors |
| History | Limit/offset and `unpaid:false`, incoming/outgoing signs, fees/timestamps, empty page, malformed result and pending/failed state |
| Payment | Successful preimage, authorization/balance/payment errors, approval/rejection, per-account deny overriding threshold, one publication on timeout/disconnect |
| Race/replay | Out-of-order concurrent responses, timeout then late reply, lock cancellation, reconnect, unknown LNURL intent replay with no new invoice, aged unknown marker retention |
| Production handlers | Real setup, vault persistence, info/balance/deposit/check/history/pay, real injected WebLN consent/capabilities/payment routing, disconnect and unlock reconstruction |
| Mounted UI | NWC setup retry/success, send validation/error/success, receive amount/poll/recovery/paid-once/close/unmount, unknown-outcome retry blocking |

The protocol harness lives in `tests/helpers/nwc-wallet.ts`, reused by the
provider and production-handler integration suites. Older
`background-handlers.test.ts` cases often reconstruct handler behavior; the new
setup cases and `payment-integration.test.ts` invoke the real handler map.

## Verification and limits

Targeted commands:

```sh
npm run test:nwc
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/payment-integration.test.ts tests/wallet/payment-intents.test.ts tests/wallet/background-handlers.test.ts
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet-ui.test.ts
npm run typecheck
```

The initial combined provider/factory/production-payment/intent run passed **136 tests,
0 failures** using:

```sh
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/nwc.test.ts tests/wallet/nwc-integration.test.ts tests/wallet/index.test.ts tests/wallet/payment-integration.test.ts tests/wallet/payment-intents.test.ts
```

Final verification: `./tests/run.sh` passed **1,788 tests, 0 failures, 0 skipped**
(216 crypto, 281 wallet protocol, 269 UI/helpers, 1,022 module tests). Its production
build succeeded; `npm run typecheck` and `git diff --check` also passed.

These tests establish the covered local behaviors; they do not certify
third-party wallets, browser service-worker lifetime, live relay availability,
Lightning settlement, native QR scanning or store packages.

Payment success validates response provenance, method and preimage shape; it does
not independently hash the preimage against the BOLT11 payment hash or verify a
Lightning node's settlement. The wallet remains the settlement authority.
Alby nullable aliases/settlement times and LNbits nullable optional fields/signed
history fees are normalized; required monetary fields and hashes remain validated.
Display values retain the existing nearest-whole-satoshi rounding. Relay negative
publication acknowledgements are not separately interpreted; missing wallet
responses expire at the request deadline. Local connection success alone is a
socket state; setup adds the authenticated `get_info` probe described above.

Unknown-intent markers live in browser session storage, surviving worker restarts
but not a full browser-session reset. Closing and reopening the Send dialog
starts a new user flow; neither that nor a new intent is automatically reconciled
against wallet history. The warning directs the user to check history first.


Modern compatibility follow-up: `npm run test:nwc` passed **118 tests, 0 failures**
after adding encrypted six-method fixtures, capability discovery, and safe
pre-publication relay fallback. `npm run typecheck` also passed. No real wallet
credentials or payment activity were needed for these regressions.
