import { KNOWN_BIP44_NETWORKS, BITCOIN_PATH_PURPOSES } from '@constants/derivation.ts';
import { MAX_BIP32_PATH_LENGTH, MAX_BIP32_DEPTH, MAX_BIP32_INDEX, NIP06_ACCOUNT_PREFIX } from '@constants/crypto/bip32.ts';

/** Canonical private BIP-32 path; apostrophe, h and H denote hardened children. */
export function normalizeDerivationPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_BIP32_PATH_LENGTH) return null;
  const parts = value.trim().split('/');
  if (parts.shift() !== 'm' || parts.length > MAX_BIP32_DEPTH) return null;
  const canonical: string[] = [];
  for (const part of parts) {
    const match = /^(\d+)(['hH]?)$/.exec(part);
    if (!match) return null;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index > MAX_BIP32_INDEX) return null;
    canonical.push(String(index) + (match[2] ? "'" : ''));
  }
  return ['m', ...canonical].join('/');
}

/** Only the existing NIP-06 sequence has a numeric account index. */
export function standardDerivationIndex(path: string): number | null {
  const canonical = normalizeDerivationPath(path);
  if (!canonical?.startsWith(NIP06_ACCOUNT_PREFIX)) return null;
  const suffix = canonical.slice(NIP06_ACCOUNT_PREFIX.length);
  return /^\d+$/.test(suffix) ? Number(suffix) : null;
}


/** Identifies a registered prefix, not wallet compatibility or a complete wallet layout. */
export function identifyDerivationPath(value: string): { network: string; convention: string } | null {
  const path = normalizeDerivationPath(value);
  const match = path && /^m\/(\d+)'\/(\d+)'(?:\/|$)/.exec(path);
  if (!match) return null;
  const purpose = Number(match[1]), coin = Number(match[2]);
  if (purpose === 44 && KNOWN_BIP44_NETWORKS[coin]) {
    return { network: KNOWN_BIP44_NETWORKS[coin], convention: coin === 1237 ? 'NIP-06' : 'BIP-44' };
  }
  if (BITCOIN_PATH_PURPOSES[purpose] && (coin === 0 || coin === 1)) {
    return { network: coin === 0 ? 'Bitcoin' : 'Bitcoin testnet', convention: BITCOIN_PATH_PURPOSES[purpose] };
  }
  return null;
}
