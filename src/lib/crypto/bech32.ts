/**
 * Bech32 / Bech32m Encoding and Decoding for Nostr
 *
 * Uses @scure/base for bech32 codec, keeps Nostr-specific TLV logic.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md — NIP-19
 *
 * @module lib/crypto/bech32
 */

import { bech32 as _bech32 } from '@scure/base';
import {
  npubEncode as sharedNpubEncode,
  npubDecode as sharedNpubDecode,
  nsecEncode as sharedNsecEncode,
  nsecDecode as sharedNsecDecode,
} from '@nostr-wot/accounts';
import { hexToBytes, bytesToHex, concatBytes } from './utils.ts';

/**
 * Convert between bit groups
 */
export function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << to) - 1;

  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (to - bits)) & maxv);
    }
  } else {
    if (bits >= from) return null;
    if ((acc << (to - bits)) & maxv) return null;
  }

  return result;
}

/**
 * Encode data as bech32
 */
export function bech32Encode(hrp: string, data5bit: number[]): string {
  const words = new Uint8Array(data5bit);
  return _bech32.encode(hrp, words, 5000);
}

/**
 * Decode a bech32 string (tries bech32, no bech32m needed for Nostr NIP-19)
 */
export function bech32Decode(str: string): { hrp: string; data: number[] } | null {
  try {
    const decoded = _bech32.decode(str as `${string}1${string}`, 5000);
    return { hrp: decoded.prefix, data: Array.from(decoded.words) };
  } catch {
    return null;
  }
}

// ── Nostr-specific helpers ──

/*
 * The four NIP-19 identity entities come from `@nostr-wot/accounts`: they are account
 * primitives, and a second decoder for an npub is a second opinion about whether a
 * checksum holds. What stays here is the bech32 plumbing the package does not carry —
 * `convertBits` and the nprofile TLV, which belong with the data layer rather than with
 * accounts, and `normalizeToHex`, which is this extension's own input-box convenience.
 *
 * The signatures are the extension's: hex strings in and out. `nsecDecode` in particular
 * returns hex where the package returns bytes, because every call site here goes on to
 * store or compare a hex string; the bytes the package hands back are zeroed on the way.
 */

export function npubEncode(pubkey: string | Uint8Array): string {
  return sharedNpubEncode(pubkey);
}

export function npubDecode(npub: string): string {
  return sharedNpubDecode(npub);
}

export function nsecEncode(privkey: string | Uint8Array): string {
  return sharedNsecEncode(privkey);
}

/** The private key as hex. The bytes the package returns are zeroed before this returns. */
export function nsecDecode(nsec: string): string {
  const bytes = sharedNsecDecode(nsec);
  try {
    return bytesToHex(bytes);
  } finally {
    bytes.fill(0);
  }
}

export function nprofileEncode(pubkey: string, relays: string[] = []): string {
  const pubkeyBytes = hexToBytes(pubkey);
  const parts: Uint8Array[] = [new Uint8Array([0x00, 32]), pubkeyBytes];

  for (const relay of relays) {
    const relayBytes = new TextEncoder().encode(relay);
    if (relayBytes.length > 255) {
      throw new Error(`Relay URL exceeds 255-byte TLV limit: ${relay}`);
    }
    parts.push(new Uint8Array([0x01, relayBytes.length]));
    parts.push(relayBytes);
  }

  const tlv = concatBytes(...parts);
  const data = convertBits(Array.from(tlv), 8, 5, true);
  return bech32Encode('nprofile', data!);
}

export function nprofileDecode(nprofile: string): { pubkey: string; relays: string[] } {
  const decoded = bech32Decode(nprofile);
  if (!decoded || decoded.hrp !== 'nprofile') throw new Error('Invalid nprofile');
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes) throw new Error('Invalid nprofile data');

  let pubkey: string | null = null;
  const relays: string[] = [];
  let i = 0;
  const data = new Uint8Array(bytes);

  while (i < data.length) {
    const type = data[i];
    const len = data[i + 1];
    i += 2;

    if (i + len > data.length) throw new Error('TLV overflow');

    const value = data.slice(i, i + len);
    if (type === 0x00 && len === 32) {
      pubkey = bytesToHex(value);
    } else if (type === 0x01) {
      relays.push(new TextDecoder().decode(value));
    }
    i += len;
  }

  if (!pubkey) throw new Error('No pubkey in nprofile');
  return { pubkey, relays };
}

export function normalizeToHex(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  input = input.trim();

  if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase();

  if (input.startsWith('npub1')) {
    try { return npubDecode(input); } catch { return null; }
  }

  if (input.startsWith('nprofile1')) {
    try { return nprofileDecode(input).pubkey; } catch { return null; }
  }

  return null;
}
