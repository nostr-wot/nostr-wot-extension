# Building Nostr WoT from source (reviewer instructions)

This add-on's uploaded files are produced by a bundler (Vite + `@crxjs/vite-plugin`)
from the TypeScript/React source in this archive. The build is **deterministic** —
building from this source with the pinned dependencies reproduces the exact same
files that are in the uploaded add-on. **The build is not minified.**

## Build environment

- **OS:** macOS or Linux (also works on Windows via WSL).
- **Node.js:** 20.x — the add-on was built with **v20.19.6**.
- **npm:** 10.x or 11.x — built with **11.7.0**.
- No network access is needed beyond the initial `npm ci` (dependency install).

## Steps

```bash
# 1. Install the exact pinned dependencies from package-lock.json
npm ci

# 2. Build the Firefox package
npm run package:firefox
```

This produces:

- `dist/` — the unpacked extension (Firefox manifest form), and
- `nostr-wot-firefox.zip` — a zip of `dist/` (identical contents to the uploaded add-on).

The `package:firefox` script runs `vite build`, rewrites `dist/manifest.json` for
Firefox (`background.scripts` instead of `background.service_worker`), zips `dist/`,
then rebuilds `dist/` back to its default form. Only the zip matters for review.

## Verifying reproducibility

The output filenames under `dist/assets/` are content hashes, so identical source +
identical dependencies produce identical filenames and identical bytes. To confirm,
build twice and compare file contents:

```bash
npm run package:firefox && mkdir a && (cd a && unzip -q ../nostr-wot-firefox.zip)
npm run package:firefox && mkdir b && (cd b && unzip -q ../nostr-wot-firefox.zip)
diff -r a b   # no differences
```

## Notes

- **Not minified:** enforced in `vite.config.ts` (`build.minify: false`) so all
  emitted JavaScript is human-readable and maps directly to the source.
- **Dependencies** are pinned in `package-lock.json`; always use `npm ci` (not
  `npm install`) so the resolved tree matches exactly.
- **No remote code:** the extension bundles only the npm dependencies listed in
  `package.json` (audited `@noble/*` and `@scure/*` crypto libraries, `nostr-tools`,
  `react`, `qrcode-generator`). Nothing is fetched or `eval`'d at runtime.
- **Entry points:** `background.ts` (background service worker / scripts),
  `content.ts` (content script, ISOLATED world), `inject.ts` (page script, MAIN
  world — exposes `window.nostr` / `window.webln`), and `src/**` (the popup UI).
