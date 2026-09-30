# Deployment Guide

Browser-specific packages target Chrome and Firefox. The separate Safari wrapper
is described in [the deployment reference](docs/deployment.md#safari).

## Building

Use Node 24.15+ in 24.x (recommended; CI uses Node 24), 22.22.2+ in 22.x,
or 26+. Install the locked dependencies with `npm ci`.

```bash
npm run build        # Build to dist/
npm run typecheck    # Verify TypeScript (no emit)
npm run test         # Run full test suite
```

## Packaging for Stores

Install the smoke-test browser with `npx playwright install chromium`. Each command builds in an isolated staging directory and validates the resulting ZIP:

```bash
npm run package:chrome    # → nostr-wot-chrome.zip
npm run package:firefox   # → nostr-wot-firefox.zip
```

### What each script does

| Step | Chrome | Firefox |
|------|--------|---------|
| Build | `vite build` | `vite build` |
| Manifest patch | Strips `browser_specific_settings` | Adds `background.scripts` |
| Zip | Isolated build excluding `.vite/`; manifest validation and Chromium smoke test | Isolated build excluding `.vite/`; manifest validation |

### Chrome-specific manifest

- `browser_specific_settings` is removed (Firefox-only key, Chrome logs a console warning if present)
- Uses `background.service_worker` for the background script

### Firefox-specific manifest

- `browser_specific_settings.gecko` is kept (required for AMO: extension id, min version)
- `background.scripts` replaces `service_worker` in the Firefox ZIP.

## Chrome Web Store

Stable GitHub releases trigger the verified upload workflow. Follow
[Chrome publishing](docs/chrome-publishing.md) for credentials, release gates and recovery.
Drafts, tags and builds do not submit; Google review remains separate from submission.
Use manual dashboard upload only as an explicit recovery path, with the exact archive
verified by `verify:chrome` and `smoke:chrome` immediately before upload.

## Firefox Add-ons (AMO)

Stable GitHub releases trigger the Mozilla upload workflow with the verified Firefox
ZIP, matching source, reviewer instructions and version changelog. Follow
[Mozilla publishing](docs/firefox-publishing.md) for credentials, checks and recovery.
The workflow verifies reproducibility before using store credentials and skips an
already completed matching submission. Mozilla review controls public availability.

### Firefox-specific notes

- The `browser_specific_settings.gecko.id` in manifest.json must be unique
- Minimum Firefox versions: desktop 140 and Android 142, enforcing built-in data consent.
- Required data categories cover identity, payments, authentication, personal communications and browsing domains. See `docs/deployment.md` for the audited destinations; do not declare `none`.
- Firefox will review source code manually

## Local Testing

### Chrome

1. `npm run build`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` folder

### Firefox

1. `npm run package:firefox`, then extract `nostr-wot-firefox.zip` into a separate review folder.
2. Go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select the extracted Firefox package's `manifest.json`

Or use web-ext CLI:
```bash
npm install -g web-ext
web-ext run -s /path/to/extracted-firefox-package
```

## Version Bumping

Before each release, keep all version records aligned:

- `manifest.json` → `"version": "x.y.z"`
- `package.json` and the package-lock root version → `"version": "x.y.z"`
- `SOURCE_BUILD.md`, `CHANGELOG.md` and the Safari project version/build numbers

Both stores require version numbers to increase with each submission.

## Publishing handoff files

Keep versioned release/reviewer notes and checksums outside the repository as
temporary publishing artifacts. Share their download links with the release
handoff; keep CHANGELOG.md and SOURCE_BUILD.md as the durable in-repo records.
Do not commit generated ZIPs or per-release text files to the repository root.
