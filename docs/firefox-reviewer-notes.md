# Mozilla reviewer notes

Nostr WoT is a Manifest V3 Nostr identity signer and optional Lightning wallet. Matching TypeScript/React source and package-lock.json are attached. Vite minifies local code; network responses are data, not executable code.

Build on Linux or macOS with npm, zip/unzip and Node 24.15+ in 24.x, 22.22.2+ in 22.x, or 26+: run npm ci, then npm run package:firefox. The output is nostr-wot-firefox.zip. SOURCE_BUILD.md has reproduction instructions. The workflow compares all rebuilt files with the submitted archive.

Use a clean Firefox profile and disposable identity. Open the toolbar popup, create an identity and set a vault password. No project login or invitation is needed. Connect a Nostr client using browser-extension sign-in. Review signing/authentication separately and revoke grants in Permissions. HTTP grants bind site, account, exact URL and method. Relay grants cover one site or explicitly all connected sites. Default backend auth starts off; enabling it allows exact same-origin HTTPS or registered NIP-98 pairs for connected sites. Saved denials win. Locking or switching accounts invalidates old approvals.

Account Archive in Settings supports manual/scheduled relay reads, optional relay authentication and confirmed migration to a user-selected relay. This update exports ordinary signed-event NDJSON without a password. Import verifies account ownership and event signatures before merging; legacy encrypted files still require their password. Event bodies remain encrypted in local storage and temporary import staging. Download and import dialogs cover the entire popup. Archive sync never deletes existing events. Migration verifies a bounded Nostr query before publishing original signed events. The popup also falls back to bundled English if preference initialization stalls. Account onboarding does not configure Archive.

Firefox uses background scripts. storage, activeTab and alarms support vault/settings, current-site controls and scheduled work. Content scripts expose NIP-07/WebLN. Host access to nostr-wot.com supports installation setup.

Required consent covers wallet credentials/payments, remote-signer content, public identity/relay queries and site domains sent to Google's favicon service. There is no analytics or telemetry. See docs/deployment.md and SECURITY.md. Local keys remain in the signing flow; NIP-46 has remote custody. Never lock uses an empty-password vault. PQ encryption and Web of Trust are opt-in experiments; event signatures remain classical.

Wallet and remote signing tests need compatible user-selected providers. Use no real funds or production keys. The version changelog is supplied separately.
