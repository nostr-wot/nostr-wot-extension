// ── Address parsing ──

// LUD-16 keeps the local part to `a-z0-9-_.` (lowercase). Domains are the
// usual dot-separated labels; a trailing dot or an empty label is rejected.
export const LOCAL_PART = /^[a-z0-9-_.]+$/;

export const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// ── URL safety ──

export const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./;
