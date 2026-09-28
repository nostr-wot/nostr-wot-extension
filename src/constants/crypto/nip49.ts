export const VERSION_V2: number = 0x02;

export const VERSION_LEGACY: number = 0x01;

export const DEFAULT_LOG_N: number = 16;

export const MAX_LOG_N: number = 22;

export const SCRYPT_R: number = 8;

export const SCRYPT_P: number = 1;

// key_security_byte 0x02 = "client does not track this data" per NIP-49
export const KEY_SECURITY_UNKNOWN: number = 0x02;

export const V2_PAYLOAD_LENGTH: number = 1 + 1 + 16 + 24 + 1 + 48;

// 91 bytes

export const LEGACY_PBKDF2_ITERATIONS: number = 210000;
