# Build instructions — Nostr WoT 0.8.12

Use the attached `nostr-wot-source-0.8.12.zip`, which includes the release's working source and lockfile. Use that archive to reproduce the packaged release; do not use an older GitHub tag or assume the latest main matches its contents.

Requirements: Node.js 22.22.2+ in the 22.x line, 24.15+ in the 24.x line (recommended; CI uses Node 24), or 26+, npm, and macOS or Linux with the `zip` and `unzip` utilities installed. Extract the source into an empty folder:

```sh
npm ci
npx playwright install chromium
npm run package:firefox
# Or:
npm run package:chrome
```

The outputs are `nostr-wot-firefox.zip` and `nostr-wot-chrome.zip`. Firefox packaging changes the background to scripts and keeps native data consent metadata. Chrome packaging removes Firefox-only settings. Both commands use isolated staging directories and leave `dist/` untouched. The Chrome ZIP must also pass a real Chromium worker/popup/RPC smoke test.

Compare extracted files rather than ZIP checksums, since ZIP entry timestamps vary. Dependencies are pinned in package-lock.json. Keep the included nips/ documentation and .gitignore in place: Tailwind also scans repository text when generating CSS. Vite bundles and minifies TypeScript and React (CSS is left unminified), and esbuild bundles and minifies the background script. The build is deterministic, so the rebuilt files match the packaged ones; read the source in this archive rather than the minified output. Runtime network calls exchange data, not remote executable code.

See docs/deployment.md for the consent declarations and network destinations. See [the security model](docs/security.md) and [testing guide](docs/testing.md) for current protections and verification commands.

Release verification compares the complete file list and bytes of both rebuilt archives, including manifests, HTML, JavaScript, CSS, icons and locales. ZIP timestamps are excluded from the comparison. SHA256SUMS is supplied separately from the source ZIP to avoid a self-referential archive checksum.
