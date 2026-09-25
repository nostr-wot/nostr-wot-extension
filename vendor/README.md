# vendor/

Tarballs of the `@nostr-wot/*` packages this extension consumes before they are published,
packed with `npm pack` from a `nostr-wot-sdk` checkout on `feat/shared-signer-core`.
`package.json` points at each with `file:vendor/<name>.tgz`.

| Package | What the extension takes from it |
| --- | --- |
| `@nostr-wot/storage` | the `KeyValueStore` port `browser.storage` is adapted to |
| `@nostr-wot/accounts` | NIP-06 derivation, import classification, NIP-49 (ncryptsec), bech32 |
| `@nostr-wot/permissions` | the deny-wins cascade and the permission store |
| `@nostr-wot/vault` | PBKDF2 + AES-GCM, the record format, the brute-force guard |
| `@nostr-wot/signer-core` | the request contract, the permission gate, the approval queue |
| `@nostr-wot/pq` | the post-quantum envelope `signer-core` builds on |

These are the same six the mobile app vendors, from the same branch, and the mechanism is
deliberately the same one — see `../nostr-wot-wallet/vendor/README.md`. Two hosts consuming
one set of tarballs by two different mechanisms is how the two drift.

### Why `pq` is vendored and not taken from the registry

`@nostr-wot/pq` is the only one of the six that *is* published, and that is exactly why it
is here. `signer-core` declares `"@nostr-wot/pq": "^0.2.2"`, the registry has a 0.2.2, and
that published 0.2.2 does not export everything this `signer-core` imports, so the range
matches on paper and the extension fails at import. Vendoring it is not a convenience: it
is the only way the range resolves to code that has what the caller needs.

Two failure modes follow from it being publishable, and `tests/vendor.test.ts` covers both:

- npm can satisfy the range from the registry **nested** under `signer-core` while the
  vendored copy sits unused at the root. Nothing breaks, nothing is stale, and the extension
  runs the registry's code. The test reads the lockfile and refuses any nested `@nostr-wot/*`.
- a later `pq` could drop an export `signer-core` needs. The test reads the import and
  re-export clauses for `@nostr-wot/pq` out of the packed `signer-core` bundle and checks
  the packed `pq` exports every one of them, so the list never has to be maintained.

`@nostr-wot/signers`, which `signer-core` also depends on, is **not** vendored: it is
published at the version the range wants and nothing here needs a newer one. It is
therefore an ordinary registry dependency, and the nested-copy test skips it by name.

### Drift

**`manifest.json` records the checkout path, branch and commit the tarballs were packed
from, and the sha256 of each tarball.** `tests/vendor.test.ts` fails when a tarball differs
from the manifest, when the installed copy or the lockfile is not that tarball, and, when
the checkout is reachable, when its HEAD or branch is not the recorded one. A vendored copy
that drifts from its source without saying so is a trap; the sibling app's first set of
tarballs fell sixteen commits behind the branch before anyone noticed.

The recorded `checkout` is relative to the repository root, and "beside the repo" means a
different number of `..` from the main clone (`nostr-wot/nostr-wot-extension`) than from a
worktree of it (`nostr-wot/nostr-wot-extension-worktrees/<task>`). Both are tried, and
`VENDOR_SDK_PATH` overrides.

Why tarballs and not `file:../path` or a workspace: npm installs a tarball as a real
directory under `node_modules`, so Vite resolves it like any registry package, nested
dependencies dedupe against the root, and the lockfile pins an integrity hash of the exact
bytes. A path dependency is a symlink into another checkout that may be on any branch at
any time.

To refresh: `scripts/vendor-signer-packages.sh [sdk checkout]` (refuses a checkout with
uncommitted package changes, or a stale `dist/`; uninstalls and reinstalls the six so npm
does not keep the old extraction), then run the tests. **npm does not re-extract an
unchanged `file:` tarball**, so a repack without the uninstall silently keeps the old bytes
in `node_modules` and in the lockfile, with no error anywhere. That is what the second test
below exists to catch.

To switch to the published versions once they exist: replace each
`"file:vendor/nostr-wot-<name>-<version>.tgz"` in `package.json` with the version range,
delete this directory, the script and `tests/vendor.test.ts`, and run `npm install`. No
import changes anywhere: the package names are already the real ones.
