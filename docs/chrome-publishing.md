# Automatic Chrome Web Store publishing

Publishing a stable GitHub release triggers `.github/workflows/release-chrome.yml`.
It downloads exactly `nostr-wot-chrome-VERSION.zip` and `SHA256SUMS` from that
release, verifies its checksum, validates its Chrome manifest and version, and
starts the actual archive in Chromium. The worker, popup, and connection-status
RPC must work before Google credentials are used. The release commit must belong
to main and have a successful push run of `tests.yml`.

The final Node 24 step calls Google's Web Store **v2** API. It rechecks the ZIP
checksum, skips versions already submitted or published, refuses to overwrite a different
pending/staged submission without explicit authorization, uploads only to `gfmefgdkmjpjinecjchlangpamhclhdo`, waits for successful
upload processing, then submits for review with automatic publication after
approval. Google review still controls when users receive the update. Existing
store visibility and rollout settings are preserved. Store warnings stop submission.
No workflow is triggered by pull requests; submissions are serialized across releases.

## Backend compatibility gate for 0.8.7

Before publishing 0.8.7, deploy the matching LNbits-proxy v2 authentication update
using its documented deployment procedure and verify the v2 transaction tests,
health check and legacy HTTP 426 behavior. The protocol is documented in
[wallet-auth-v2.md](wallet-auth-v2.md). New wallet provisioning and address mutations
require that backend; the extension will not fall back to unsafe legacy routes.
Existing wallet-key operations keep their existing APIs. Updating a draft release
or building packages does not deploy the backend or submit to Chrome Web Store.
Manual UI acceptance and backend rollout must both finish before publication.

## One-time setup (OAuth client)

No service account is required. Use a Google OAuth web client owned by the publisher:

1. In [Google Cloud Console](https://console.cloud.google.com/), enable **Chrome
   Web Store API** in the OAuth client's project. Its authorized redirect URI must
   include `https://developers.google.com/oauthplayground`.
2. In [OAuth Playground](https://developers.google.com/oauthplayground/), open the
   settings gear, enable **Use your own OAuth credentials**, and enter the client
   ID and client secret from the downloaded JSON. Keep access type **Offline**.
3. Enter only `https://www.googleapis.com/auth/chromewebstore` as the scope and
   click **Authorize APIs**. Sign in with the account that manages the publisher
   and approve the permission. Exchange the returned authorization code for tokens.
4. In [repository Actions secrets](https://github.com/nostr-wot/nostr-wot-extension/settings/secrets/actions),
   configure **CHROME_WEBSTORE_CLIENT_ID**, **CHROME_WEBSTORE_CLIENT_SECRET**,
   and **CHROME_WEBSTORE_REFRESH_TOKEN**. Use the refresh token, not the short-lived
   access token. Don't paste credentials into chat, issues, commits, or logs.
5. In [repository Actions variables](https://github.com/nostr-wot/nostr-wot-extension/settings/variables/actions),
   configure **CHROME_WEBSTORE_PUBLISHER_ID** from the dashboard **Publisher → Settings** page.
   This is different from the extension ID.

The workflow exchanges the refresh token for a short-lived access token only in
its final submission step. Both OAuth and publishing requests go directly to
Google; credentials are never written into the checkout or printed by the script.
Use your own OAuth client: Playground's default client revokes refresh tokens
within 24 hours. External OAuth applications in **Testing** can also have
seven-day refresh tokens; configure the consent application's publishing status
appropriately for ongoing automation. Revoked/expired tokens fail the workflow
and require repeating the consent step.

References: [Google publishing and OAuth setup](https://developer.chrome.com/docs/webstore/using-api),
[Google token expiry rules](https://developers.google.com/identity/protocols/oauth2#expiration).
The older MobileFirstLLC publisher action uses Node 16. This workflow uses
SHA-pinned Node 24 checkout/setup actions and a local script against Google's v2
API, including explicit asynchronous upload handling before submission.

## Release procedure and concurrency

1. Merge the completed, reviewed changes into `main` and push it. Bump package,
   lockfile and manifest together; update CHANGELOG, SOURCE_BUILD and AGENTS.
2. Wait for the push run of `tests.yml` on the **exact release commit** to pass.
   That CI builds, typechecks, runs the full registered tests and validates browser
   packages. The release workflow refuses a commit without that success.
3. Run the browser-specific generators from that commit. Attach
   `nostr-wot-chrome-VERSION.zip`, `nostr-wot-firefox-VERSION.zip`, matching source,
   and `SHA256SUMS` to the draft GitHub release. Reproduce the archives from source.
   The checksum file must contain exactly one entry for the versioned Chrome ZIP.
4. Publish the stable GitHub release. **Only `release: published` triggers store
   deployment.** Pushes, tags alone, draft edits, prereleases and pull requests do
   not deploy. There is no manual `workflow_dispatch` trigger.
5. Check **Actions → Publish Chrome Web Store**. The job downloads and smoke-tests
   the exact release asset again, then submits it. Check Google's review status;
   a successful submission is not a claim that Google has already approved it.
6. Remove clean, merged task worktrees and merged local/remote task branches.

The concurrency group is global to this Chrome store item, with
`cancel-in-progress: false`. A newer release cannot interrupt an in-progress
upload. GitHub's concurrency queue keeps at most one running and one pending run;
it does not guarantee FIFO delivery of several queued releases. Avoid publishing
multiple versions while a previous version is being processed or reviewed.

Before any upload, the script reads the store status. If this version is already
published or pending/staged, it succeeds with `ALREADY_PUBLISHED` or
`ALREADY_SUBMITTED` and makes **no upload or publish request**. This makes a rerun
safe after a successful submission. This check compares store versions, not
remote package hashes: keep manual dashboard uploads out of the automated path.

GitHub releases created with a workflow's default GITHUB_TOKEN do not trigger
another workflow. This release workflow expects publication from the GitHub UI
or `gh` authenticated as a maintainer. A future automated release creator must
use an appropriate GitHub App token and preserve these checks.

## Authorized replacement of the pending 0.8.6 submission

The maintainer explicitly requested cancelling 0.8.6 and submitting the final
0.8.7 integration. Set repository variable **CHROME_WEBSTORE_REPLACE_VERSION**
to `0.8.6` for that release. Only the `v0.8.7` release passes this variable to the
publisher. After local/CI/archive/browser checks pass, the script will cancel
only if every pending distribution channel reports exactly that version; it
re-reads status to confirm cancellation before uploading 0.8.7. A different
pending version is an error, with no cancellation or upload.

Remove the replacement variable after the successful submission. Future releases
cannot use this exception. Replacing any future review requires a separately
reviewed, explicit authorization; the default is to stop, not cancel it.

## Failure recovery

If CI wasn't complete, credentials were missing, or Google rejected the request,
fix the cause and use **Re-run failed jobs** on the existing release run. Do not
publish duplicate releases or delete/recreate tags to retry.

After a network error during upload/submission, inspect the developer dashboard
before retrying: Google may already have received it. The script does not retry
mutations automatically. If already submitted, rerunning is a no-op based on the
version check. If uploaded but not submitted, inspect the draft and API error
before deciding whether to retry; Google may reject a duplicate upload. An
unexpected review is preserved unless the precise replacement above is authorized.

Tests in `tests/chrome-publishing.test.ts` cover OAuth refresh, synchronous and
asynchronous upload, failure/timeout gates, identity/version/checksum mismatch,
no mutation retries, duplicate-run no-ops and precisely scoped cancellation.
Mocked tests don't prove live authorization: verify the configured credentials
with Google's read-only `fetchStatus` before the first submission.
