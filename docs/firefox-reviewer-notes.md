# Mozilla reviewer notes

Nostr WoT is a Manifest V3 Nostr identity signer and optional Lightning wallet. Matching TypeScript/React source and package-lock.json are attached. Vite bundles local code; network responses are data, not executable code.

Build on Linux or macOS with npm, zip/unzip and Node 24.15+ in 24.x, 22.22.2+ in 22.x, or 26+: run npm ci, then npm run package:firefox. The output is nostr-wot-firefox.zip. SOURCE_BUILD.md has reproduction instructions. The workflow compares all rebuilt files with the submitted archive.

Use a clean Firefox profile and disposable identity. Open the toolbar popup, create an identity and set a vault password. No project login or invitation is needed. Connect a Nostr client using browser-extension sign-in. Review signing/authentication separately and revoke grants in Permissions. HTTP grants bind site, account, exact URL and method. Relay grants cover one site or explicitly all connected sites. Default backend auth starts off; enabling it allows exact same-origin HTTPS or registered NIP-98 pairs for connected sites. Saved denials win. Locking or switching accounts invalidates old approvals.

This version adds narrowly restricted legacy website-login compatibility with a prominent risk warning, one-time consent and developer guidance to adopt NIP-98. It cannot use saved grants or backend automation. It also registers a fixed uninstall URL opening an optional feedback form; no identity, wallet data or tracking parameters are appended. Survey submission is voluntary.

Firefox uses background scripts. storage, activeTab and alarms support vault/settings, current-site controls and scheduled work. Content scripts expose NIP-07/WebLN. Host access to nostr-wot.com supports installation setup.

Required consent covers wallet credentials/payments, remote-signer content, public identity/relay queries and site domains sent to Google's favicon service. There is no analytics or telemetry. See docs/deployment.md and SECURITY.md. Local keys remain in the signing flow; NIP-46 has remote custody. Never lock uses an empty-password vault. PQ encryption and Web of Trust are opt-in experiments; event signatures remain classical.

Wallet and remote signing tests need compatible user-selected providers. Use no real funds or production keys. The version changelog is supplied separately.
