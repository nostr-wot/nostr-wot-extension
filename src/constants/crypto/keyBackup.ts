/**
 * Password-encrypted backup files.
 *
 * The format the popup writes when you choose "download encrypted" for a seed
 * phrase or a post-quantum key file. AES-256-GCM under a PBKDF2-SHA-256 key, in
 * a small JSON envelope:
 *
 *   { "v": 1, "salt": base64, "iv": base64, "ct": base64 }
 *
 * This lived inline in the seed-export modal, which meant nothing verified that
 * what it wrote could ever be read back — in a key-custody extension, where the
 * file is the last copy of something a user cannot reconstruct. It is here
 * because a second export (post-quantum key files) needs exactly the same
 * envelope, and because a round-trip is only testable once the two halves exist
 * in one place.
 *
 * The work factor is deliberately the legacy 210,000 rather than the vault's
 * 600,000, so files written by earlier builds stay readable: the envelope has no
 * iterations field to read a different count out of. Raising it means adding
 * that field and defaulting its absence to 210,000, the same migration the vault
 * already did.
 *
 * @module constants/crypto/keyBackup
 */

export const PBKDF2_ITERATIONS = 210000;

export const SALT_BYTES = 16;

export const IV_BYTES = 12;
