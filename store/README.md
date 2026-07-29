# Store Listings — Nostr WoT

Copy-paste-ready metadata for the Chrome Web Store, Firefox Add-ons (AMO), and the
Mac App Store (Safari). Keep this in sync with `manifest.json` and `CHANGELOG.md`
on each release.

- **Current version:** 0.3.88
- **Extension name:** Nostr WoT
- **Category:** Productivity / Tools
- **Homepage / support:** https://nostr-wot.com
- **Source:** https://github.com/nostr-wot/nostr-wot-extension
- **License:** MIT
- **Developer:** Dandelion Labs
- **Privacy policy:** https://nostr-wot.com/privacy

---

## One-liner (≤ 132 chars — Chrome summary / AMO summary)

> Your Nostr identity, NIP-07 signer, and built-in Lightning wallet — keys encrypted on your device, never on a server.

## Short subtitle (Mac App Store, ≤ 30 chars)

> Nostr signer & Lightning wallet

---

## Full description (all stores)

Nostr WoT is a self-custodial identity provider for the Nostr network. It keeps your
keys encrypted on your own device and signs events only when you approve them — so any
Nostr web app can log you in and request signatures without ever seeing your private key.

**What you can do**

- **Sign in to Nostr apps (NIP-07).** Exposes the standard `window.nostr` API, so
  clients like Primal, Coracle, and Snort can request your public key and signatures.
- **Approve every signature.** A clear prompt shows exactly what you're about to sign —
  the full event content and all its tags — with per-site, per-event-kind permissions
  you control.
- **Built-in Lightning wallet (WebLN).** Send and receive zaps directly. Connect an
  existing wallet over Nostr Wallet Connect (NWC) or provision one in a tap. A per-site
  spending threshold keeps small zaps friction-free while larger payments always ask.
- **Multiple identities.** Switch between accounts instantly — each with its own
  permissions, wallet, profile, relays, and mute list.
- **Manage your account data.** Edit your profile (kind 0), your relay list (NIP-65),
  and your mute list (NIP-51) from the popup.
- **Remote signing (NIP-46).** Pair a bunker with a scan.

**Your keys stay yours**

- Private keys are encrypted with AES-256-GCM behind a password (PBKDF2, 210k
  iterations) and never leave your device.
- No accounts, no tracking, no analytics, no third-party servers. The only network
  traffic is to the Nostr relays and Lightning wallet **you** choose.
- Open source (MIT).

---

## Single purpose (Chrome Web Store requirement)

> Nostr WoT is a Nostr signer and Lightning wallet: it stores the user's Nostr keys
> encrypted on-device and exposes the standard NIP-07 (`window.nostr`) and WebLN
> (`window.webln`) APIs so websites can request signatures and Lightning payments,
> each gated behind an explicit user approval.

---

## Permission justifications

| Permission | Why it's needed |
|-----------|-----------------|
| `storage` | Store the encrypted key vault, per-site permissions, settings, and the connected-site allowlist locally. |
| `activeTab` | Read the current tab's URL to show which site is asking, and open the approval popup only for the tab you're actually on. |
| `alarms` | On Manifest V3, keep the background service worker alive while the vault is unlocked so the configured auto-lock timer actually governs locking. |
| `optional_host_permissions: <all_urls>` | **Optional, requested at runtime** only when you connect a site — never granted up front. Lets the extension interact with the specific sites you approve. |
| Content scripts on `<all_urls>` | Injects the standard `window.nostr` (NIP-07) and `window.webln` (WebLN) providers so Nostr web apps can detect the signer and request approval. No page data is read or sent anywhere; the scripts only relay approved requests to the background. |

The extension does **not** request `scripting`, `tabs`, `history`, `cookies`, `webRequest`,
or any host permission up front.

---

## Data collection / privacy (AMO + App Store nutrition labels)

- **Data collected:** None.
- **Firefox `data_collection_permissions`:** `required: ["none"]` (declared in the manifest).
- **Mac App Store privacy label:** "Data Not Collected."
- Keys and settings are stored locally and encrypted. The extension contacts only the
  user-selected Nostr relays and the user's own Lightning wallet backend. No telemetry,
  no ads, no analytics SDKs, no remote code.

---

## Chrome Web Store

- **Listing:** https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo
- **Package:** `nostr-wot-chrome.zip` (repo root — `npm run package:chrome`)
- **Category:** Productivity
- **Notes:** `browser_specific_settings` is stripped from the Chrome build. Under
  "Privacy practices," declare a use for each permission (table above) and select
  "does not collect user data." Build is unminified for reviewer readability.

## Firefox Add-ons (AMO)

- **Listing:** https://addons.mozilla.org/addon/nostr-wot-extension
- **Package:** `nostr-wot-firefox.zip` (repo root — `npm run package:firefox`)
- **Gecko id:** `nostr-wot@dandelionlabs.io` · **min version:** Firefox 140
- **Categories:** Privacy & Security, Other
- **Data collection:** "No" — the manifest declares `data_collection_permissions:
  { required: ["none"] }`.
- **Notes:** Firefox build uses `background.scripts` (not `service_worker`). Source-code
  submission may be requested; the repo builds with `npm run build` (Vite, unminified).

## Mac App Store (Safari)

- **App name:** Nostr WoT · **Bundle ID:** `com.nostr-wot.extension` (extension:
  `com.nostr-wot.extension.Extension`)
- **Team:** Dandelion Labs (`R3M572YZ8S`)
- **Package:** `safari-build/Export/Nostr WoT.pkg` (archived from `safari-xcode/`,
  uploaded via App Store Connect API).
- **Category:** Productivity
- **Keywords:** nostr, lightning, wallet, signer, nip-07, webln, zaps, identity, bitcoin, key
- **Promotional text:** Self-custodial Nostr identity and Lightning wallet — sign in to
  Nostr apps and zap, with your keys encrypted on your Mac.
- **Privacy:** Data Not Collected.
- **Review notes:** The extension exposes the standard NIP-07 / WebLN JavaScript APIs;
  every signing and payment request is gated behind an explicit in-app approval. Keys are
  encrypted locally. To exercise it, enable the extension in Safari → Settings →
  Extensions, open a Nostr web client (e.g. primal.net), and approve the connection.

---

## Screenshots checklist (per store)

1. Home — wallet balance, site identity access, and the **Account** card.
2. A signing approval prompt (showing event kind, content, and tags).
3. A Lightning payment (WebLN) approval with the amount.
4. Multi-account switcher.
5. Per-site permissions screen.

Chrome: 1280×800 or 640×400. AMO: up to 2400×1800. App Store: 1280×800 / 1440×900
(Mac). Use a light background to match the extension's theme.
