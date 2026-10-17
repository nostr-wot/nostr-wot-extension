# Deployment and browser packages

This is the current packaging and disclosure reference. Use [DEPLOY.md](../DEPLOY.md) for local commands, [Chrome publishing](chrome-publishing.md) and [Mozilla publishing](firefox-publishing.md) for automated store submission. Machine-specific credentials and paths belong in gitignored `DEPLOY.local.md`, never in the repository or source archive.

## Release checks

Use Node 24.15+ in the 24.x line (CI uses Node 24), Node 22.22.2+ in the 22.x line, or Node 26+. The locked jsdom dependency sets these runtime constraints. Install with `npm ci` and the smoke-test browser with `npx playwright install chromium`.

Every release requires León's explicit confirmation for that release before creating a GitHub release, submitting to a store or replacing a review submission. Stable published GitHub releases trigger Chrome and Mozilla submissions; preparing packages does not authorize publishing.

1. Keep package, lockfile, manifest, source-build instructions and release notes consistent.
2. Run `npm run typecheck`, `npm run lint`, `npm run build` and `./tests/run.sh`.
3. Build each browser archive with its own package command; do not rename a Firefox ZIP
   for Chrome or reuse an unverified generic upload filename.
4. Test the intended upload archive in the relevant browser. Record whether checks used
   the installed extension or an isolated fixture. Mounted tests do not replace native
   layout and extension-lifetime checks.
5. Supply matching source, concise release notes and checksums outside the tracked tree.
   Compare extracted files for reproducibility; ZIP timestamps can differ.

Native wallet provisioning/address mutations require the matching LNbits-proxy v2 backend; legacy endpoints fail closed. Verify backend compatibility before publishing clients that use it. See [wallet authentication v2](wallet-auth-v2.md). Building or publishing an extension archive does not deploy that service.

For authentication UI acceptance, check the complete raw-event popup, one-time actions, remembered exact-URL/method choices, relay-only all-sites choices and grant revocation. Keep deployment authorization and live store review state in the release task and store dashboards rather than treating this reference as an authorization to publish.

## Firefox

The manifest uses `nostr-wot-extension@nostr-wot.com`. Keep the ID stable when updating that listing: changing it creates a separate extension whose stored data does not migrate. Desktop requires Firefox 140+ and Android requires 142+, as declared separately in the manifest. These are declared minimums, not a claim of tests on every browser/device.

`npm run package:firefox` retains Firefox metadata and replaces `background.service_worker` with `background.scripts`. It builds in an isolated staging directory and leaves `dist/` untouched. Source-review instructions live in [SOURCE_BUILD.md](../SOURCE_BUILD.md).

Stable GitHub releases submit the verified Firefox archive, matching source archive, [reviewer notes](firefox-reviewer-notes.md), build instructions and version changelog through the [Mozilla workflow](firefox-publishing.md). Drafts do not submit.

### Data transmission and consent

The manifest declares all five required categories below. Firefox's built-in consent handles supported versions; do not declare `none` when these operations transmit data.

| Data | Destination | Category |
|---|---|---|
| Invoices, amounts, payment hashes, preimages, Lightning Addresses | Configured wallet, LNURL endpoints and NWC relays | `financialAndPaymentInfo` |
| Profile, mute/relay lists and public identity/relationship queries | Configured relays and WoT oracle; avatar uploads to the configured image service | `personallyIdentifyingInfo` |
| Wallet API credentials and signed provisioning/address requests | Configured wallet/provisioning service | `authenticationInfo` |
| Content sent for remote signing/encryption; explicitly published encrypted recovery snapshots and their public author/credential metadata | Configured NIP-46 signer through its relay; selected recovery relays | `personalCommunications`, `authenticationInfo`, `personallyIdentifyingInfo` |
| Site domains in icon requests | Google's favicon service | `browsingActivity` |

Locally held identity keys stay within the local signing path; remote signers have their own custody. Wallet credentials must be transmitted to the configured wallet service. Local encryption alone does not send a message, while the remote-signer path sends the content needed by that signer. Encryption in transit does not eliminate those disclosures. The extension does not implement telemetry collection. Archive explorer profile pictures and banners can load from external image hosts even though profile metadata is read from local caches. Recovery-relay queries disclose the recovery author and credential coordinate to those relays; publication exposes public metadata alongside encrypted secret material. Passkey providers may synchronize encrypted provider-attached snapshots.

Update manifest categories and store privacy descriptions whenever a change adds a data flow. New required categories can cause a consent prompt on upgrade. Keep Firefox, Chrome and Safari disclosures consistent with actual code. Reference Mozilla's [built-in consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) and [data transmission policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#data-collection-and-transmission-disclosure-and-control) when preparing a submission.

### Optional uninstall feedback

Supported browsers open the public uninstall feedback page after removal. The registered URL contains no account identifiers, wallet data or tracking parameters. The survey is optional; only submitting the website form sends the entered feedback and optional email address to the project team. Normal website requests still reach the website server.

## Chrome

Stable published GitHub releases trigger the [publishing workflow](chrome-publishing.md). Drafts, tags alone, pushes and prereleases do not submit to the store. Submission is not approval, and store availability must be checked separately. Both store publishers handle older review submissions automatically, skip the same submitted version and refuse to overwrite newer versions. No version-specific workflow edits are required.

`npm run package:chrome` validates the actual ZIP and starts it in disposable Chromium: it requires a service-worker background, no Firefox-only settings, matching version and complete resources. The smoke test opens the popup and exercises its message transport. It does not certify live signing, relays or store acceptance. The manifest declares no Chrome minimum version; test the browser versions targeted by a release.

Before any exceptional manual upload, run:

```sh
npm run verify:chrome -- /absolute/path/to/upload.zip
npm run smoke:chrome -- /absolute/path/to/upload.zip
```

Upload exactly those verified bytes. Packaging invalidates its old generic output before building so a failed invocation cannot leave its stale ZIP masquerading as success.

Required API permissions are `storage`, `activeTab` and `alarms`. Required host permissions are `https://nostr-wot.com/*` for the project-site bridge/tab discovery, `https://passkeys.nostrwot.com/*` for new passkeys and `https://passkeys.nostr-wot.com/*` for existing credentials. Optional host permissions declare `https://*/*`; advanced passkey setup requests only the selected HTTPS RP origin after an explicit user action. Connecting an ordinary website does not request an optional host grant. These permissions are separate from `<all_urls>` content-script matching. See [architecture](architecture.md#3-manifest-and-permissions).

## Passkeys, recovery and archive acceptance

Passkey support requires WebAuthn from the extension origin with the selected RP, discoverable credentials, required user verification and a 32-byte PRF result from the chosen provider. The presence of `PublicKeyCredential` alone does not establish compatibility. The manifest's browser minimums do not guarantee passkey or PRF support, and provider `largeBlob` support is separate. Verify the actual browser, OS and provider combination before claiming support; retain password/seed setup for unsupported combinations. No hosted authentication bridge or website script participates in local unlocking.

New credentials use `passkeys.nostrwot.com`; existing `passkeys.nostr-wot.com` credentials keep their original RP. Custom RP setup requires an explicit origin grant and browser support. Create with passkey opens the provider prompt directly. Advanced setup first offers existing-credential selection and confirms recovery before decrypting or querying relays. Cancellation does not create a replacement account. Restore tries the selected credential's encrypted provider data, then compatible relay recovery, then offers a recovery file. Restoration refuses to replace a populated vault.

Provider recovery stores an encrypted full-vault snapshot only when supported and a write is explicitly confirmed. New relay snapshots export the selected account's seed or private key, never sibling account listings or an entire vault; legacy typed vault recovery remains readable. Relay publication requires an explicit save and reports acceptance separately from later availability checks. Without confirmed provider storage, setup requires downloading and acknowledging an encrypted recovery file even after successful relay publication. Files still require a compatible enrolled passkey. Provider confirmation does not prove cross-device synchronization, and relay acceptance does not guarantee retention or freshness. Refresh snapshots after changes; local deletion cannot erase old copies. See [Passkey recovery](passkey-recovery.md) for scope, privacy and compatibility details.

Verify first-passkey enrollment on an existing vault, adding another credential, naming/selecting credentials, and recovery setup for each new credential. Onboarding defaults to 15-minute auto-lock with passkey unlock. Choosing password or None verifies the current passkey before changing local protection; None requires explicit confirmation and uses empty-password protection. Changing local protection preserves dormant passkey enrollment and does not erase previous recovery snapshots. Ordinary unlock does not query recovery relays. Custom recovery relays are local preferences; a fresh installation starts discovery with the default relays.

Archive explorer opens in a separate extension tab, searches bounded encrypted-record batches and decrypts supported messages only on request with locally available keys. Verify account switching and locking clear the view, per-page decryption, explicit local deletion and original-event details. Local deletion does not publish a relay deletion. Remote-signer and watch-only archives cannot decrypt locally. Exported NDJSON is unencrypted; imported events must pass ownership and signature checks. App-data and ephemeral authentication events are excluded from new archive writes/imports. Archive snapshots are separate from identity recovery.

## Safari

The existing Xcode wrapper lives in `safari-xcode/`; do not regenerate it. Follow the repository's `AGENTS.md` and local operational notes for signing and upload.

- Run `npm run build`, then `npm run sync:safari`. The sync script copies `dist/` and
converts the background to a persistent page; raw copying misses that conversion.
- Keep `MARKETING_VERSION` and the extension version aligned, and increment
`CURRENT_PROJECT_VERSION` for each new App Store upload.
- Verify the signed wrapper and actual App Store Connect submission separately.
A GitHub release does not submit or approve the Safari app.
