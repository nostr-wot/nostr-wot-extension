# Workflow Rules

**NEVER use git worktrees.** Always work directly on the main repo. The extension is loaded from the main repo's `dist/` — worktree builds go to a different directory and changes are invisible.

# Safari Build & Install

The Safari wrapper project already exists in `safari-xcode/`. Do NOT regenerate it with `safari-web-extension-converter` — that would wipe Xcode customizations. Instead, refresh the embedded Resources from `dist/`, bump the project version, and rebuild.

**Existing config (do not ask the user — read here):**
- Xcode project: `safari-xcode/Nostr WoT/Nostr WoT.xcodeproj`
- Embedded resources: `safari-xcode/Nostr WoT/Nostr WoT Extension/Resources/` (copy of `dist/`)
- App bundle ID: `com.nostr-wot.extension`
- Extension bundle ID: `com.nostr-wot.extension.Extension`
- Apple team: `R3M572YZ8S` (DANDELION LABS JOINT STOCK COMPANY) — certs already on this machine
- Archive output: `safari-build/NostrWoT.xcarchive`
- App-Store export config: `safari-build/ExportOptions.plist` (App Store Connect upload)

**Local install (dev / user testing) — what to run:**
```bash
# 1. Build the web extension
npm run build

# 2. Sync dist/ into the Xcode project's Resources/ (delete-mode rsync to drop removed files)
rsync -a --delete dist/ "safari-xcode/Nostr WoT/Nostr WoT Extension/Resources/"

# 3. Bump MARKETING_VERSION in the pbxproj to match package.json
NEW_VERSION=$(node -p "require('./package.json').version")
sed -i '' "s/MARKETING_VERSION = [0-9.]*/MARKETING_VERSION = ${NEW_VERSION}/g" "safari-xcode/Nostr WoT/Nostr WoT.xcodeproj/project.pbxproj"

# 4. Build the .app — pass DEVELOPMENT_TEAM so signing uses the keychain's
#    Apple Development cert instead of falling back to ad-hoc. With ad-hoc
#    signing, Safari requires "Allow unsigned extensions" each session.
xcodebuild -project "safari-xcode/Nostr WoT/Nostr WoT.xcodeproj" \
  -scheme "Nostr WoT" \
  -configuration Debug \
  -derivedDataPath safari-build/DerivedData \
  DEVELOPMENT_TEAM=R3M572YZ8S \
  CODE_SIGN_STYLE=Automatic \
  build

# 5. Open the built .app once to register the extension with Safari
open "safari-build/DerivedData/Build/Products/Debug/Nostr WoT.app"
```

**User-side steps after `open` (cannot be automated):**
1. Safari → Settings → Extensions → enable Nostr WoT.

(Step 1 is the only one needed when the build is signed with `DEVELOPMENT_TEAM=R3M572YZ8S`. The "Allow unsigned extensions" Develop-menu toggle is only needed if you fell back to ad-hoc signing.)

**App Store upload (release flow, separate from local install):**

Do not waste time looking for App Store Connect API keys, Issuer IDs, or app-specific passwords. They are NOT needed. Xcode's `IDEDistribution.framework` reads cached Apple ID credentials from a system keychain item that `security find-generic-password` cannot see — but `xcodebuild -exportArchive` with `destination=upload` can. Just run the upload; if there is no cached credential the command will print an obvious auth error and only then escalate.

```bash
# 1. Bump versions
sed -i '' 's/"version": "OLD"/"version": "NEW"/' package.json manifest.json
sed -i '' 's/MARKETING_VERSION = OLD/MARKETING_VERSION = NEW/g' \
  "safari-xcode/Nostr WoT/Nostr WoT.xcodeproj/project.pbxproj"

# 2. Build & sync
npm run build
rsync -a --delete dist/ "safari-xcode/Nostr WoT/Nostr WoT Extension/Resources/"

# 3. Archive (Release config, automatic signing with the Dandelion team)
rm -rf safari-build/NostrWoT.xcarchive
xcodebuild archive \
  -project "safari-xcode/Nostr WoT/Nostr WoT.xcodeproj" \
  -scheme "Nostr WoT" \
  -configuration Release \
  -archivePath safari-build/NostrWoT.xcarchive \
  DEVELOPMENT_TEAM=R3M572YZ8S \
  CODE_SIGN_STYLE=Automatic

# 4. Re-sign for distribution AND upload to App Store Connect.
#    The existing safari-build/ExportOptions.plist already has
#    method=app-store-connect + destination=upload + teamID=R3M572YZ8S.
xcodebuild -exportArchive \
  -archivePath safari-build/NostrWoT.xcarchive \
  -exportOptionsPlist safari-build/ExportOptions.plist \
  -exportPath safari-build/Upload
```

The build then has to be selected in App Store Connect (Apps → Nostr WoT → TestFlight or App Store distribution) — that part is web-UI only.

# Self-Review Checklist

Every code change must pass through these gates. No exceptions, no shortcuts.

## Before Commiting Code
Read existing code and documentation before commiting anything.

1. **Run the build** — `npm run build` must succeed with no errors.
2. **Run full suite** — `./tests/run.sh` (module tests may hang after completion due to open handles in mock — this is known, not a failure).
3. **Do not coauthor or cosign commits**.

## Before Writing Code

Read existing code and documentation before modifying anything.

**Always read:**
- The file you're about to modify
- Its existing tests (search `tests/` for matching filenames)

**Read based on what you're changing:**

| Changing | Read first |
|----------|-----------|
| `lib/`, `background.ts`, `content.ts`, `inject.ts` | `docs/architecture.md`, `docs/message-flow.md` |
| `lib/crypto/`, `lib/vault.ts`, `lib/signer.ts` | `docs/security.md` |
| Message handling, new RPC methods | `docs/message-flow.md` |
| `src/components/`, `src/popup/` | `docs/component-standards.md` |
| Test files or test infrastructure | `docs/testing.md` |
| Badge engine (`badges/engine.ts`) | `tests/badges/engine.test.ts` |

## After Writing Code

Complete every step before claiming work is done.

1. **Run targeted tests** — run the specific test file(s) for the area you changed.
2. **Run the build** — `npm run build` must succeed with no errors.
3. **Verify test coverage** — every new or changed function must have a test. If none exists, write one. Work is not done until the test exists.
4. **Update documentation** — if your change alters behavior described in any `docs/` file, update that doc in the same changeset. A code change without its corresponding doc update is incomplete work. Do not defer this.

**Hard rule:** Never claim "done" or "all tests pass" without actually running the commands and reading the output. No assumptions. No "should work." Show the TAP summary or build output.

## Anti-Rationalization

These thoughts mean stop and verify:

| If you think... | Do this instead |
|-----------------|-----------------|
| "This is a small change, it won't break anything" | Run the tests. |
| "I know what this function does" | Read it. Read its tests. Then modify. |
| "The docs probably don't cover this" | Check. They probably do. |
| "I'll update the docs later" | Update them now, in this changeset. |
| "Tests pass for the file I changed" | Run the full suite. Cross-module regressions are real. |
| "This new function is simple enough it doesn't need a test" | It does. Write one. |
| "The build will be fine" | Run it. Verify the output. |

## Key Commands

```bash
# Targeted test (example: crypto)
node --import tsx --test tests/crypto/*.test.ts

# Targeted test (example: badge engine)
node --import tsx --test tests/badges/engine.test.ts

# Module tests (need browser mock)
node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/vault.test.ts tests/permissions.test.ts tests/accounts.test.ts tests/signer.test.ts tests/security-hardening.test.ts tests/communication.test.ts

# Full suite
./tests/run.sh

# Build
npm run build
```
