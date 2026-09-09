# Build instructions — Nostr WoT 0.7.0

Use the attached `nostr-wot-source-0.7.0.zip`, which includes the release's
working source and lockfile. Use that archive to reproduce the packaged release;
do not use an older GitHub tag or assume the latest main matches its contents.

Requirements: Node.js 22 or 24 (release built with 22.23.2), npm, and macOS or
Linux with the `zip` utility installed. Extract the source into an empty folder:

```sh
npm ci
npm run package:firefox
# Or:
npm run package:chrome
```

The outputs are `nostr-wot-firefox.zip` and `nostr-wot-chrome.zip`. Firefox
packaging changes the background to scripts and keeps native data consent
metadata. Chrome packaging removes Firefox-only settings. The Firefox script
restores the normal unpacked `dist/` build after creating its ZIP.

Compare extracted files rather than ZIP checksums, since ZIP entry timestamps
vary. Dependencies are pinned in package-lock.json. Vite bundles TypeScript and
React without minification. Runtime network calls exchange data, not remote
executable code.

See REVIEWER-NOTES.txt in the source archive and docs/deployment.md for the
consent declarations and network destinations.
