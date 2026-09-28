# Theme URL handoff

An outreach link can use `https://nostr-wot.com/download?theme=coracle&ref=coracle`.
Supported themes: `light`, `dark`, `system`, `lacrypta`, `coracle`, `nostrudel`,
`yakihonne`, `nostrich`. Unknown, duplicate or `custom` values are ignored.
`ref` is ignored: it grants no permissions and is neither stored nor transmitted.

## First installation

Keep the download page open while installing from the browser store. The store does
not forward its referring URL. On `runtime.onInstalled` with reason `install`, the
background queries only `https://nostr-wot.com/*` tabs, validates an exact official
origin and `/download` or supported localized download path, and passes the unique
valid theme to onboarding. Conflicting campaign themes fall back to normal onboarding.
The background persists the theme, then tries the native toolbar popup once. If the
browser refuses automatic opening or lacks the API, the user clicks the extension
icon manually. No setup tab is opened, and there is no delayed retry.
The manifest grants host access only to that official HTTPS site for this lookup;
it does not request the broad `tabs` permission or inspect other sites' URLs.

The initial theme is saved before the toolbar popup opens, so its first render
uses the right palette, even if the user opens it manually. A previous
saved choice is never replaced by the handoff. Installs with an existing vault or
saved accounts do not reopen onboarding. Updates do not reopen it either.
A closed source tab or denied lookup falls back to the default theme; choose a
project from Settings if necessary. No website deployment is required for these
existing download URLs because the extension reads the URL itself.

## Direct extension URLs

Append `?theme=coracle` to the installed extension's
`src/entrypoints/onboarding/index.html` or `src/entrypoints/popup/index.html` URL.
Use the browser-assigned extension ID, not a hardcoded ID. This supplies an initial
choice only when `appearanceTheme` is absent. It never clears accounts or vaults,
changes signing permissions, or resets onboarding. Existing users can switch themes
with the shared Dropdown in Settings. Approval documents ignore URL parameters.

## Verification

`tests/theme-handoff.test.ts` exercises the installation coordinator and trusted URL
parser. `tests/theme-tokens.test.ts` exercises actual theme initialization and storage
using a DOM. Manual store-install validation still requires a fresh browser profile:
open a download link, install this build, and verify the native welcome popup and
subsequent popup/Settings use the same theme. Also check installation without a
campaign tab, a browser that refuses automatic popup opening (click the icon; no tab should open),
and an update with an already saved theme.

Browser API references: [Chrome tab permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs)
and [installation events](https://developer.chrome.com/docs/extensions/reference/api/runtime).
