# Mozilla reviewer notes

Nostr WoT is a Manifest V3 identity signer and optional Lightning wallet for Nostr
web applications. The attached source ZIP contains the matching TypeScript/React
source and committed npm lockfile. SOURCE_BUILD.md supplies the exact build commands.
The release workflow verifies that the source matches the release commit and that
its Firefox build reproduces every file in the submitted ZIP. Vite bundles local
code; runtime network responses are data, not downloaded executable code.

## Review setup

Use a disposable account in a clean Firefox profile. Open the extension toolbar
popup, create an identity and set a vault password. No project login or invitation
is required for local account creation and signing. Remote signing, relay queries
and wallet features depend on the user's selected third-party services. Do not use
real funds or production keys for review; automated wallet tests use synthetic
invoices and local fixtures.

Connect a compatible Nostr client through its browser-extension sign-in option.
Review its ordinary signing permissions and authentication requests separately.
HTTP authentication approvals bind the requesting site, account, exact URL and
method; relay permissions can cover one site or explicitly all connected sites.
Manage and revoke these grants under Permissions. Lock the vault or switch accounts
to check that obsolete approvals and previews are rejected.

## Permissions and data flows

The Firefox package uses background scripts, not Chrome's service worker manifest.
`storage`, `activeTab` and `alarms` support the vault/settings, current-site controls
and scheduled work. Content scripts expose NIP-07/WebLN APIs on websites; host
access to `https://nostr-wot.com/*` supports the project-site installation flow.

Firefox's required data-consent categories cover authentication information,
financial/payment information, personal communications, identifying information
and browsing activity. These describe feature-related transmission, including
wallet credentials, remote-signer content, public profile/relay queries and site
domains sent to Google's favicon service. The extension implements no analytics
or telemetry. See docs/deployment.md and SECURITY.md in the source archive for
complete destinations, key custody and security limits.

Password-protected local keys remain in the extension's signing flow. NIP-46 uses
a remote signer with its own key custody. Never lock uses an empty-password vault.
Post-quantum encryption is experimental and opt-in; ordinary Nostr event signatures
remain classical. Web of Trust is separately opt-in.

The version-specific changelog and source/package checksums are appended
by the publishing workflow. This note contains no credentials or test accounts.
