import { TAG_PAYMENT_HASH, TAG_DESCRIPTION, TAG_EXPIRY } from '@constants/bolt11.ts';
/**
 * Lightweight BOLT11 invoice decoder
 *
 * Extracts amount, description, and expiry from Lightning invoices.
 * Uses the existing bech32 infrastructure from @scure/base.
 *
 * @see https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
 *
 * @module domain/wallet/bolt11
 */

import { bech32Decode, convertBits } from '../../lib/crypto/bech32.ts';

export interface DecodedInvoice {
  amountSats: number | null;
  amountMsats: number | null;
  descriptionHash: string | null;
  description: string | null;
  expiry: number;           // seconds, default 3600
  paymentHash: string | null;
  network: string;          // 'bc' (mainnet), 'tb' (testnet), 'bcrt' (regtest)
  timestamp: number;
}

/**
 * Parse the amount from the BOLT11 HRP.
 * HRP format: ln{network}{amount}{multiplier}
 * Examples: lnbc1m, lnbc2500u, lnbc100n, lnbc (no amount)
 */
function parseAmount(hrp: string): { amountSats: number | null; amountMsats: number | null; network: string } | null {
  const match = /^ln(bcrt|bc|tb)(?:([0-9]+)([munp]?))?$/.exec(hrp);
  if (!match) return null;
  const network = match[1];
  if (!match[2]) return { amountSats: null, amountMsats: null, network };
  // Convert directly to integer millisatoshis; 10 pBTC = 1 msat.
  const factors: Record<string, bigint> = { '': 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n };
  const value = BigInt(match[2]);
  if (match[3] === 'p' && value % 10n !== 0n) return null;
  const msats = match[3] === 'p' ? value / 10n : value * factors[match[3]];
  if (msats <= 0n || msats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const amountMsats = Number(msats);
  return { amountSats: amountMsats / 1000, amountMsats, network };
}

/**
 * Read an integer from 5-bit words (big-endian).
 */
function wordsToInt(words: number[]): number {
  let val = 0;
  for (const w of words) {
    val = val * 32 + w;
  }
  return val;
}

/**
 * Convert 5-bit words to a UTF-8 string.
 */
function wordsToUtf8(words: number[]): string {
  const bytes = convertBits(words, 5, 8, false);
  if (!bytes) return '';
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Convert 5-bit words to hex string.
 */
function wordsToHex(words: number[]): string {
  const bytes = convertBits(words, 5, 8, false);
  if (!bytes) return '';
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a BOLT11 Lightning invoice string.
 * Returns null if the invoice is invalid or not a Lightning invoice.
 */
export function decodeBolt11(invoice: string): DecodedInvoice | null {
  const trimmed = invoice.trim();
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) return null;
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('lnbc') && !lower.startsWith('lntb') && !lower.startsWith('lnbcrt')) {
    return null;
  }

  const decoded = bech32Decode(lower);
  if (!decoded) return null;

  const amount = parseAmount(decoded.hrp);
  if (!amount) return null;
  const { amountSats, amountMsats, network } = amount;
  const words = decoded.data;

  // Timestamp is seven 5-bit words; signature needs another 104 words.
  if (words.length < 111) return null;
  const timestamp = wordsToInt(words.slice(0, 7));

  // Parse tagged fields (after timestamp, before signature)
  // Signature = last 104 five-bit words (65 bytes: 64 sig + 1 recovery)
  const dataEnd = words.length - 104;
  let i = 7;

  let description: string | null = null;
  let descriptionHash: string | null = null;
  let expiry = 3600; // default
  let paymentHash: string | null = null;

  while (i < dataEnd) {
    if (i + 3 > dataEnd) return null;

    const tag = words[i];
    const dataLength = words[i + 1] * 32 + words[i + 2];
    i += 3;

    if (i + dataLength > dataEnd) return null;

    const fieldWords = words.slice(i, i + dataLength);

    switch (tag) {
      case 23: // BOLT11 h tag
        if (descriptionHash !== null || dataLength !== 52) return null;
        descriptionHash = wordsToHex(fieldWords);
        if (descriptionHash.length !== 64) return null;
        break;
      case TAG_DESCRIPTION:
        description = wordsToUtf8(fieldWords);
        break;
      case TAG_EXPIRY:
        expiry = wordsToInt(fieldWords);
        break;
      case TAG_PAYMENT_HASH:
        paymentHash = wordsToHex(fieldWords);
        break;
    }

    i += dataLength;
  }

  return { amountSats, amountMsats, descriptionHash, description, expiry, paymentHash, network, timestamp };
}
