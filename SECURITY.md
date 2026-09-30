# Security policy

## Report a vulnerability privately

Use [GitHub's private vulnerability report form](https://github.com/nostr-wot/nostr-wot-extension/security/advisories/new). Do not disclose exploit details in a public issue or pull request.

Include the affected extension version or commit, browser and operating system versions, account/provider type, reproduction steps, expected and actual behavior, and the security impact. Use disposable accounts and synthetic invoices when demonstrating a problem. Never include real seed phrases, private keys, passwords, wallet API keys, NWC secrets, or live payment credentials. Coordinate public disclosure with the maintainers through the private report.

## Supported versions and scope

Security fixes target the latest published extension release and current development on `main`. Update to the [latest release](https://github.com/nostr-wot/nostr-wot-extension/releases); historical versions do not have a guaranteed backport policy. Reports about older versions are still useful when they identify an issue in current code.

Use a browser that receives security updates from its vendor. Chrome/Chromium and Firefox use separate release packages and background runtimes. The source manifest requires Firefox desktop 140+ and Firefox Android 142+; those installation minimums do not mean every older browser release remains safe or supported. Safari uses a separate native wrapper and platform build, not the Chrome archive. Browser-specific testing matters: Node tests cannot establish compatibility or security on every browser. Node is a development/build dependency, not an end-user requirement; see [contributing](CONTRIBUTING.md) and [testing](docs/testing.md).

This policy covers the extension's code and its integration boundaries. A relay, remote signer, LNbits instance, NWC wallet, oracle, website, or provisioning server is a separate system. The extension does not establish the security of their deployment, operators, storage, or balances. Report extension-side handling failures here; coordinate vulnerabilities in a separate service with that project's maintainers.

## Trust assumptions and key custody

The design assumes a trustworthy browser, operating system, extension installation, and cryptographic random-number generator. Hostile websites, relays and malformed responses are part of the threat model. A compromised device, browser, extension update, or same-origin website script can exceed these boundaries. Site permissions distinguish origins, not individual scripts within an origin.

Locally generated or imported signing keys are encrypted in the local vault. Normal signing uses them locally and returns a signature, not the private key. Explicit export, backup and reveal actions can disclose secrets to the user; protect those outputs separately.

NIP-46 accounts use a configured remote signer that holds the signing key; the extension retains connection credentials. A returned signature must match the expected author and the complete approved event, but this cannot stop a remote signer from using a key it controls independently. External signers and wallet providers have their own key custody and authorization models.

## Vault and memory protection

Password-protected vaults use AES-256-GCM with PBKDF2-HMAC-SHA-256 at 600,000 iterations, a random 32-byte salt, and a fresh 12-byte IV per encryption. The stored record carries its work factor; older password-protected records are upgraded on successful unlock. Encryption resists offline access only to the extent that the password remains secret and sufficiently strong.

**“Never lock” uses a known empty password and automatically unlocks on startup.** Its encrypted format and 210,000-iteration KDF do not provide password secrecy against someone who can read the stored vault. Choose a password-protected timed-lock mode when that threat matters.

The default inactivity lock is 15 minutes. Locking invalidates account sessions, clears vault references, zeroes retained secret byte arrays and disposes active wallet/remote-signer sessions. Local key operations use `withPrivkey()` to zero the temporary copy on success or failure. JavaScript strings, garbage-collected copies and browser-managed memory cannot be reliably erased; zeroing is exposure reduction, not a secure-memory guarantee.

Wallet credentials are stored in the encrypted vault and omitted from ordinary account metadata. Privileged settings/export flows can intentionally reveal them. Financial display caches and payment results use encrypted storage protected by the vault; wallet display records are keyed per account, while payment results are keyed by intent ID. Some public metadata, settings and replay-prevention markers remain outside those encrypted records. See [security architecture](docs/security.md) for the storage boundaries.

## Website authorization and authentication

Content-script method allowlists and background sender checks separate page APIs from privileged extension operations. Page identity comes from browser sender information, not a page-supplied origin. Authentication requires a verified top-level frame and secure origins/transports, with explicit loopback development exceptions.

Ordinary signing permissions may be shared across accounts or isolated per account, according to settings. Saved allowances can avoid a new prompt; connecting a site also grants access to the active public identity. Authentication has a separate account-specific gate:

- NIP-98 consent binds the requesting origin, account, exact signed URL including query, and HTTP method, including for same-origin requests. Legacy origin-wide HTTP allowances require new consent; legacy denials retain their scope.
- NIP-42 consent binds the account and full relay URL. An explicit all-connected-sites grant applies only to that relay and account. The relay must validate the challenge for its actual connection.
- Optional `origin` and reserved `client-origin` tags must agree with the browser-derived caller. They are signed metadata, **not browser or extension attestation**.

The signer checks event snapshots, permissions and account/session validity around approval and unlock. Remote results also require event equality and signature verification. Generic page signing cannot mint native wallet provisioning or username-mutation tokens for the default `https://zaps.nostr-wot.com` endpoints. See [signer behavior](docs/signer.md) and the [backend](docs/guides/backend-authentication.md) and [relay](docs/guides/relay-authentication.md) guides.

These checks do not make a backend trustworthy or force it to validate tokens correctly. A holder of fresh authentication material can forward it to its intended audience; exact URL/body binding, CORS and replay prevention do not prove the holder's identity or prevent all first-use forwarding.

## Wallet outcomes and network privacy

The native wallet v2 flow signs the exact operation-body hash, audience, method, challenge and transaction-token hash. The backend must enforce those bindings and single use. Third-party wallets remain responsible for executing payments and reporting their state.

NWC responses require the configured wallet's signature, decryption, request correlation and matching result type. A successful payment additionally requires a 32-byte preimage whose SHA-256 matches the requested invoice's payment hash. A malformed or mismatched success remains `PAYMENT_OUTCOME_UNKNOWN`; it is not treated as proof that funds did not move. Published payments are not automatically replayed, and unknown LNURL intents retain replay protection. Inspect wallet history before starting a deliberately new payment.

Requested operations disclose data to their destinations: wallet providers receive payment requests, remote signers receive delegated operations, and relays or lookup services receive relevant queries/events and network metadata. Encryption of stored credentials or message content does not provide anonymity or eliminate metadata leakage. Public-key identity and activity may be linkable across sites and services.

## Dependencies and cryptographic limits

The extension bundles runtime dependencies, including noble/scure cryptographic libraries, `nostr-tools`, React and other UI packages. It does not implement every primitive itself. Use the committed lockfile and the documented build process; dependency integrity checks and tests do not guarantee a safe supply chain or constitute an independent audit of this extension.

Post-quantum encryption is an opt-in hybrid protocol with separate interoperability and implementation assumptions. It does not retrofit protection onto old classical ciphertext, replace Nostr's secp256k1 event signatures, or guarantee permanent confidentiality. See the [protocol drafts](nips/pqc/README.md) and [security architecture](docs/security.md) for the construction and its limits.
