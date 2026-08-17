# 04 — Signer encryption capability (`window.nostr.nip44.schemes`)

`draft` `optional`

An additive extension to NIP-07 that lets a web application discover which
encryption schemes a signer accepts, and request one explicitly.

## Motivation

Draft 03 shows that post-quantum encryption can only be performed by whatever
holds the key material, because it needs the raw NIP-44 conversation key on the
way out and the ML-KEM secret key on the way in. Under NIP-07 that is the signer.
The page cannot do the work itself.

So the page has to ask the signer. The natural way to do that is an optional
argument to `nip44.encrypt`, and that is what this draft specifies. But an
optional argument creates a detection problem that is worse than the one it
solves:

**A signer that supports post-quantum and a signer that has never heard of it are
shaped identically.** Both expose `nip44.encrypt`. JavaScript discards surplus
arguments silently, so calling an unaware signer with post-quantum options
succeeds and returns perfectly valid *classic* ciphertext. A caller that assumed
support would then show the user a post-quantum badge over a message that has
none.

That is a silent downgrade presented as protection, which is worse than not
offering the feature. Every other design decision in these drafts exists to avoid
exactly this failure, so the capability has to be detectable rather than
inferable.

## Specification

### `schemes`

A signer that implements this draft MUST expose an array of scheme identifiers on
its `nip44` object:

```js
window.nostr.nip44.schemes    // ["nip44", "pq"]
```

| Identifier | Meaning |
|---|---|
| `nip44` | Classic NIP-44 v2. Always present. |
| `pq` | The post-quantum envelope of draft 03. |

Detection:

```js
const supportsPq = Array.isArray(window.nostr?.nip44?.schemes)
  && window.nostr.nip44.schemes.includes('pq');
```

**An absent `schemes` and a `schemes` of `["nip44"]` are different answers.** The
first is an older signer whose capability is unknown. The second is a signer
stating that it does not do post-quantum. Both mean "do not send post-quantum",
but only the second is an answer, and a client that wants to tell its user
whether the obstacle is on their side or the signer's needs to distinguish them.

Unknown identifiers MUST be ignored, so the list can grow.

### `encrypt`

```js
window.nostr.nip44.encrypt(pubkey, plaintext, opts?)
```

`opts` is optional. Omitted, behaviour is exactly NIP-44 as it is today, so
existing callers are untouched.

```ts
interface PqEncryptOptions {
  scheme: 'pq';
  /** Recipient's ML-KEM-1024 public key, base64, from their kind:10203 attestation. */
  recipientKemKey: string;
}
```

A signer that does not support the requested scheme MUST reject. It MUST NOT
fall back to classic encryption, which would be the silent downgrade this draft
exists to prevent.

### `decrypt`

```js
window.nostr.nip44.decrypt(pubkey, ciphertext)
```

Unchanged, and it takes no options. The envelope of draft 03 is self-describing,
so the signer routes on the payload. A caller cannot get this direction wrong and
is not asked to.

## Why encryption is opt-in rather than inferred

The signer does not have the recipient's ML-KEM key. Inferring the scheme would
mean the signer fetching the recipient's `kind:10203` attestation from relays in
the middle of an encryption call: network I/O, with latency and a failure mode,
inside an operation callers expect to be local and immediate.

Worse is what happens when that lookup fails. The only choices are to break every
existing caller by throwing, or to fall back to classic silently. The second is
the downgrade again.

The calling application already knows whether it wants post-quantum, already has
the recipient's attestation in hand or can decide what to do when it does not,
and can show the user what happened. The decision belongs there, so it passes the
key it already has.

## Signer capability is not account capability

`schemes` describes what the signer implementation accepts. It does not promise
that the currently selected account can perform it, and a post-quantum encryption
may still be rejected for account-specific reasons, such as:

- a watch-only account, which can sign nothing;
- a remote signer, since NIP-46 defines no post-quantum operations;
- an account imported from an `nsec`, with no seed to derive from;
- a 12-word mnemonic, which draft 01 refuses to derive from.

Advertising per-account capability was considered and rejected: it would leak
which kind of account the user has to any page that reads `window.nostr`, before
any consent, and the capability would change under the caller as the user
switched accounts. So the array is a property of the signer, and callers MUST
handle a rejection from `encrypt` even when `schemes` includes `pq`.

The signer SHOULD make the reason legible in the error, so the client can tell
the user what to change.

## Interaction with NIP-46

NIP-46 has no post-quantum operations, and a bunker knows nothing about this
envelope.

A signer whose *only* backend is a NIP-46 remote signer MUST NOT advertise `pq`.
It cannot perform the scheme by any route, so advertising it would produce
classic ciphertext under a post-quantum badge: the failure at the top of this
document, arriving sideways.

A signer that manages several accounts, some local and some remote, advertises
`pq` if it implements it, and rejects the call when the selected account is
remote. That is the signer-versus-account distinction above, and it is why the
rejection has to be handled rather than treated as impossible.

Extending NIP-46 itself is possible but out of scope here.

## Security considerations

The marker is a hint from an untrusted source. A hostile page cannot use it to
harm the user, since the signer enforces its own permissions regardless, but a
hostile *signer* could advertise `pq` and return classic ciphertext.

This draft does not defend against that, and cannot: a client that has delegated
encryption to a signer has already trusted it with the plaintext. A client that
needs certainty must verify the envelope structure of what comes back, which is
cheap, because the version and algorithm bytes of draft 03 are checkable without
any key material.

## Reference implementation

`inject.ts` and `lib/signer.ts` in this repository. The consuming side is
`signerSupportsPq` in
[`@nostr-wot/signers`](https://github.com/nostr-wot/nostr-wot-sdk/tree/main/packages/signers).
