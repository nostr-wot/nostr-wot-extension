# Public account data and background capabilities

`SafeAccount` explicitly selects account ID, name, type, pubkey, read-only status,
creation time and optional derivation index/path. `getActiveAccount()` and
`getAccountById()` use the shared domain `toSafeAccount()` mapper to construct
these fields individually. Onboarding and encrypted-key import responses use the
same mapper. Account generation returns the seed phrase separately for the explicit
backup step, never inside the account metadata. They never include wallet
configuration, NIP-46 configuration (including bunker URL secrets and local signer
keys), mnemonic, local private keys, imported PQ keys, or unknown future fields.
`listAccounts()` remains a smaller public metadata projection.

Background wallet handlers use `getActiveAccountWithWallet()` for public metadata
plus a detached wallet configuration. Despite the legacy `SafeAccountWithWallet`
type name, this is a privileged capability containing payment credentials and must
never be returned by a UI or page RPC. It excludes NIP-46 credentials.

The remote signer obtains `BackgroundRemoteSignerAccount` through
`getAccountForRemoteSigning(accountId)` only while the vault is unlocked. This
capability returns an explicit, detached NIP-46 configuration and excludes wallet
and other account secrets. Queue and signing request interfaces continue to accept
only public metadata. The session-info handler reads this capability internally
and returns only public account identifiers, relay and connection state.

`tests/vault-wallet.test.ts` checks exact public output shapes with nested wallet,
NIP-46 and PQ secrets present, future-field exclusion, detached configuration
copies, and locked/missing/non-remote capability refusal. The Nostr Connect
integration suite covers actual remote signing through the credential accessor;
`tests/publish-handlers.test.ts` covers the public session-info response.

The CI workflow limits its token to `contents: read` and pins checkout and Node
setup to commit SHAs verified against the official action repositories' v4 tags.
