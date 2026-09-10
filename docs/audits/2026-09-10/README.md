# Security audit — Nostr WoT 0.7.0

Date: 2026-09-10. Baseline: `4882a4dd5e0f9a0bcfe873c94f28153194ed4699` **plus the existing uncommitted working tree**. Findings refer to that source, not just the commit. The original audit did not modify production code. The remediation below was subsequently implemented in the working tree.

## Release assessment

**Historical assessment of the pre-fix source:** publication was blocked pending remediation. Four high-severity and three medium-severity findings were identified. Six controlled reproductions confirm the first five findings (one finding has two reproductions); the last two are source-confirmed weaknesses with stated prerequisites. No claim of a critical exploit, real-world compromise, or private-key extraction is made.

The existing regression suite passes despite these gaps. A passing suite is not security clearance.

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| A1 | High | Payment authorization is not bound to the wallet/account/session used to execute it | Two synthetic reproductions |
| A2 | High | WebLN payments ignore account-specific deny rules | Synthetic reproduction |
| A3 | High | Encryption/decryption request continuation lacks account-switch validation | Encryption reproduction; shared crypto path reviewed |
| A4 | High, conditional | LNbits API key follows cross-origin redirects | Real loopback requests using Node Fetch; browser standard reviewed |
| A5 | Medium | An earlier unlock can override a later explicit lock | Synthetic reproduction with real vault cryptography |
| A6 | Medium | Custom wallet provisioning permits insecure HTTP before provider validation | Source confirmed; requires custom insecure endpoint |
| A7 | Medium | Unlock/in-flight requests and crypto input lack effective resource bounds | Source confirmed; no destructive stress test |

Severity considers impact and prerequisites. In particular, A4 requires a redirect at the configured endpoint; it is not an arbitrary website stealing keys from an uncompromised HTTPS wallet.

## Remediation status — 2026-09-10

All seven numbered findings have code fixes and negative regression coverage in the current 0.7.0 working tree:

| Finding | Implemented control | Regression coverage |
| --- | --- | --- |
| A1 | Capture account/session/provider once; revoke on lock, account switch and wallet replacement; dispose retained LNbits/NWC providers | `tests/security-audit-regressions.ts`, wallet provider tests |
| A2 | Read and save WebLN rules using the captured account ID; explicit denial wins over the invoice threshold | `tests/security-audit-regressions.ts` |
| A3 | Validate account generation before key/backend dispatch and before returning crypto results; dispose stale remote signers | Security audit regressions and Nostr Connect integration tests |
| A4 | Refuse redirects before sending authenticated wallet requests to another endpoint | LNbits and provisioning transport tests |
| A5 | Serialize vault writes and reject unlock results invalidated by a later lock/destroy | `tests/vault.test.ts` |
| A6 | Validate transport before provisioning/authentication; HTTPS with a narrow loopback development exception; bounded response size/time | Provisioning tests |
| A7 | Per-host/global ingress and queue limits, bounded remote work, encoded-size validation before decoding, bounded activity storage | Communication, signer and crypto tests |

Unlock markers remain independently cancellable rather than coalesced; shared ingress and queue limits bound their total work. Session invalidation clears wallet and remote-signer caches synchronously. Already-dispatched external operations cannot be undone. Remote authentication URLs are no longer logged with their sensitive parameters.

The descriptions and line numbers below document the **original vulnerable source**, not the repaired implementation. The additional hardening recommendations remain separate from these seven fixes; this is not a claim that every residual risk has been eliminated. Native Chrome/Firefox exploit testing and independent cryptographic review remain outside the verified scope. See `remediation-verification.txt` for final command results. The release remains 0.7.0 and has not been published.

## Scope and method

Reviewed the privileged browser message boundary, page bridge, domain and account permissions, approval queue, signing and decryption, vault lifecycle/storage/key access, classical and custom hybrid PQ crypto integration, wallet providers and WebLN handlers, LNURL resolution, provisioning, activity/cache privacy, profile uploads, relay verification, manifest/build configuration, dependency advisories, and CI definitions. Read relevant architecture, message-flow, security, wallet and testing documentation, existing security tests, and implementation files. Used deterministic delays and synthetic accounts to exercise asynchronous boundaries.

This is a source and local reproduction audit, not formal verification or a cryptographic certification. It does not include a live penetration test of the deployed LNbits/provisioning service, third-party relay/bunker infrastructure, the native Safari wrapper, store review outcomes, browser engine internals, a comprehensive git-history secret scan, or a mathematical review of upstream cryptographic implementations. No real wallet was paid, real key exported, or production server attacked. The native installed extension was not used for end-to-end exploit testing. Unreviewed infrastructure and platform behavior remain limitations.

## A1 — Payment execution crosses account and lock boundaries

Location: `src/services/background/wallet-handlers.ts:106`, especially provider acquisition at 110, threshold lookup at 136, queue creation at 146, and execution at 159. Related: `src/services/background/vault-handlers.ts:88`, `src/services/wallet/lnbits.ts:81`, `src/services/signing/approvalQueue.ts:192`.

`getConnectedProvider()` captures a wallet before awaiting connection. The payment handler subsequently reads the active account again for the threshold and lets the queue infer its account independently. No final account/session check precedes payment.

Reproduction: capture A's provider, switch to B during its connection, configure a sufficiently high threshold only for B, then submit an invoice. The handler pays through A's provider without prompting, using B's threshold. This can spend from the wrong wallet and bypass A's payment policy. The test uses a mocked payment method, not a Lightning transfer.

A second reproduction queues a payment, invokes the real `vault_lock` handler, then approves the queued request. The payment method is still called while the vault is locked. The queue's account test can pass using public account metadata. Clearing the provider cache does not revoke the handler's captured object; LNbits `disconnect()` only flips a flag, and `payInvoice()` does not enforce it. There is no final vault check.

Prerequisite: a wallet-enabled site has an in-flight request overlapping account change or lock. The locked variant still requires an approval or an already-authorized continuation; it is not a fresh arbitrary payment request bypassing the initial vault gate.

Fix: capture a single authorization context containing account ID, wallet-config revision and session generation; use it for permissions, threshold, prompt and execution. Invalidate on account switch, lock, wallet replacement and disconnect. Immediately before dispatch reject changed/revoked contexts. Centralize lock cleanup for timed and manual locks, cancel outstanding approvals, and make retained provider references unusable after disposal. Already-transmitted Lightning payments cannot be undone, so enforce this before dispatch.

Acceptance: interleave every awaited phase with switch, lock and disconnect; no payment is dispatched under a stale context. Cover both LNbits and NWC plus manual LNURL payment continuation.

## A2 — Account-specific payment denial is not consulted

Location: `src/services/background/wallet-handlers.ts:123` and 155; permission resolution in `src/services/permissions/permissions.ts:93`.

The payment handler calls `check(origin, 'webln_sendPayment')` without an account ID. In account-specific mode, the permission service therefore consults `_default`, not the active account's bucket. The remembered decision is also saved without the account ID.

Reproduction: enable account-specific rules, explicitly deny payments for account A and the test origin, and set A's per-payment threshold. A below-threshold request still invokes the payment method. Without a threshold the denial is still missed, but the handler prompts rather than silently paying.

Prerequisite: the site already has WebLN access and an account-specific payment denial exists. The outer WebLN consent check is not bypassed by this finding.

Fix: pass the captured account ID to both permission reads and writes; deny must win before threshold evaluation. Add tests for separate allow/deny buckets on A and B, global-default mode, and remembered decisions.

## A3 — Crypto requests can continue with the previous account

Location: `src/services/signing/signer.ts:180`, particularly account capture at 202 and key access at 243.

`handleCryptoRequest()` captures account A, then awaits storage, permissions and possibly unlock/approval. Unlike `handleSignEvent()`, it does not revalidate the active identity before obtaining A's key or dispatching to A's remote signer. Canceling pending prompts does not cancel requests that are between awaits or using a saved allow rule.

Reproduction: grant A encryption permission, switch to B during the vault-existence read, and complete encryption. Decrypting the output with the test recipient's key proves A was used although B is active. The same missing check is present in the shared NIP-04/NIP-44 decryption path; that privacy impact is a source inference, not a separate live decryption exploit demonstration.

Fix: use the same account/session authorization context as signing; validate before accessing keys and again before releasing asynchronous results. Reject stale operations consistently and record the account-switch rejection. Include classic, PQ and remote signer paths; aborting local tracking alone cannot undo an operation already sent to a bunker.

## A4 — LNbits credential forwarding on redirects

Location: `src/services/wallet/lnbits.ts:43`.

Requests attach `X-Api-Key` and leave Fetch's redirect behavior at its default. `assertSecureUrl()` validates only the initial configured URL. A redirect can send the custom credential header to another origin.

Reproduction: the real provider contacts a loopback server that returns a 302 to a second loopback origin. The second server receives the exact synthetic API key. This confirms Node Fetch behavior. It is not a native Chrome/Firefox reproduction. The browser Fetch algorithm specially removes `Authorization` on cross-origin redirects; that protection does not make an arbitrary `X-Api-Key` header secret. Actual browser delivery also depends on CORS/host permissions and redirect policies. An attacker-controlled destination can permit the required CORS request. See the [Fetch redirect algorithm](https://fetch.spec.whatwg.org/#http-redirect-fetch).

Impact: exposure of a wallet spending credential if the configured endpoint or its routing can be made to redirect to an unintended destination. A compromised wallet service already knows the credential; the additional concern is redirect/open-redirect/configuration behavior expanding the trust boundary.

Fix: use `redirect: 'error'` for authenticated wallet requests and require users to configure the canonical endpoint. Validate URLs centrally and add timeout/body limits. Add cross-origin, same-origin and HTTPS downgrade redirect tests. Do not rely on inspecting `response.url` after the credential was sent.

## A5 — Late unlock resurrects a locked session

Location: `src/services/vault/vault.ts:163` and 248.

`unlock()` performs asynchronous storage/KDF/decryption work, then installs `_decrypted` and `_cryptoKey` without checking whether a newer `lock()` or destroy invalidated that work.

Reproduction: pause the storage read of an unlock, call `lock()`, release the read and await the earlier unlock. `isLocked()` becomes false again. Real PBKDF2/AES-GCM is used. This requires an already-running legitimate unlock or re-verification; a website cannot supply the password through the privileged RPC gate.

Fix: increment a vault lifecycle generation on lock/destroy and reject/zero stale unlock results. Serialize create, save, re-encryption and destruction consistently. The separate `save()`/`reEncrypt()` salt/key interleaving also warrants testing, but vault corruption from that interleaving was not reproduced and is not counted as a confirmed finding here.

Acceptance: lock/destroy during each await leaves the vault locked; stale startup unlock and password re-verification cannot restore a canceled session.

## A6 — Provisioning does not enforce HTTPS before transmitting

Location: `src/services/wallet/lnbits-provision.ts:36`; `src/services/background/wallet-handlers.ts:314`; `src/screens/Wallet/WalletSetup.tsx:35`.

The advanced provisioning URL is passed directly to fetch. Challenge retrieval and the signed provisioning POST happen before constructing/connecting the LNbits provider, whose HTTPS guard runs too late. The provisioning response contains `adminkey` and potentially an NWC URI. Username claim/release helpers likewise lack a shared transport validator.

A custom non-local HTTP endpoint therefore receives signed authentication and returns wallet credentials over plaintext transport, subject to browser network policy. The default HTTPS endpoint is not affected by selecting the default. No live HTTP provisioning was performed.

Fix: validate HTTPS before the first request in all provisioning/address helpers, reject redirects, validate challenge/response shapes, and bound duration/body size. If loopback development is supported, make it an explicit narrow exception. Add tests proving invalid endpoints never invoke fetch or the signing callback.

## A7 — Incomplete request and payload resource limits

Location: `src/services/signing/approvalQueue.ts:379`, `queueNip46InFlight()` in the same file, `src/services/background/nip07-handlers.ts:validateNip07Request`, `src/lib/crypto/pq.ts:isPqEnvelope`/`pqDecrypt`, and `src/lib/crypto/nip44.ts`.

The normal approval queue caps actionable prompts per origin, but unlock markers and NIP-46 in-flight entries are not covered by that cap. Each unlock marker performs session-storage work and creates polling/timeout state. Incoming content/tag/ciphertext strings lack an early byte limit; some decoders allocate the decoded buffer before checking its size, while PQ envelope detection decodes the input too.

A connected site with a saved crypto permission can submit many requests while locked and consume background memory, timers and storage work without the actionable-prompt cap applying. Very large payloads can also consume resources before rejection. This is an availability concern; no browser crash, exact exhaustion threshold or secret disclosure is claimed. No destructive flood was run.

Fix: bound all requests per origin and globally at ingress, coalesce unlock waiters per account, cap remote in-flight work, and validate encoded lengths before decoding. Bound events, tags, ciphertext and activity storage by bytes, not only entry count. Test modest limit+1 workloads and ensure cancellation/disconnection releases all counters.

## Follow-up implementation — 2026-09-10

The subsequent hardening pass encrypts wallet/activity caches and payment replay results with a vault-protected cache key, replaces safe-account object spreads with explicit public fields, binds page permissions to full origins, reserves a rolling 24-hour automatic-payment allowance across sites, validates LNURL amounts exactly without adding a metadata-hash policy beyond current LUD-06, and pins CI actions with contents:read. Legacy site grants retain their prior scope without reconnect/reapproval; only new grants use exact origins. Description-only LNURL invoices remain supported for current-standard compatibility. See [private caches](../../private-cache.md), [payment policy](../../payment-hardening.md), [origin migration](../../origin-permissions.md), and [safe metadata](../../safe-account-data.md).

The following recommendations describe the original audit baseline. The implemented items above supersede their original status; remaining limitations include local-DNS resolution, custom PQ assurance, never-lock local access, immutable secret strings and unencrypted public metadata/rejection notices. A limited Chrome smoke pass is recorded in [native browser verification](native-browser-verification.md). Native security-boundary coverage and Firefox verification remain outstanding.

## Additional hardening and residual risks

- **Origin scope:** permissions use hostname rather than full origin. Services on different ports of the same host share trust. This is consistent with existing domain-oriented code, so not counted as a newly demonstrated bypass. Prefer explicit scheme/host/port binding, especially for localhost, or clearly communicate the broader grant.
- **Secret lifetime:** wallet/NIP-46 configs retain secret strings; `SafeAccount` retains `nip46Config`, and the vault accessors' runtime object spread can retain `walletConfig` despite its omission from the type. No public page route exposing that object was demonstrated. Use explicit public metadata allowlists and revocable secret-bearing provider objects. Avoid materializing the whole vault for one account's PQ derivation. JavaScript zeroization cannot guarantee removal of immutable string copies.
- **PQ assurance:** the reviewed envelope combines KEM and classical key material, authenticates context, and refuses silent remote-signer downgrade. These are useful controls, not certification of the custom construction. Independent cryptographic review and cross-implementation vectors remain appropriate.
- **LNURL integrity:** invoice amount is checked after rounding to sats; metadata description-hash verification is absent. Require exact msat equality and validate the metadata hash as specified by [LUD-06](https://github.com/lnurl/luds/blob/luds/06.md). No excessive-payment exploit was demonstrated; the rounding discrepancy is under one sat.
- **Network locality:** LNURL rejects IP literals/local names and redirects, but public-looking DNS names can resolve to private addresses. Hostname filtering alone is not a guarantee against private-network access. No DNS-rebinding attack was performed.
- **Privacy:** wallet display balances/memos/payment hashes and activity event content remain outside the encrypted vault by design. Vault lock does not encrypt those caches. Describe this clearly, bound retention, and consider a privacy option to clear/hide them. Auth URLs are still logged by the remote signer and may carry sensitive session parameters; remove or redact those production logs.
- **Auto-approval:** the wallet threshold is per invoice, not an aggregate spending budget. A trusted-but-compromised site can send repeated small invoices. Make that scope explicit or add cumulative/session limits; the comment claiming a site can never drain the wallet silently is too broad.
- **CI:** actions are referenced by mutable major tags; pin reviewed SHAs and declare least-privilege workflow permissions. No dependency advisories were returned, but this does not audit upstream package source or the registry supply chain.

## Positive controls observed

- Privileged handlers are derived into an internal-only gate; the page bridge restricts callable methods and the port derives the site's hostname from the browser sender.
- WebLN access has separate consent from NIP-07; unrelated pages cannot simply read wallet balances through the normal gated path.
- Explicit foreign-author signing requests and account-mismatched pending approvals are rejected; the missing continuation checks above are narrower gaps.
- Password vaults use random salt/IV, PBKDF2 and authenticated AES-GCM. Private-key byte copies are generally zeroed in finally blocks. Never-lock mode's empty password is intentional and offers no meaningful secrecy against local storage access.
- NWC responses check wallet author, signature and request correlation before resolving. Relay/profile reads verify signed events. Local gift-wrap decryption verifies the inner seal.
- NIP-44 authenticates ciphertext and checks padding; PQ encryption uses authenticated encryption and binds identity/context. No dynamic `eval`, `new Function` or raw HTML injection sink was found in the searched first-party source.
- Manifest review found no `externally_connectable` entry or executable extension UI in web-accessible resources. Firefox data-consent categories are declared. This is not a guarantee of Mozilla policy approval.

## Verification and evidence

Historical reproduction (expected to fail after remediation because it asserts vulnerable behavior):

```sh
node --import tsx --import ./tests/helpers/register-mocks.ts docs/audits/2026-09-10/reproduce.mjs
```

It uses only synthetic keys, browser mocks, fake payment methods and two loopback HTTP servers. It deliberately asserts the vulnerable behavior, so **a successful run confirms defects; it is not a security regression pass**. It is not added to the normal test runner. The negative regression cases now run through `tests/security-hardening.test.ts` (which imports `tests/security-audit-regressions.ts`), `tests/vault.test.ts`, and the wallet transport tests. Use `./tests/run.sh` to verify the repaired behavior.

Audit evidence: [reproduction script](reproduce.mjs), [npm audit JSON](npm-audit.json).

At the original audit baseline, the full suite, including build, completed successfully: crypto **213/213**, wallet **223/223**, remaining unit tests **259/259**, browser-mocked modules **834/834** — total **1,529 passed, 0 failed**. Vite built successfully in **1.47 s**. TypeScript checking passed. Lint completed with **0 errors and 10 existing hook-dependency warnings**. See [verification output](verification.txt) and [audited source hashes](source-sha256.txt). Raw command logs are in `/tmp/security-audit-*.log`.

At the original audit baseline, all checked Chrome/Firefox upload ZIPs and the source ZIP reported version **0.7.0**, but their background script differs from current `dist/`. Do not treat those packages as containing the current fixes. Regenerate, compare and hash them after remediation; keep the release at 0.7.0 and draft until an explicit publish request.

## Remediation order

1. A1/A2: bind wallet authorization to the selected account and enforce explicit deny; revoke stale operations on lock/switch/disconnect.
2. A3/A5: introduce consistent identity/session generations across cryptographic operations and vault lifecycle transitions.
3. A4/A6: unify secure wallet transport with redirect refusal and response limits.
4. A7: enforce ingress and in-flight resource limits, including unlock markers.
5. Turn the reproductions into negative regression tests; repeat the full suite and native Chrome/Firefox checks with synthetic wallets. Regenerate the 0.7.0 upload artifacts only after the blockers are resolved.
