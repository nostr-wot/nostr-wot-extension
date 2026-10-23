# Request passkey interoperability support

Use the [public integration request form](https://github.com/nostr-wot/nostr-wot-extension/issues/new?template=passkey_integration.yml) and [website guide](https://nostr-wot.com/passkey-integrations). Requests may cover another client using a source RP, protocol compatibility, or signer-only access. Every provider follows the same review principles; source and receiving-client roles are directional.

## What to provide

- Public project/repository and maintainer contact.
- Exact receiving HTTPS production/staging origins and requested source RP. Compatibility-only and signer-only requests can mark origin authorization as not applicable.
- User flow and actual secret scope: signer operation results, an account key, seed or full vault.
- Consent, session storage, logout and recovery behavior.
- Protocol/package versions, modes, legacy support, vault support and recovery locations.
- Tests with disposable identities, supported platforms, known gaps and a pilot/support plan.

Do not put seeds, keys, PRF outputs, tokens, credential IDs or personal vaults in public issues. Confidential details and vulnerabilities belong in the repository’s private security-reporting channel. GitHub sign-in is required for the public form. A request does not grant access or promise a review deadline.

## Maintainer workflow

1. Triage the request and identify client/source owners. Ask for missing information; unknown compatibility is a reason to investigate, not claim support.
2. Separate signer-only operation access from direct recovery. Direct recovery exposes key material to the receiving client and may expose a whole vault before account selection.
3. Review exact origins, ownership, security and persistence behavior; agree supported formats and platforms. Record approval or the reason an integration cannot proceed.
4. For approved direct web access, the source operator updates its RP’s /.well-known/webauthn origins list, preserving existing approvals. The receiving client separately configures that source. No issue automation changes allowlists or treats submission as approval.
5. Validate real-browser recovery with disposable identities, including cancellation, unavailable storage, same-public-key recovery and persistence boundaries. Native associations and app entitlements are separate checks.
6. Pilot, record compatible released versions and support contacts, then enable. Close the issue only with verification evidence or an explicit declined/deferred outcome and reason. A merged config alone is not success.

Suggested issue checklist:

- [ ] Intake complete and access direction/scope understood
- [ ] Compatibility and security reviewed by source/client owners
- [ ] Exact origins approved where applicable
- [ ] Source and client configuration completed where applicable
- [ ] Real-device/browser tests and recovery checks passed
- [ ] Pilot and supported versions documented
- [ ] Outcome recorded: enabled, declined, or deferred with next action

## Limits

One WebAuthn request targets one RP. A source chooser is not credential discovery and cannot merge RP scopes. Related Origin Requests depend on browser support and source authorization; they do not scale as an assumed unlimited federation. Apple/Android association files do not replace the web endpoint. Removing origin access cannot retract private keys already disclosed.

The interoperability work is under review; a listing or issue is not a claim that a combination works today. For clients that only need signing, prefer a supported signer protocol rather than requiring key import or migration. See [WebAuthn related origins](https://www.w3.org/TR/webauthn-3/#sctn-related-origins).
