#!/usr/bin/env sh
# Repack the shared @nostr-wot packages from their nostr-wot-sdk checkout into vendor/,
# and record WHICH commit they came from.
#
# They are not on npm yet. This extension consumes them as `file:vendor/*.tgz` so that npm
# installs real directories under node_modules (Vite then resolves them like any registry
# package) and the lockfile pins exactly the bytes that were built. See vendor/README.md.
#
# One source: the six signer packages (storage, accounts, permissions, vault, signer-core,
# pq) from the `feat/shared-signer-core` branch of nostr-wot-sdk.
#
# `pq` is vendored for the same reason as the other five and for one more: `signer-core`
# imports names from it that are NOT in the published `@nostr-wot/pq` 0.2.2. Left to the
# registry, npm resolves `^0.2.2` to a copy that lacks them and the extension fails at
# import. It is a signer-source package, packed and drift-checked with the others, not a
# registry dependency that happens to share a scope.
#
# vendor/manifest.json records the branch and commit, and the sha256 of every tarball.
# tests/vendor.test.ts fails when a tarball no longer matches the manifest and, when the
# checkout is reachable, when its HEAD is not the recorded commit: a vendored copy that
# drifts silently from its source is a trap, and it has already caught the sibling app.
#
# Usage: scripts/vendor-signer-packages.sh [sdk checkout]
set -eu
SIGNER_PACKAGES='storage accounts permissions vault signer-core pq'
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$HERE/vendor/manifest.json"
# The checkout sits beside the repo, but "beside" depends on where this repo is checked
# out from: the main clone is `nostr-wot/nostr-wot-extension`, a worktree of it is
# `nostr-wot/nostr-wot-extension-worktrees/<task>`, one level deeper. Both are normal
# places to run this from, so both candidates are tried rather than one being declared
# correct. An explicit argument always wins.
SDK="${1:-}"
if [ -z "$SDK" ]; then
  for candidate in ../nostr-wot-sdk-worktrees/shared-signer-core ../../nostr-wot-sdk-worktrees/shared-signer-core; do
    if [ -d "$HERE/$candidate/packages" ]; then SDK="$candidate"; break; fi
  done
fi
[ -n "$SDK" ] || { echo "no nostr-wot-sdk checkout found beside this repo; pass one" >&2; exit 1; }
SDK_REL="$SDK"
SDK="$(cd "$HERE" && cd "$SDK" && pwd)"

# The six are packed from the checkout's built dist, so uncommitted source there would be
# packed as if it were HEAD: refused. Nothing in the checkout is written (`npm pack` only
# reads) — it may be another agent's live tree.
if [ -n "$(git -C "$SDK" status --porcelain -- packages)" ]; then
  echo "$SDK has uncommitted changes under packages/; commit or discard them first" >&2
  exit 1
fi
SDK_COMMIT="$(git -C "$SDK" rev-parse HEAD)"
SDK_BRANCH="$(git -C "$SDK" branch --show-current)"

# Check every dist BEFORE deleting a single tarball: an abort halfway through leaves
# vendor/ with some fresh tarballs and some missing ones.
#
# Two checks, because mtime is the weaker one. The SDK's own `scripts/dist-stamp.mjs`
# hashes what a build read (src, tsup.config.ts, the resolved tsconfig, package.json, the
# tool versions) and compares it with the stamp the build wrote, so it catches a dist built
# from DIFFERENT sources that happens to be newer. It is read-only. It matters most for
# `pq`, which is the one package here with no `prepack`: `npm pack` rebuilds the other five
# on its way out and packs whatever dist `pq` already has.
for name in $SIGNER_PACKAGES; do
  dir="$SDK/packages/$name"
  [ -f "$dir/dist/index.js" ] || { echo "no dist in $dir; build the SDK first" >&2; exit 1; }
  if [ "$(stat -f %m "$dir/dist/index.js")" -lt "$(stat -f %m "$(ls -t "$dir"/src/*.ts | head -1)")" ]; then
    echo "$name: dist is older than src; rebuild the SDK first" >&2; exit 1
  fi
  if [ -f "$SDK/scripts/dist-stamp.mjs" ]; then
    ( cd "$dir" && node "$SDK/scripts/dist-stamp.mjs" check "$dir" >/dev/null ) \
      || { echo "$name: dist does not match its source (dist-stamp); rebuild the SDK first" >&2; exit 1; }
  fi
done

rm -f "$HERE"/vendor/*.tgz

entries=""
add_entry() { # name file sha256
  entry="    \"$1\": { \"file\": \"$2\", \"sha256\": \"$3\" }"
  if [ -z "$entries" ]; then entries="$entry"; else entries="$entries,
$entry"; fi
}

for name in $SIGNER_PACKAGES; do
  dir="$SDK/packages/$name"
  file="$(npm pack "$dir" --pack-destination "$HERE/vendor" 2>/dev/null | tail -1)"
  sum="$(shasum -a 256 "$HERE/vendor/$file" | cut -d' ' -f1)"
  add_entry "$name" "$file" "$sum"
  echo "packed $name -> $file"
done

cat > "$MANIFEST" <<EOF
{
  "source": { "checkout": "$SDK_REL", "sdkBranch": "$SDK_BRANCH", "sdkCommit": "$SDK_COMMIT" },
  "packages": {
$entries
  }
}
EOF
echo "recorded $SDK_COMMIT in vendor/manifest.json"

# npm does not re-extract a file: tarball whose spec and version did not change, so a plain
# `npm install` after a repack leaves node_modules and the lockfile on the OLD bytes with no
# error. Uninstall and reinstall by path instead; tests/vendor.test.ts checks the installed
# copy and the lock integrity against the tarballs.
#
# The names and paths are read back out of the manifest just written rather than spelled out
# here: the six do NOT share a version (`pq` is 0.2.2, the rest 0.1.0), so a hardcoded
# `nostr-wot-<name>-0.1.0.tgz` list would install a file that does not exist after a bump.
cd "$HERE"
NAMES="$(node -p "Object.keys(require('$MANIFEST').packages).map(n=>'@nostr-wot/'+n).join(' ')")"
PATHS="$(node -p "Object.values(require('$MANIFEST').packages).map(p=>'./vendor/'+p.file).join(' ')")"
npm uninstall --legacy-peer-deps $NAMES >/dev/null 2>&1 || true
npm install --legacy-peer-deps $PATHS >/dev/null
echo "reinstalled the six from vendor/; run the tests"
