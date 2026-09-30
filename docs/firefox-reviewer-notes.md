# Mozilla reviewer notes

Nostr WoT is a Manifest V3 Nostr identity signer and optional Lightning wallet.
The attached source ZIP contains matching TypeScript/React code and package-lock.json.
Vite bundles local code; network responses are data, not downloaded executable code.

Build on Linux or macOS with npm, zip/unzip and Node 24.15+ in 24.x (recommended),
22.22.2+ in 22.x, or 26+: run npm ci, then npm run package:firefox. The output is
nostr-wot-firefox.zip. SOURCE_BUILD.md has complete reproduction instructions.
The release workflow compares every rebuilt file with the submitted package.

Use a clean Firefox profile and disposable identity. Open the toolbar popup,
create an identity and set a vault password. Local onboarding/signing needs no
project login or invitation. Connect a Nostr client using browser-extension sign-in.
Review ordinary signing and authentication separately; revoke grants in Permissions.
HTTP grants bind site, account, exact URL and method. Relay grants cover one site
or explicitly all connected sites. Lock/switch accounts to invalidate old approvals.

The Firefox build uses background scripts. storage, activeTab and alarms support
vault/settings, current-site controls and scheduled work. Content scripts expose
NIP-07/WebLN on websites. Host access to nostr-wot.com supports installation setup.

Required data consent covers wallet credentials/payments, remote-signer content,
public identity/relay queries and site domains sent to Google's favicon service.
There is no analytics or telemetry. See docs/deployment.md and SECURITY.md for
complete disclosures. Local keys stay in the signing flow; NIP-46 has remote custody.
Never lock uses an empty-password vault. PQ encryption and Web of Trust are opt-in
experiments; ordinary event signatures remain classical.

Wallet and remote signing tests need compatible user-selected providers. Use no
real funds or production keys; automated tests use synthetic invoices and fixtures.
The complete version changelog is supplied separately as release notes.
