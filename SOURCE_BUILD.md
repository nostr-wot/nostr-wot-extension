Build instructions — Nostr WoT (Firefox)

The uploaded files are bundled with Vite (+ @crxjs/vite-plugin) from TypeScript/React source. The build is deterministic and NOT minified: building from source with the pinned dependencies reproduces the uploaded files exactly.

Environment:
- OS: macOS or Linux (Windows via WSL)
- Node.js 20.x (built with v20.19.6)
- npm 10.x or 11.x (built with 11.7.0)

Get the source (any one — all identical):
A) Tagged release:
   git clone https://github.com/nostr-wot/nostr-wot-extension.git
   cd nostr-wot-extension
   git checkout v0.3.88
B) Release archive:
   https://github.com/nostr-wot/nostr-wot-extension/archive/refs/tags/v0.3.88.zip
C) The attached nostr-wot-source-0.3.88.zip (same tree as the tag).

Build:
   npm ci
   npm run package:firefox

Output:
- dist/ = unpacked extension (Firefox manifest form)
- nostr-wot-firefox.zip = zip of dist/, identical to the uploaded add-on

The package:firefox script runs "vite build", rewrites dist/manifest.json for Firefox (background.scripts instead of background.service_worker), zips dist/, then rebuilds dist/. Only the zip matters for review.

Verify reproducibility (optional): build twice and compare —
   npm run package:firefox && mkdir a && (cd a && unzip -q ../nostr-wot-firefox.zip)
   npm run package:firefox && mkdir b && (cd b && unzip -q ../nostr-wot-firefox.zip)
   diff -r a b     # no differences

Notes:
- Not minified (vite.config.ts: build.minify = false); all emitted JS is readable.
- Dependencies are pinned in package-lock.json; use "npm ci" (not "npm install").
- No remote code: only the npm deps in package.json are bundled (@noble/*, @scure/*, nostr-tools, react, qrcode-generator). Nothing is fetched or eval'd at runtime.
