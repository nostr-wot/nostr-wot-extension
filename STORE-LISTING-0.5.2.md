# Store submission — 0.5.2

Everything to paste into the two dashboards, plus what the Firefox reviewer needs.

---

## Chrome Web Store

**Dashboard:** https://chrome.google.com/webstore/devconsole
**Upload:** `nostr-wot-chrome.zip`

### What's new (version notes)

```
Fewer permissions, clearer consent.

• The extension no longer asks for access to each site you connect. Clicking "Connect
  this site" is now the whole thing. That browser dialog granted the extension nothing
  it needed — whether a site may see your identity is decided by the extension itself —
  and it caused problems of its own: it closed the popup and lost your click. Any
  per-site access granted by an earlier version is handed back automatically.

• Disconnecting a site now sticks. It used to leave the site's saved signing rules
  behind, and the extension treated any site with saved rules as still connected — so it
  quietly reconnected itself. A site you had explicitly refused could come back.

• Wallet access is no longer granted silently. A site connected for signing could ask for
  your wallet and be granted it without you being asked. It now asks.

• "Not now" no longer means "never". Declining a site used to block it forever with no
  way back and nothing in the interface to show it. It now lasts as long as you choose,
  there is a Never button when you mean it, and every declined site is listed with an
  undo.

• Post-quantum keys can be imported from the secret keys alone, and the dashboard card
  now tells you whether they are on rather than always inviting you to turn them on.
```

### Privacy / permissions justification (unchanged from 0.4.0)

No new permissions. No new remote hosts. Post-quantum key import is a local file read
plus local validation; the only network activity remains publishing one event to the
relays the user has already configured.

---

## Firefox Add-ons (AMO)

**Dashboard:** https://addons.mozilla.org/developers/
**Upload:** `nostr-wot-firefox.zip`
**Source code:** required (the add-on is bundled) — upload `nostr-wot-source-0.5.2.zip`

### Version notes

Same text as the Chrome "What's new" above.

### Notes to reviewer

```
The add-on is bundled with Vite from TypeScript/React source. It is NOT minified, and
building from source with the pinned dependencies reproduces the uploaded files exactly.

Requirements: Node.js 24.x (built with v24.3.0), npm 11.x (built with 11.4.2). Node 22.x
also works; CI builds and tests on both. macOS or Linux; Windows via WSL.

Note on the previous review of 0.4.0: that version's notes named Node 20.x, which reached
end of life in April 2026. This version is built and tested on supported runtimes only —
Node 20 has been removed from the build matrix as well as from these instructions.

Build:
  npm ci
  npm run package:firefox

That produces nostr-wot-firefox.zip in the repo root — the same files as the uploaded
add-on. (The script runs "vite build", rewrites dist/manifest.json for Gecko —
background.scripts instead of background.service_worker — zips dist/, then rebuilds
dist/. Only the zip matters for review.)

Verify:
  mkdir ours theirs
  (cd ours   && unzip -q ../nostr_wot-0.5.2.xpi)      # the uploaded add-on
  (cd theirs && unzip -q ../nostr-wot-firefox.zip)    # your build
  diff -r ours theirs                                 # no differences

Please compare the EXTRACTED files, not the .zip checksums: zip records a modification
timestamp per entry, so two builds made at different times differ as containers while
every file inside is byte-identical.

No remote code. Only the npm dependencies in package.json are bundled (@noble/*,
@scure/*, nostr-tools, react, qrcode-generator). Nothing is fetched or eval'd at runtime.

New in 0.5.2: importing an externally generated post-quantum key pair. The key file is
read locally through a file input (no host permissions involved), validated locally
against @noble/post-quantum, and stored in the existing encrypted vault. The generator
is scripts/pqc-keygen.mjs in the repository, run offline by the user; the extension
never fetches it.
```

---

## Building the artefacts

```bash
npm ci
npm run package:chrome    # → nostr-wot-chrome.zip
npm run package:firefox   # → nostr-wot-firefox.zip
git archive --format=zip --prefix=nostr-wot-extension/ \
  -o nostr-wot-source-0.5.2.zip v0.5.2   # → source package for AMO
```

Tag first (`git tag v0.5.2 && git push origin v0.5.2`) so the source package matches the
tag the reviewer instructions name.

## Checklist

- [x] `npm run build` clean
- [x] `./tests/run.sh` — 528 tests passing
- [x] Version matches in `package.json`, `manifest.json`, `package-lock.json`
- [x] `nostr-wot-chrome.zip` built from this version
- [ ] Tag pushed, source zip generated from the tag
- [ ] Firefox package + reviewer `diff -r` check (only needed when submitting to AMO)
- [ ] Safari: bump `MARKETING_VERSION` **and** `CURRENT_PROJECT_VERSION` before archiving
      (see CLAUDE.md — Apple rejects a duplicate build number even with a new version)
