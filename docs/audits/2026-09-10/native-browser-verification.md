# Native browser verification — 2026-09-10/11

## Environment and scope

Chrome, installed unpacked Nostr WoT 0.7.0, reloaded by the user from the main
clone's build. Native toolbar popup controlled through accessibility UI; a local
page exercised the actual injected NIP-07/WebLN bridge. Existing
`nostr-wot-pqc-test` identity used. No events were published, payments sent,
private keys exported or production wallet settings changed.

## Observed results before the approval-label follow-up

- Popup opens after extension reload and shows the selected account.
- An unconnected loopback origin shows the connection card without wallet balance.
- `webln.getBalance()` before consent rejects with “WebLN not enabled”.
- The page detects NIP-07, WebLN and `nip44.schemes` containing `nip44` and `pq`.
- After explicit connection, `getPublicKey()` returns the selected test identity.
- A signature claiming a different author rejects with “Event author does not
  match active account”; the next popup shows the reason and both shortened keys.
- Three simultaneous signature requests appear together, grouped into two posts
  and one reaction. Approve all resolves all three with the selected test author.
- One-time NIP-44 encrypt/decrypt approvals return the original synthetic text.
- Invalid base64 ciphertext rejects; the returned error still uses native `atob`
  wording. This is a rejected malformed-input case, not a successful decryption.
- PQ settings show seed-derived key status and separate key/export/announcement
  actions. The encrypted-download control is disabled without valid passwords.
  File generation and restoration were not exercised natively.

## Approval-label follow-up

The user requested consistent one-time approval as the primary action. The source
now distinguishes Approve once / Approve all from an explicit Always allow action
with an explanation of future permissions. Mounted tests verify the decision and
permission-save RPCs independently. This changed build still requires a native
reload and repeat check; earlier screenshots do not verify the new labels.

## Remaining verification

Do not describe this smoke pass as native exploit clearance. Native wallet
account/lock races, credential-bearing redirects, cache inspection, late-unlock
races, queue-limit checks, full PQ backup round trips and Firefox are not covered
by these observations. Automated regression tests cover those implementation
boundaries separately. A second loopback-origin request was started, but no final
native consent outcome was captured, so origin isolation is not counted as a pass.

The browser tool blocks extension-management URLs. The user performed the first
reload; another reload was requested for the approval-label change. No attempt
was made to bypass that restriction.
