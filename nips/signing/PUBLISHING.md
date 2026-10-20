# Opening the upstream pull request

Nothing here has been done. These are the exact steps for León to propose [01-ios-same-device-signing.md](01-ios-same-device-signing.md) to `nostr-protocol/nips`. Every step is a decision; none follows from merging this folder.

## 1. Read the room first

The upstream repository has no numbering procedure: numbers are taken by the pull request that lands. Look at the open PRs that touch signing (NIP-46, NIP-55) and at any open proposal for iOS so the draft does not collide with one or duplicate it:

```sh
gh pr list --repo nostr-protocol/nips --state open --search "signer OR iOS OR App Attest" --limit 50
```

## 2. Fork, branch, copy

```sh
gh repo fork nostr-protocol/nips --clone --remote --default-branch-only -- ~/development/quantakrypto/submissions-to-3rd-parties/nips
cd ~/development/quantakrypto/submissions-to-3rd-parties/nips
git checkout -b ios-same-device-signing
cp ~/development/quantakrypto/nostr-wot/nostr-wot-extension/nips/signing/01-ios-same-device-signing.md XX.md
```

`XX` is a free number; the convention is to pick an unused two-digit one and let maintainers renumber. Then adapt the head of the file to the upstream format:

- replace the first line `# Draft: NIP-XX, Same-device signing on iOS` with the three-line header the repository uses:

  ```
  NIP-XX
  ======

  Same-device signing on iOS
  --------------------------

  `draft` `optional`
  ```

- drop the `Status:` paragraph (its content is the `draft` `optional` markers and the reference-implementation section, which stays);
- keep the single-line paragraphs; upstream does not hard-wrap either;
- the links `[NIP-55](55.md)` and `[NIP-46](46.md)` already resolve in the repository root.

Add one line to `README.md`'s list, in numeric order:

```
- [NIP-XX: Same-device signing on iOS](XX.md)
```

## 3. Check and commit

```sh
perl -CSD -ne 'print "$.: $_" if /\x{2014}/' XX.md   # must print nothing: no em dash
git add XX.md README.md
git commit -m "NIP-XX: Same-device signing on iOS"
git push -u origin ios-same-device-signing
```

## 4. Open the pull request

```sh
gh pr create --repo nostr-protocol/nips --head leonacostaok:ios-same-device-signing \
  --title "NIP-XX: Same-device signing on iOS" \
  --body "An Action Extension transport for NIP-55's method set on iOS, with App Attest caller identity, batching by default, two compound NIP-17 operations and an optional signing session over loopback. Implemented by the Nostr WoT wallet (signer) and its Swift client library; the first client is Obelisk for iOS. Vectors and both implementations are linked from the reference-implementations section."
```

Replace `leonacostaok` with the account the fork lives under. All NIPs are public domain, which the repository states; the draft carries no licence header of its own.

## 5. Record it

Open a `listing` record in the QuantaKrypto CRM only if this is treated as outreach; a protocol proposal to `nostr-protocol/nips` is nostr-wot work and sits outside the CRM rules. Either way, note the PR number back in this file's history and in `nips/signing/README.md` once it exists.
