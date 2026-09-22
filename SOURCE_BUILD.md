# Build instructions — Nostr WoT 0.8.2

Use the attached `nostr-wot-source-0.8.2.zip`, which includes the release's
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
vary. Dependencies are pinned in package-lock.json. Keep the included nips/ documentation
and .gitignore in place: Tailwind also scans repository text when generating CSS. Vite bundles TypeScript and
React without minification. Runtime network calls exchange data, not remote
executable code.

See docs/deployment.md for the consent declarations and network destinations.
See docs/audits/2026-09-10/README.md for the security audit and remediation scope.

Release verification compares the complete file list and bytes of both rebuilt
archives, including manifests, HTML, JavaScript, CSS, icons and locales. ZIP
timestamps are excluded from the comparison. SHA256SUMS is supplied separately
from the source ZIP to avoid a self-referential archive checksum.
