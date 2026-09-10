/** Derivation profile identifier. Bump when the derivation changes. */
export const PQ_PROFILE: string = 'nip-pqc/v1';

/** Algorithm identifiers as they appear in the attestation event. */
export const ALG_KEM: string = 'ml-kem-1024';

export const ALG_DSA: string = 'ml-dsa-87';

/** Public key sizes in bytes, per FIPS 203 / 204. Used to reject malformed keys. */
export const KEM_PUBLIC_KEY_BYTES: number = 1568;

export const DSA_PUBLIC_KEY_BYTES: number = 2592;

export const KEM_SEED_BYTES = 64; // ML-KEM keygen takes d || z

export const DSA_SEED_BYTES = 32; // ML-DSA keygen takes xi

/** Secret key sizes in bytes, per FIPS 203 / 204. */
export const KEM_SECRET_KEY_BYTES: number = 3168;

export const DSA_SECRET_KEY_BYTES: number = 4896;

export const ENVELOPE_VERSION = 0x01;

export const ALG_MLKEM1024_XCHACHA = 0x01;

export const KEM_CIPHERTEXT_BYTES = 1568;

export const NONCE_BYTES = 24;

export const TAG_BYTES = 16;

export const HEADER_BYTES = 2 + KEM_CIPHERTEXT_BYTES + NONCE_BYTES;

export const MAX_PLAINTEXT_BYTES = 65535;

export const PQ_MAX_ENVELOPE_BYTES = HEADER_BYTES + TAG_BYTES + 2 + 65536;
export const PQ_MAX_ENCODED_LENGTH = Math.ceil(PQ_MAX_ENVELOPE_BYTES / 3) * 4;
