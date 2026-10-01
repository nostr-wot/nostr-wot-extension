# Nostr web client and backend registry

[`src/data/auth-clients.json`](../src/data/auth-clients.json) is a source-evidenced
registry of 20 representative Nostr web clients and source-evidenced HTTP services.
It is not a measured “top 20”: no reliable, comparable active-user ranking was
available for this selection. It includes general social clients and specialist
publishing, streaming, lists, groups and commerce clients. Inclusion is neither
an endorsement nor a guarantee of current availability.

**Listing alone does not authorize signing.** Default backend auth is off by default
for each account. If a user enables it in Permissions, connected sites may use
NIP-98 automatically for exact same-origin HTTPS destinations and exact registry
pairs explicitly marked `nip98`. The policy covers valid endpoints and methods at
those origins; it does not create individual grants. Other auth types, unverified
entries, wildcard domains and relay authentication are excluded. Explicit denials
win, and connection, identity, event validation and native-wallet restrictions
still apply. Disabling the setting leaves explicit saved grants unchanged. The Backend authentication screen displays the enabled policy above saved grants and links here; policy approvals do not create individual rows. The information popup beside the toggle links here too.

Registry changes therefore change the optional policy's scope for users who have
enabled it. Review origin relationships and protocol evidence as security-sensitive
changes; do not infer trust from a similar hostname or a generic media service.

## Reading the data

Each entry has a stable `id`, display `name`, exact HTTPS client `origins`,
`backends`, primary-source `sources`, a `checkedAt` date and optional `notes`.
Each backend has an exact `origin`, a narrowly described `purpose`, its own
`sources` and one of these `auth` values:

- `nip98`: the cited implementation constructs HTTP authentication using kind
  27235 and a `u` destination tag for that service.
- `other`: the cited usage is a different protocol (for example Blossom), an
  unauthenticated read, or a documented legacy shape. Read `purpose`; this value
  does not claim the entire server has no NIP-98 endpoints.
- `unverified`: the service is evidenced, but the authentication mechanism or
  discovered HTTP API destination is not verified.

An empty `backends` means **unknown**, never “no backend” or “relay-only”. Nostr
relay traffic and NIP-42 authentication use WebSockets and are not represented as
HTTP origins. NIP-07 is the browser signer interface, not evidence that a client
uses NIP-98. Blossom authorization is separate from NIP-98. NIP-96 discovery may
return an API URL on another origin; do not grant its discovery origin as a
substitute for inspecting the actual request.

The checked date means the cited public documentation/source was inspected,
not that all authenticated production flows were exercised. Backend callsite links
are pinned to reviewed commits. Project homepages
can change, deployments can lag source, and custom deployments and user-selected
upload servers may differ. The registry intentionally does not enumerate every
relay, CDN, Lightning endpoint, third-party API, or media URL encountered in a feed.

## Evidence and compatibility notes

The source review found concrete NIP-98 callsites for noStrudel, YakiHonne
and Zap Cooking uploads to `https://nostr.build`, Iris's default
`https://npub.cash` API, Nostria's `https://api.nostria.app`, Shopstr's same-origin
API, and zap.stream's `https://api-core.zap.stream`. Their entries link directly
to the respective implementations. Primal's
configured Blossom uploader and Nostter's public event API illustrate services
that must not be conflated with NIP-98.

Snort's inspected `External/base.ts` constructs a kind-27235 event with a `url`
tag instead of the NIP-98 `u` tag. The registry records that distinction as
`other`; it must never relax validation to accommodate this legacy shape.
Flotilla's hosting implementation reuses a root-URL GET token across requests;
that is recorded as a separate auth shape, not a reason to relax validation.
Satellite's historical HTTP media API uses custom kind-22242 events in query
parameters; that is neither NIP-98 nor standard NIP-42 relay authentication.

Listr is the one entry without an identified fixed HTTP backend: its inspected list-creation
path publishes via NDK to configured WebSocket relays. This is bounded evidence
about that path, not proof that every feature is relay-only. Nostr.Band exposes
a public thumbnail origin in source, but its API origin comes from an absent
build-time configuration value and remains unknown. Coracle's entries explicitly
describe environment-template defaults rather than asserting production parity.

## Contributing or correcting an entry

1. Inspect the current official project repository or maintainer documentation.
   Confirm the deployed **client origin** independently of the backend. Prefer
   immutable commit links to the callsite and configuration defining the endpoint.
2. Supply evidence for every backend relationship and auth classification. A
   client supporting NIP-98 somewhere does not establish NIP-98 on every service.
   Do not invent `api.` hosts, infer from similar domain names, or copy endpoints
   solely from third-party directories. Use empty backends and a clear note when
   the destination is unknown.
3. Store canonical origins only: `https://host` or `https://host:port`, no path,
   query, fragment, wildcard, credentials or trailing slash. A different subdomain
   is a different origin. Keep backend paths in `purpose` or source evidence.
4. Update `checkedAt` to the actual review date (`YYYY-MM-DD`), keep IDs unique,
   sort entries by ID, and explain uncertainty, custom configuration or obsolete
   deployments in `notes`. Do not convert an unknown into a negative assertion.
5. Open a pull request with the evidence and reason for the correction, addition
   or removal. Do not include keys, tokens, signed auth events or private browsing
   traces. Additions need not preserve a count of exactly 20.
6. Run `node --import tsx --test tests/auth-client-registry.test.ts`, then the
   repository's required build and full test suite. The tests check structural
   integrity; reviewers must still verify factual claims and source provenance.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the general contribution process.
