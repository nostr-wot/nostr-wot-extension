# Store submission — 0.5.0

Everything to paste into the two dashboards, plus what the Firefox reviewer needs.

---

## Chrome Web Store

**Dashboard:** https://chrome.google.com/webstore/devconsole
**Upload:** `nostr-wot-chrome.zip`

### What's new (version notes)

```
Post-quantum keys for the accounts that could not have them, and a hardening pass on
how your seed phrase is made and stored.

• Bring your own post-quantum key. Until now, only an account with a 24-word seed could
  have post-quantum keys, because they are derived from that seed. An account imported
  from an nsec, or one on a 12-word phrase, was simply told it could not. Those accounts
  can now generate a standalone key pair offline and import it, then publish and use it
  exactly like a derived one.

• The key file is checked, not trusted. Importing verifies that each public key really
  belongs to the secret key beside it, by encrypting and decrypting a test value and by
  signing and verifying one. A mismatched pair would otherwise import cleanly, advertise
  itself to senders, and then silently fail to read a single message.

• The popup no longer opens by itself. If your vault is set to never lock, a signing
  request that arrived while the extension was waking up looked like a locked vault, so
  the popup opened asking for an unlock you never had to perform — on requests you had
  already approved. It now waits for the wake-up to finish.

• Your seed phrase is no longer written unprotected during setup. Part of it was already
  protected in browser session storage; the seed phrase itself was not, and on Safari
  that storage is on disk. It is now protected the same way, and an abandoned setup is
  cleared away rather than left behind.

• Stronger vault password protection. The key stretching applied to your vault password
  used the recommended figure for a different hash function than the one in use — the
  wrong row of the right table. It is now roughly three times stronger. Existing vaults
  upgrade themselves the next time you unlock; nothing to do.

Imported post-quantum keys are the one thing your seed phrase cannot restore, so the
extension says so plainly and keeps saying it. Back up the key file separately.
```

### Privacy / permissions justification (unchanged from 0.4.0)

No new permissions. No new remote hosts. Post-quantum key import is a local file read
plus local validation; the only network activity remains publishing one event to the
relays the user has already configured.

---

## Firefox Add-ons (AMO)

**Dashboard:** https://addons.mozilla.org/developers/
**Upload:** `nostr-wot-firefox.zip`
**Source code:** required (the add-on is bundled) — upload `nostr-wot-source-0.5.0.zip`

### Version notes

Same text as the Chrome "What's new" above.

### Notes to reviewer

```
The add-on is bundled with Vite from TypeScript/React source. It is NOT minified, and
building from source with the pinned dependencies reproduces the uploaded files exactly.

Requirements: Node.js 20.x (built with v20.19.6), npm 10.x or 11.x. macOS or Linux;
Windows via WSL.

Build:
  npm ci
  npm run package:firefox

That produces nostr-wot-firefox.zip in the repo root — the same files as the uploaded
add-on. (The script runs "vite build", rewrites dist/manifest.json for Gecko —
background.scripts instead of background.service_worker — zips dist/, then rebuilds
dist/. Only the zip matters for review.)

Verify:
  mkdir ours theirs
  (cd ours   && unzip -q ../nostr_wot-0.5.0.xpi)      # the uploaded add-on
  (cd theirs && unzip -q ../nostr-wot-firefox.zip)    # your build
  diff -r ours theirs                                 # no differences

Please compare the EXTRACTED files, not the .zip checksums: zip records a modification
timestamp per entry, so two builds made at different times differ as containers while
every file inside is byte-identical.

No remote code. Only the npm dependencies in package.json are bundled (@noble/*,
@scure/*, nostr-tools, react, qrcode-generator). Nothing is fetched or eval'd at runtime.

New in 0.5.0: importing an externally generated post-quantum key pair. The key file is
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
  -o nostr-wot-source-0.5.0.zip v0.5.0   # → source package for AMO
```

Tag first (`git tag v0.5.0 && git push origin v0.5.0`) so the source package matches the
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
