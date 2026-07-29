Build instructions — Nostr WoT (Firefox)

The uploaded add-on is bundled with Vite (+ @crxjs/vite-plugin) from TypeScript/React source. It is NOT minified, and building from source with the pinned dependencies reproduces the uploaded files exactly.

Requirements:
- Node.js 20.x (built with v20.19.6)
- npm 10.x or 11.x (built with 11.7.0)
- macOS or Linux (Windows via WSL)

Get the source (any one — all identical):
A) git clone https://github.com/nostr-wot/nostr-wot-extension.git
   cd nostr-wot-extension
   git checkout v0.3.88
B) https://github.com/nostr-wot/nostr-wot-extension/archive/refs/tags/v0.3.88.zip
C) The attached nostr-wot-source-0.3.88.zip (same tree as the tag).

Build:
   npm ci
   npm run package:firefox

Result: nostr-wot-firefox.zip in the repo root — the same files as the uploaded add-on. (dist/ is the unpacked build. The package:firefox script runs "vite build", rewrites dist/manifest.json for Gecko — background.scripts instead of background.service_worker — zips dist/, then rebuilds dist/. Only the zip matters for review.)

Verify against the uploaded add-on:
   mkdir ours theirs
   (cd ours   && unzip -q ../nostr_wot-0.3.88.xpi)     # the uploaded add-on
   (cd theirs && unzip -q ../nostr-wot-firefox.zip)    # your build
   diff -r ours theirs                                 # no differences

Please compare the EXTRACTED files, not the .zip checksums. "zip" records a modification timestamp per entry, so two builds made at different times produce different container bytes while every file inside is byte-identical. The diff above is the meaningful check. (Verified for this release: all 32 files match by sha256.)

Notes:
- Not minified (vite.config.ts: build.minify = false); all emitted JS is readable.
- Dependencies are pinned in package-lock.json; use "npm ci" (not "npm install").
- No remote code: only the npm deps in package.json are bundled (@noble/*, @scure/*, nostr-tools, react, qrcode-generator). Nothing is fetched or eval'd at runtime.
</content>
