# Encrypted private caches

Wallet display records, activity history, automatic-payment reservations and completed payment retry results are encrypted using AES-256-GCM with a fresh 96-bit nonce per write. A random 256-bit cache key is stored inside the password-encrypted vault. It is independent of signing keys and remains stable across password changes. Cache operations do not reset auto-lock timers.

The authenticated additional data includes a versioned namespace and storage record name. Copying ciphertext between account records fails authentication. Decryption errors propagate rather than becoming an empty budget/history. The key is never sent to the popup. The UI uses the internal wallet_readDisplayCache RPC, then refreshes network data; while locked only provider presence is available. Financial/settings UI state and open activity/menu details clear on lock notifications.

Legacy wallet records (including unopened accounts) and activity history are encrypted on unlock, after the new cache key is durably saved. Failed migration leaves the original data available for a later retry and never returns ciphertext as a decoded record. Until a successful unlock/migration, legacy plaintext may remain on disk. Existing completed session payment results migrate too. New sensitive activity is not recorded while locked; this avoids retaining plaintext merely to encrypt it later.

Intent IDs, timestamps and in-flight/done markers remain in session storage to prevent accidental duplicate sends. Results are encrypted. If a payment completes after lock and its result cannot be encrypted, its in-flight marker stays: retrying cannot dispatch a second payment. Vault destruction clears private local records and session intents; account removal clears its wallet display record. Budget reservations are intentionally conservative after disconnect/reconnect so replacing a provider cannot reset spending authorization.

The never-lock configuration automatically decrypts with its known empty password. Encryption therefore provides limited protection from local access in that mode. Nor does encryption at rest protect against a compromised running extension or erase immutable JavaScript string copies. Provider presence, public profiles, permission identities and rejection notices remain outside this cache; their privacy characteristics have not changed.

Regression coverage is in tests/private-cache-regressions.ts, imported by tests/security-hardening.test.ts, plus wallet, activity and vault suites.
