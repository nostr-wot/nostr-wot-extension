# Deployment and browser packages

This is the current packaging and disclosure reference. Use [DEPLOY.md](../DEPLOY.md)
for local commands, [Chrome publishing](chrome-publishing.md) and
[Mozilla publishing](firefox-publishing.md) for automated store submission. Machine-specific credentials and paths belong in gitignored
`DEPLOY.local.md`, never in the repository or source archive.

## Release checks

Use Node 24.15+ in the 24.x line (CI uses Node 24), Node 22.22.2+ in the 22.x
line, or Node 26+. The locked jsdom dependency sets these runtime constraints.
Install with `npm ci` and the smoke-test browser with `npx playwright install chromium`.

1. Keep package, lockfile, manifest, source-build instructions and release notes consistent.
2. Run `npm run typecheck`, `npm run lint`, `npm run build` and `./tests/run.sh`.
3. Build each browser archive with its own package command; do not rename a Firefox ZIP
   for Chrome or reuse an unverified generic upload filename.
4. Test the intended upload archive in the relevant browser. Record whether checks used
   the installed extension or an isolated fixture. Mounted tests do not replace native
   layout and extension-lifetime checks.
5. Supply matching source, concise release notes and checksums outside the tracked tree.
   Compare extracted files for reproducibility; ZIP timestamps can differ.

Native wallet provisioning/address mutations require the matching LNbits-proxy v2 backend;
legacy endpoints fail closed. Verify backend compatibility before publishing clients that
use it. See [wallet authentication v2](wallet-auth-v2.md). Building or publishing an
extension archive does not deploy that service.

For authentication UI acceptance, check the complete raw-event popup, one-time actions,
remembered exact-URL/method choices, relay-only all-sites choices and grant revocation.
Keep deployment authorization and live store review state in the release task and store
dashboards rather than treating this reference as an authorization to publish.

## Firefox

The manifest uses `nostr-wot-extension@nostr-wot.com`. Keep the ID stable when updating
that listing: changing it creates a separate extension whose stored data does not migrate.
Desktop requires Firefox 140+ and Android requires 142+, as declared separately in the
manifest. These are declared minimums, not a claim of tests on every browser/device.

`npm run package:firefox` retains Firefox metadata and replaces `background.service_worker`
with `background.scripts`. It builds in an isolated staging directory and leaves `dist/`
untouched. Source-review instructions live in [SOURCE_BUILD.md](../SOURCE_BUILD.md).

Stable GitHub releases submit the verified Firefox archive, matching source archive,
[reviewer notes](firefox-reviewer-notes.md), build instructions and version changelog
through the [Mozilla workflow](firefox-publishing.md). Drafts do not submit.

### Data transmission and consent

The manifest declares all five required categories below. Firefox's built-in consent
handles supported versions; do not declare `none` when these operations transmit data.

| Data | Destination | Category |
|---|---|---|
| Invoices, amounts, payment hashes, preimages, Lightning Addresses | Configured wallet, LNURL endpoints and NWC relays | `financialAndPaymentInfo` |
| Profile, mute/relay lists and public identity/relationship queries | Configured relays and WoT oracle; avatar uploads to the configured image service | `personallyIdentifyingInfo` |
| Wallet API credentials and signed provisioning/address requests | Configured wallet/provisioning service | `authenticationInfo` |
| Content sent for remote signing/encryption | Configured NIP-46 signer through its relay | `personalCommunications` |
| Site domains in icon requests | Google's favicon service | `browsingActivity` |

Locally held identity keys stay within the local signing path; remote signers have their
own custody. Wallet credentials must be transmitted to the configured wallet service.
Local encryption alone does not send a message, while the remote-signer path sends the
content needed by that signer. Encryption in transit does not eliminate those disclosures.
The extension does not implement telemetry collection.

Update manifest categories and store privacy descriptions whenever a change adds a data
flow. New required categories can cause a consent prompt on upgrade. Keep Firefox,
Chrome and Safari disclosures consistent with actual code. Reference Mozilla's
[built-in consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
and [data transmission policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#data-collection-and-transmission-disclosure-and-control)
when preparing a submission.

### Optional uninstall feedback

Supported browsers open the public uninstall feedback page after removal. The registered URL contains no account identifiers, wallet data or tracking parameters. The survey is optional; only submitting the website form sends the entered feedback and optional email address to the project team. Normal website requests still reach the website server.

## Chrome

Stable published GitHub releases trigger the [publishing workflow](chrome-publishing.md).
Drafts, tags alone, pushes and prereleases do not submit to the store. Submission is not
approval, and store availability must be checked separately. Both store publishers
handle older review submissions automatically, skip the same submitted version and
refuse to overwrite newer versions. No version-specific workflow edits are required.

`npm run package:chrome` validates the actual ZIP and starts it in disposable Chromium:
it requires a service-worker background, no Firefox-only settings, matching version and
complete resources. The smoke test opens the popup and exercises its message transport.
It does not certify live signing, relays or store acceptance. The manifest declares no
Chrome minimum version; test the browser versions targeted by a release.

Before any exceptional manual upload, run:

```sh
npm run verify:chrome -- /absolute/path/to/upload.zip
npm run smoke:chrome -- /absolute/path/to/upload.zip
```

Upload exactly those verified bytes. Packaging invalidates its old generic output before
building so a failed invocation cannot leave its stale ZIP masquerading as success.

Required API permissions are `storage`, `activeTab` and `alarms`. Host access is limited
to `https://nostr-wot.com/*`, used by the project-site bridge/tab discovery; this is
separate from `<all_urls>` content-script matching. No optional host grant is requested
when connecting a website. See [architecture](architecture.md#3-manifest-and-permissions).

## Safari

The existing Xcode wrapper lives in `safari-xcode/`; do not regenerate it. Follow the
repository's `AGENTS.md` and local operational notes for signing and upload.

- Run `npm run build`, then `npm run sync:safari`. The sync script copies `dist/` and
  converts the background to a persistent page; raw copying misses that conversion.
- Keep `MARKETING_VERSION` and the extension version aligned, and increment
  `CURRENT_PROJECT_VERSION` for each new App Store upload.
- Verify the signed wrapper and actual App Store Connect submission separately.
  A GitHub release does not submit or approve the Safari app.
