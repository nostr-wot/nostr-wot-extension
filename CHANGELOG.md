# Changelog

Notable changes per release. Store-facing copy for each version is in its
`### Store release notes` block; the rest is for us.

See `docs/deployment.md` for the store submission process and the rejections we
have had.

## 0.6.0

Pay to a Lightning Address, and a long list of fixes to things that only went
wrong sometimes — which is why they lasted. Three audits went over the frontend
and the wallet; most of what follows was found by the second and third.

### Added

- **Pay to a Lightning Address** from the Send box, alongside BOLT11 invoices
  (LUD-16 → LUD-06). The address is resolved in the background, the amount the
  user approves is checked against the invoice that comes back, and the endpoint
  that was shown is the endpoint that gets paid. Thanks to **@Fabricio333**
  ([#21](https://github.com/nostr-wot/nostr-wot-extension/pull/21)).
- Firefox's built-in data collection consent, declaring what the extension
  actually transmits. See below.

### Fixed — money

- **The Send box could pay the previous recipient.** Editing one resolved
  address into another left the old resolution live for the 400ms debounce while
  the Pay button gated on the text on screen, so both guards passed — for
  different addresses. The decision now lives in one tested place.
- **A retried payment could be sent twice.** `rpc()` retries when the message
  port closes without a reply, and paying a Lightning Address asks the endpoint
  for a *fresh invoice* each time — a second payment hash the node cannot
  recognise as a duplicate. Payments are now at most once per click.
- A typed amount and comment carried over to the *next* recipient, payable at a
  figure chosen for someone else, with a note meant for someone else attached.
- Releasing a Lightning Address now asks first. It is irreversible, and anywhere
  the address was already published, zaps start reaching whoever claims it next.
- Three holes in the LNURL guard: redirects were followed (defeating the check
  entirely), the 64 KB response cap was applied *after* the body had been
  buffered, and there was no request timeout. Also fixed a hostname test that
  rejected real domains — `fdn.fr`, `fc2.com`, `fdroid.org`.

### Fixed — data loss

- **Adding a Lightning Address to your profile could erase the rest of it.**
  `kind:0` is replaceable, and a profile read that reached no relay was
  indistinguishable from "this user has no profile", so the merge published a
  document containing only the address. Name, picture, about and nip05 gone.
- **Editing your mute list could erase your private mutes.** The same shape: a
  read no relay answered resolved as an empty list, and publishing it replaced
  the real one — including the NIP-44 encrypted entries that survive only by
  being round-tripped.
- **The onboarding wizard could overwrite an existing vault.** Creating a vault
  replaces it outright, and the wizard's check for an existing one turned any
  failure — a cold worker, or an active lockout — into "there is no vault". It
  now refuses.

### Fixed — the popup "failing sometimes"

- **The wallet vanished from the menu after the extension had been idle.** On a
  "Never lock" vault the background re-unlocks on every service-worker cold
  start, and the popup asked whether the vault was locked without waiting for
  that to finish — then never heard the correction. Every locked-gated action
  stayed hidden for the life of that popup.
- The popup now notices when the vault locks *or* unlocks underneath it. An
  auto-lock with the popup open used to leave it rendering unlocked UI, and an
  incoming request got no unlock prompt at all — it just timed out.
- The approval sheet could show requests that had already been resolved, and act
  as though it had signed them. Its refresh had no protection against overlapping
  runs, and the one background path that empties the queue never announced it.
- None of the approval actions had error handling. A failure left the queue
  half-resolved with nothing said, on the surface whose whole job is releasing
  the signing key.
- The popup re-did its own work on every open — a runaway refresh loop, and a
  home view that reloaded whenever any profile resolved.
- Connect, "Not now"/"Never", and the identity toggle all failed silently. The
  toggle was the worst: it displayed a privacy setting that had never been saved.
- The globe and the home card no longer contradict each other, and "Never" can
  no longer permanently dismiss a site you just connected.
- A failed read is no longer reported as a definite answer. The wallet setup
  flow could render over a working wallet; "set up post-quantum keys" could be
  shown to someone whose attestation was live; activity showed "No activity yet"
  for a log it had failed to load.
- The unlock screen shows that it is working. Deriving the key takes seconds and
  nothing on screen changed, so the most-used gate in the product read as dead.
- The post-quantum panel's "How it works" button now appears. It never had.
- Wallet settings and the permissions add-rule dialog now cover the popup instead
  of being clipped to their section.

### Fixed — text and colour

- `wizard.type.nsec` and friends rendered as raw key names on the last screen of
  first-run onboarding, in **all six languages**, for anyone importing an nsec or
  an npub.
- Two strings dropped their placeholders in five languages, including the one
  asking you to publish a Lightning Address without showing which one.
- Eleven CSS custom properties were used and defined nowhere. Four rules were
  being dropped entirely; the info tooltip's background was one of them, which is
  why it was transparent.
- Body and secondary text now meet WCAG AA contrast, and `prefers-reduced-motion`
  is respected.

### Internal

- Two new CI gates: one that scans the source for every string the UI asks for
  (comparing locales against English does **not** catch the bug above, because
  English was missing the keys too), and one that checks every `var(--token)`
  resolves.
- Test suite 1089 passing, up from 1045.
- `docs/deployment.md` is new. `docs/ui-ux-audit.md`,
  `docs/frontend-remediation-plan.md` and `-round-2.md` record the audits.

### Store release notes

> **Pay to a Lightning Address**
>
> You can now send to a Lightning Address (`name@domain`) from the Send box, not
> just a BOLT11 invoice.
>
> This release also fixes a long list of problems that only appeared some of the
> time — the wallet disappearing from the menu after the extension had been idle,
> the unlock screen looking frozen while it worked, buttons that failed without
> saying so, and several cases where a network hiccup could cost you data:
> adding a Lightning Address to your profile could wipe the rest of it, and
> editing your mute list could erase your private mutes. Both are fixed.
>
> Payment safety: the Send box can no longer pay a previous recipient while you
> are still typing a new one, and a payment that is retried after a connection
> drop can no longer be sent twice.
>
> Firefox users will see a data consent screen on update. It lists what the
> extension sends and where — your wallet's payment details to your wallet
> backend, and your profile, mute list and avatar to your own relays. Nothing
> else leaves your device, and your keys never do.

---

## 0.5.2 and earlier

Not recorded here; this file starts at 0.6.0. See the git history and the
release notes on each store listing.

**0.5.2 was disabled on addons.mozilla.org** on 2026-09-02 for declaring
`"data_collection_permissions": { "required": ["none"] }` while the wallet was
transmitting payment data. `0.6.0` is the fix. See `docs/deployment.md`.
