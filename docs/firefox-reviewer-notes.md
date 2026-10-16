# Mozilla reviewer notes

Nostr WoT is an MV3 Nostr signer with an optional Lightning wallet. Attached TypeScript/React source rebuilds minified local code; network responses are data, never executable code. On Linux/macOS use npm, zip/unzip and Node 24.15+ (24.x), 22.22.2+ (22.x) or 26+: npm ci, then npm run package:firefox. See SOURCE_BUILD.md.

Use a clean profile and disposable identity; no project login is needed. Open the popup: Create with passkey or Try other methods for seed/password, import, watch-only, Nostr Connect and recovery. Connect a Nostr client, review signing/authentication and revoke grants in Permissions. Grants bind account/site and destination; lock/account switches invalidate approvals.

Passkeys need extension-origin RP support, discoverable credentials, user verification and PRF; Firefox minimum versions do not guarantee support. Use seed/password setup if unsupported. No hosted unlock bridge is used. Security manages enrollment/recovery. Password/None conversion verifies the credential. None uses empty-password protection.

Recovery tries provider data and compatible relays, with file fallback. Provider blobs/files preserve the full encrypted vault, including imported nsec/PQC keys. New relay snapshots contain only the selected seed/private key. Publication is explicit. Without confirmed provider storage, download and acknowledge a recovery file even after relay acceptance. Files require an enrolled passkey. Restore refuses populated vaults. Snapshots need refreshing; sync/retention are not guaranteed. See docs/passkey-recovery.md.

Settings Archive supports relay sync/migration and signature-checked imports. NDJSON exports are unencrypted. Explorer opens a tab; private-message reveal needs local keys and clears on lock/account selection. Deletion is local only. Stored event bodies are encrypted. Profile metadata is cached, but images may load externally.

Firefox uses background scripts. storage, activeTab and alarms support settings, current-site controls and scheduled work. All-URL scripts expose NIP-07/WebLN. Required HTTPS hosts: nostr-wot.com for setup; passkeys.nostrwot.com and legacy passkeys.nostr-wot.com for RPs. Optional https://*/* enables explicit custom-RP grants, not ordinary site connections.

Consent covers wallet credentials/payments, remote-signer content, public identity queries, recovery ciphertext/author/credential metadata and Google favicon domain requests. Providers may sync encrypted blobs. No telemetry. See docs/deployment.md and SECURITY.md. Wallet/NIP-46 tests need compatible providers; use no real funds or production keys. PQ/WoT are opt-in; signatures remain classical.
