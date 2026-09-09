// ── BOLT11 tagged field types (5-bit values) ──
// 'p' → 1: payment hash
// 'd' → 13: description (short)
// 'h' → 23: description hash (for long descriptions)
// 'x' → 6: expiry in seconds
// 'n' → 19: payee node pubkey

export const TAG_PAYMENT_HASH = 1;

export const TAG_DESCRIPTION = 13;

export const TAG_EXPIRY = 6;

// ── Amount multipliers → sats ──
// 1 BTC = 100_000_000 sats
export const MULTIPLIERS: Record<string, number> = {
  m: 100_000,      // milli-BTC
  u: 100,          // micro-BTC
  n: 0.1,          // nano-BTC
  p: 0.0001,       // pico-BTC
};
