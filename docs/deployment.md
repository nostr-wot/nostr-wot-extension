# Deployment

Store-by-store notes for shipping a release, and the rejections we have actually
received, with what fixed them. The rejections are the valuable part: each one
cost a disabled version, and none of them were obvious from the code.

Credentials and machine-specific paths are in `DEPLOY.local.md`, which is
gitignored because this repository is public. Everything here is safe to commit.

---

## Before any store

1. Bump `version` in **both** `package.json` and `manifest.json`. They must match.
2. Add the release to `CHANGELOG.md`.
3. `npm run build` — must succeed with no errors.
4. `./tests/run.sh` — the module group may appear to hang after it finishes
   (open handles in the browser mock); that is known and not a failure.
5. Load `dist/` unpacked and click through the popup once. The suite cannot see
   the UI: there is no component test framework, and two visual changes were
   rolled back last month because they shipped unverified.

---

## Firefox (addons.mozilla.org)

### The build environment

AMO rejects builds produced on an end-of-life Node. `0.4.0` was disabled for
being built on Node 20. CI runs the matrix `[22, 24]`; build releases on one of
those.

### Data collection consent — the `0.5.2` rejection

**What happened.** On 2026-09-02 AMO disabled `0.5.2` worldwide after a manual
review, citing *Consent, specifically Nonexistent*, and naming one data
category: `financialAndPaymentInfo`.

**Why.** The manifest declared:

```json
"data_collection_permissions": { "required": ["none"] }
```

`"none"` is a positive claim that the add-on collects and transmits **no** user
data. That was untrue, and had been since the wallet shipped. The extension
transmits, by itself and not merely on a page's behalf:

| What | Where to | Category |
|---|---|---|
| Invoices, amounts, payment hashes, preimages, Lightning Addresses | LNbits REST, LNURL-pay endpoints, NWC relays | `financialAndPaymentInfo` |
| `kind:0` profile metadata — display name, about, picture, nip05, lud16 | the user's write relays | `personallyIdentifyingInfo` |
| `kind:10000` mute list, `kind:10002` relay list | the user's write relays | `personallyIdentifyingInfo` |
| Avatar image files | `blossom.primal.net` | `personallyIdentifyingInfo` |

**The fix**, shipped in `0.6.0`:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "nostr-wot@dandelionlabs.io",
    "strict_min_version": "140.0",
    "data_collection_permissions": {
      "required": ["financialAndPaymentInfo", "personallyIdentifyingInfo"]
    }
  }
}
```

Declaring the categories is what switches on Firefox's **built-in data consent**
— the install-time screen listing them, which the user accepts or declines. That
is one of the two compliant routes; the other is a custom consent screen we would
have to build and maintain ourselves. The built-in one is available on Firefox
desktop **140+** and Android **142+**, which is why `strict_min_version` is
`140.0`. If that minimum is ever lowered, the built-in route stops being
available to the users below it and a custom screen becomes mandatory.

**Getting the category list right matters in both directions.** Under-declaring
is what got the version disabled. Over-declaring makes the install prompt more
alarming than the truth and costs installs. `personallyIdentifyingInfo` was
**not** named in the rejection — it is declared because the table above is what
the code actually does, and being disabled a second time is far more expensive
than a longer prompt. Categories deliberately *not* declared, and why:

- `authenticationInfo` — private keys never leave the device. NIP-98 auth events
  sent to the LNbits provisioning endpoint are signatures over a challenge, not
  credentials the recipient could reuse elsewhere.
- `personalCommunications` — the extension encrypts and decrypts DMs but does
  not transmit them. The page does that, under its own policy.
- `browsingActivity` / `websiteActivity` — the allowlist and the activity log are
  local, and neither is ever sent anywhere.
- `technicalAndInteraction` — no telemetry of any kind. This category may only be
  `optional`, never `required`.

The full category list and syntax:
<https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/>
Policy text:
<https://extensionworkshop.com/documentation/publish/add-on-policies/#data-collection-and-transmission-disclosure-and-control>

**If a category is added later** — a new backend, a new upload target, anything
that leaves the device — update `data_collection_permissions` in the same
changeset. A new required category re-prompts existing users for consent, so it
belongs in a release where that is expected, not slipped into a patch.

### Appeals

A rejection email carries an appeal link valid for six months. Appeal only if the
finding is factually wrong. For `0.5.2` it was not: the manifest said `"none"`
and the wallet was transmitting payment data.

---

## Chrome Web Store

No data-consent manifest key. The equivalent is the **Privacy practices** tab in
the developer dashboard, which must be filled in and kept consistent with the
Firefox declaration above — the same transmissions are disclosed in a different
form. Inconsistency between the two is a review risk in itself.

`host_permissions` are empty and must stay that way. The extension holds
`storage`, `activeTab` and `alarms` only; asking for host access would trigger a
far heavier review and is not needed (see `docs/architecture.md` on why
`tabs.query` returns no URL and how the popup identifies the active site).

---

## Safari (App Store)

The full command sequence, the signing identity, and the App Store Connect API
key are in `CLAUDE.md` and `DEPLOY.local.md`. Two things that are easy to get
wrong and cost a rebuild each:

- **Use `npm run sync:safari`, never a raw `rsync`.** Safari cannot reliably
  start the Chrome-style MV3 `service_worker` background; it reports "background
  content is not loaded" and every popup RPC hangs forever, so the splash never
  dismisses. The sync script rewrites the manifest's background to a persistent
  page. A plain rsync reintroduces the hang.
- **Bump `CURRENT_PROJECT_VERSION` as well as `MARKETING_VERSION`.** Apple
  rejects a duplicate build number even when the marketing version is new.

---

## Store listing text

Release notes for each store live in `CHANGELOG.md` under the version, in a
`### Store release notes` block — short, user-facing, and free of the internal
detail the rest of the entry carries.
