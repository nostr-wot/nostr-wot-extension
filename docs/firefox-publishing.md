# Mozilla Add-ons publishing

Publishing a stable GitHub release triggers `.github/workflows/release-firefox.yml`
for the existing listed add-on `nostr-wot-extension@nostr-wot.com`. Pushes, tags,
pull requests, drafts and prereleases do not submit to Mozilla. The Chrome workflow
runs independently from the same release event. Submission does not establish
Mozilla approval or public availability; check the developer dashboard for that.

## Credentials

Configure repository Actions secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` using the
publisher's [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/).
The issuer includes its `user:` prefix. No Google OAuth or separate service account
is needed. Never put the secret in source, release assets or reviewer notes.

Only the final submission step receives these secrets. The publisher generates a
fresh, one-minute HS256 JWT for each API call, sends it only to Mozilla's HTTPS API
and refuses redirects. To rotate credentials, replace both repository secrets with
the new pair and revoke the old credentials in Mozilla's dashboard.

## Release contents and checks

Attach these files to `vX.Y.Z` before publishing the GitHub release:

- `nostr-wot-firefox-X.Y.Z.zip`, made by `npm run package:firefox`.
- `nostr-wot-source-X.Y.Z.zip`, made by `git archive --format=zip` of the release commit.
- `SHA256SUMS`, with exactly one matching SHA-256 entry for each archive.

The shared `scripts/prepare-store-release.mjs` gate resolves the tag, requires its
commit to be on `main` with successful push CI on that exact SHA, and checks the
package version. The Firefox preparation step checks the manifest, add-on ID and
checksums, compares every source archive file with `git archive` of that commit,
then rebuilds Firefox and compares every packaged file. ZIP timestamps are ignored;
file contents and paths must match. These checks run before Mozilla secrets are used.

Mozilla receives the Firefox ZIP and matching source ZIP, plus:

- Reviewer notes from [firefox-reviewer-notes.md](firefox-reviewer-notes.md).
- Build commands, source commit and archive hashes. Full [build instructions](../SOURCE_BUILD.md) are included in the source ZIP.
- English release notes from the [changelog](../CHANGELOG.md). If the full section exceeds Mozilla's 3,000-character limit, use its `### Store release notes` summary and an immutable link to the complete changelog; the complete file is also in the source ZIP.

Update these tracked documents alongside the code. Generated metadata and notes stay in the runner's temporary directory. Reviewer notes must fit Mozilla’s 3,000-character limit including the archive markers; the publisher checks that before making an API call. Full build/reviewer guides remain in the source archive, and release notes use a separate field with the same limit. The API submission attaches source and reviewer notes during version creation, then saves translated release notes and reads the version back to verify both notes and the source attachment. Release-note comparison accounts for Mozilla rendering Markdown bullets as HTML lists and linkifying URLs, while still rejecting changed or missing text. The internal “Store release notes” heading is omitted before submission and verification because Mozilla removes that Markdown heading. Other section headings and inline code are sent as plain text so Mozilla retains their content without altering the formatting during verification. All release-note content below the internal heading remains required.

## Duplicate protection and recovery

All Mozilla runs share a concurrency group with cancellation disabled. They run
serially, and the API state is checked again before each submission. An already
submitted version with matching archive markers and notes is skipped. If only
metadata is incomplete, a rerun can finish it without uploading another version.
An existing version without matching source/package markers is left untouched.

The workflow refuses a newer version, a rejected/disabled matching version, a validation failure, or a build mismatch.
Older listed versions awaiting review do not block a newer release. The publisher
submits the newer version through Mozilla’s Version Create API without deleting
version history. No per-release override or workflow edit is needed. A rerun still requires a published release
and passing CI; it does not bypass the release gate.

Writes are not automatically retried. After a network error, inspect the dashboard
before rerunning: Mozilla may have accepted a request whose response was lost. An
orphaned validation upload is not a submitted version; a rerun may validate a new
upload, but it checks for an existing submitted version first. If version creation
succeeded, its hash markers let the rerun safely resume metadata. No automatic rollback or deletion is performed.

The implementation uses Mozilla's [Add-ons API](https://mozilla.github.io/addons-server/topics/api/addons.html)
and [JWT authentication](https://mozilla.github.io/addons-server/topics/api/auth.html).
Tests mock the API and cover submission, source/notes attachment, interrupted runs,
duplicate refusal, pagination, credential boundaries and validation failures.

Upload IDs accept Mozilla’s compact hexadecimal UUID representation as well as
the canonical hyphenated form. Both are validated before building polling URLs.

For an already-published release whose original workflow predates a tooling fix,
use **Recover published store release** with its tag and `firefox`. `inspect`
reads version/status fields without mutations; `submit` uses current main tooling
with the original verified release source and packages. It shares the normal
Mozilla concurrency group and retains the exact-release CI and reproducibility gates.
Ordinary new releases submit automatically without this recovery step.
