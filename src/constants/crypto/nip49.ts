export const VERSION_V2: number = 0x02;

export const VERSION_LEGACY: number = 0x01;

export const DEFAULT_LOG_N: number = 16;

export const MAX_LOG_N: number = 22;

export const SCRYPT_R: number = 8;

export const SCRYPT_P: number = 1;

// Blocks of headroom added to scrypt's `maxmem` beyond the N + p blocks the algorithm
// needs for its V table and B block. `@noble/hashes` charges `maxmem` for its own
// scratch space too, and says so in its source: "Node requires more headroom here, so
// this accounting is intentionally noble-specific". That accounting has already moved
// once — 2.0.1 charged 128·r·(N + p), 2.2.0 onwards charges one block more — and the
// declared `^2.0.1` range admits both, so a bound sitting exactly on either line is one
// release away from refusing every key backup. Four blocks is 4 KiB at r = 8, next to a
// V table of N blocks: too little to matter, enough to absorb the next revision.
// `maxmem` is not the defence against an expensive backup, because it is computed from
// the cost factor in the payload and so can never reject it; MAX_LOG_N is.
export const SCRYPT_MAXMEM_SLACK_BLOCKS: number = 4;

// key_security_byte 0x02 = "client does not track this data" per NIP-49
export const KEY_SECURITY_UNKNOWN: number = 0x02;

export const V2_PAYLOAD_LENGTH: number = 1 + 1 + 16 + 24 + 1 + 48;

// 91 bytes

export const LEGACY_PBKDF2_ITERATIONS: number = 210000;
