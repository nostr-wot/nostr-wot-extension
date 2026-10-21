# Mozilla reviewer notes

Nostr WoT is an MV3 Nostr signer with an optional Lightning wallet. Attached TypeScript/React source rebuilds minified local code; network responses are data, never executable code. Use npm, zip/unzip and Node 24.15+ (24.x), 22.22.2+ (22.x) or 26+: npm ci, then npm run package:firefox. See SOURCE_BUILD.md.

Use a clean profile and disposable identity; no project login is needed. Open the popup: passkey creation or other methods for seed/password, import, watch-only, Nostr Connect and recovery. Connect a Nostr client, review signing/authentication and revoke grants in Permissions. Lock/account changes invalidate approvals.

Passkeys require discoverable credentials, verification and PRF; browser minimums do not guarantee support. Use seed/password if unsupported. Security manages enrollment/recovery. Password/None conversion verifies the credential; None uses empty-password protection.

Recovery tries provider data and compatible relays, with file fallback. Provider blobs/files preserve the encrypted vault; new relay snapshots hold only the selected seed/private key. Publication is explicit. Without confirmed provider storage, acknowledge a downloaded recovery file. Files require an enrolled passkey; restore refuses populated vaults. Refresh snapshots after changes. See docs/passkey-recovery.md.

Archive imports verify signatures; NDJSON exports are unencrypted. Private reveal needs local keys and clears on lock/account changes. Deletion is local. Stored events are encrypted; images may load externally.

Experimental Local network bridge opens a tab for authenticated phone signing over Wi-Fi. Paste a link or scan the phone QR, confirm on the phone and keep the tab open. Bluetooth needs Web Bluetooth, unavailable in Firefox. Temporary public-only accounts require no vault and are removed on tab close. Phone mode refuses local-key fallback and wallet/PQ operations. Sound pairing is unavailable in this release; CSP is not weakened.

Firefox uses background scripts. storage/activeTab/alarms support settings, site controls and scheduling. All-URL scripts expose NIP-07/WebLN. HTTPS hosts cover nostr-wot.com setup and passkeys.nostrwot.com plus legacy passkeys.nostr-wot.com. Optional HTTPS hosts support explicit custom-RP grants, including importing another app's passkey for its chosen host only.

Consent covers wallet credentials/payments, remote and local-phone signing content/site origins, identity queries, recovery metadata and favicon domains. No telemetry. See docs/deployment.md and SECURITY.md. Use no real funds or production keys. PQ/WoT are opt-in; signatures remain classical.
