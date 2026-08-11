# Store submission — 0.4.0

Everything to paste into the two dashboards, plus what the Firefox reviewer needs.

---

## Chrome Web Store

**Dashboard:** https://chrome.google.com/webstore/devconsole
**Upload:** `nostr-wot-chrome.zip`

### What's new (version notes)

```
Post-quantum keys, derived from the seed phrase you already have.

Your Nostr public key is published to every relay you touch, and a quantum computer
running Shor's algorithm recovers a private key from a public one. Every encrypted
message you send today can be archived now and read later. This release fixes the half
of that problem that cannot be fixed after the fact.

• Post-quantum keys from your existing seed. The extension derives an ML-KEM-1024
  encryption key and an ML-DSA-87 signing key (NIST FIPS 203 and FIPS 204) from the
  BIP-39 seed you already have. They are derived alongside your Nostr key, not from it,
  so recovering your Nostr private key does not reach them. Nothing new to back up.

• Publish your keys in one click. A new card on the dashboard signs and publishes the
  attestation that lets others send you post-quantum encrypted messages, reports how
  many of your relays accepted it, and detects one you already published elsewhere.

• Post-quantum direct messages. The post-quantum secret is combined with the existing
  NIP-44 key, so the result is never weaker than today's encryption. Messages cross the
  existing relay network unchanged — no relay or client changes required.

• New identities now use 24 words instead of 12. Twelve words carry only 128 bits of
  entropy, which would make your seed the weakest link rather than the cryptography.
  Existing 12-word identities keep working.

Honest about the limits: this protects the confidentiality of your messages,
permanently, including against someone archiving them today to decrypt later. It does
not stop an attacker with a quantum computer from signing events as you — events are
still signed with secp256k1, and migrating signatures needs relay operators at the
table.

Try it: https://nostr-wot.com/pqc/chat
```

### Privacy / permissions justification (unchanged from 0.3.88)

No new permissions. No new remote hosts. The post-quantum work is local key derivation
plus publishing one event to the relays the user has already configured.

---

## Firefox Add-ons (AMO)

**Dashboard:** https://addons.mozilla.org/developers/
**Upload:** `nostr-wot-firefox.zip`
**Source code:** required (the add-on is bundled) — upload `nostr-wot-source-0.4.0.zip`

### Version notes

Same text as the Chrome "What's new" above.

### Notes to reviewer

```
The add-on is bundled with Vite from TypeScript/React source. It is NOT minified, and
building from source with the pinned dependencies reproduces the uploaded files exactly.

Requirements: Node.js 20.x (built with v20.19.6), npm 10.x or 11.x (built with 11.7.0).
macOS or Linux; Windows via WSL.

Build:
  npm ci
  npm run package:firefox

That produces nostr-wot-firefox.zip in the repo root — the same files as the uploaded
add-on. (The script runs "vite build", rewrites dist/manifest.json for Gecko —
background.scripts instead of background.service_worker — zips dist/, then rebuilds
dist/. Only the zip matters for review.)

Verify:
  mkdir ours theirs
  (cd ours   && unzip -q ../nostr_wot-0.4.0.xpi)      # the uploaded add-on
  (cd theirs && unzip -q ../nostr-wot-firefox.zip)    # your build
  diff -r ours theirs                                 # no differences

Please compare the EXTRACTED files, not the .zip checksums: zip records a modification
timestamp per entry, so two builds made at different times differ as containers while
every file inside is byte-identical. Verified for this release — all 32 files match.

No remote code. Only the npm dependencies in package.json are bundled (@noble/*,
@scure/*, nostr-tools, react, qrcode-generator). Nothing is fetched or eval'd at runtime.

New in 0.4.0: post-quantum cryptography via @noble/post-quantum (ML-KEM-1024 and
ML-DSA-87, NIST FIPS 203/204). All key derivation is local; the only network activity is
publishing a signed event to the relays the user has already configured.
```

---

## Building the artefacts

```bash
npm ci
npm run package:chrome    # → nostr-wot-chrome.zip
npm run package:firefox   # → nostr-wot-firefox.zip
git archive --format=zip --prefix=nostr-wot-extension/ \
  -o nostr-wot-source-0.4.0.zip v0.4.0   # → source package for AMO
```

Tag first (`git tag v0.4.0 && git push origin v0.4.0`) so the source package matches the
tag the reviewer instructions name.

## Checklist

- [ ] `npm run build` clean
- [ ] `./tests/run.sh` — 498 tests passing
- [ ] Version matches in `package.json`, `manifest.json`, `package-lock.json`
- [ ] Reviewer build reproduces the upload (`diff -r` clean, 32 files)
- [ ] Tag pushed, source zip generated from the tag
- [ ] Safari: bump `MARKETING_VERSION` **and** `CURRENT_PROJECT_VERSION` before archiving
      (see CLAUDE.md — Apple rejects a duplicate build number even with a new version)
