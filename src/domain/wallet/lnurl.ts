import { LOCAL_PART, DOMAIN, PRIVATE_IPV4 } from '@constants/lnurl.ts';
import { bech32 } from '@scure/base';

export interface LnurlPayParams {
  /** Normalized Lightning Address or bech32 LNURL this was resolved from. */
  address: string;
  /** Domain the invoice will come from — show this to the user. */
  domain: string;
  /** Invoice callback URL (https, validated). */
  callback: string;
  /** Minimum payable amount, msats. */
  minSendable: number;
  /** Maximum payable amount, msats. */
  maxSendable: number;
  /** Raw LUD-06 metadata string. */
  metadata: string;
  /** `text/plain` entry from the metadata, if any. */
  description: string | null;
  /** Max comment length (LUD-12); 0 means comments are not accepted. */
  commentAllowed: number;
  /** Endpoint advertises NIP-57 zap support (LUD-21 / NIP-57). */
  allowsNostr: boolean;
  /** Zap-receipt signing pubkey, when `allowsNostr`. */
  nostrPubkey: string | null;
}

export interface ResolvedInvoice {
  bolt11: string;
  /** Amount encoded in the invoice — already checked against the request. */
  amountSats: number;
}

/**
 * Split a Lightning Address into its parts, lowercasing as LUD-16 requires.
 * Returns null for anything that is not a plausible address — this is the
 * function the UI uses to tell "invoice" from "address", so it must not throw.
 */
export function parseLightningAddress(input: string): { name: string; domain: string } | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 320) return null;

  // Telling an address from an invoice or an LNURL string is the `@` below, not
  // a prefix test on the whole input: bech32 has no `@`, so an invoice can never
  // reach the rest of this function. Prefix-matching rejected real addresses —
  // anyone at a domain starting "lnbc", and every local part beginning "lnurl"
  // (lnurlpay@…, lnurl@…), which are ordinary names.
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return null;

  const name = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!LOCAL_PART.test(name) || name.startsWith('.') || name.endsWith('.')) return null;
  if (!DOMAIN.test(domain)) return null;

  return { name, domain };
}

/** True when the input looks like a Lightning Address rather than an invoice. */
export function isLightningAddress(input: string): boolean {
  return parseLightningAddress(input) !== null;
}

/**
 * Build the LUD-16 well-known URL for an address.
 * @throws if the address is not a valid Lightning Address.
 */
export function lightningAddressToLnurlpUrl(address: string): string {
  const parsed = parseLightningAddress(address);
  if (!parsed) throw new Error('Not a valid Lightning Address');
  return `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.name)}`;
}

/** Decode a LUD-01 LNURL or lightning: link, preserving the URL's case.
 * Invalid checksums, mixed case and malformed UTF-8 are never normalized away.
 * URL safety is checked by fetchPayParams before any request.
 */
export function parseLnurl(input: string): { encoded: string; url: string } | null {
  if (typeof input !== 'string') return null;
  const encoded = input.trim().replace(/^lightning:/i, '');
  if (!/^lnurl1/i.test(encoded) || encoded.length > 2000) return null;
  try {
    const decoded = bech32.decode(encoded as `${string}1${string}`, 2000);
    if (decoded.prefix !== 'lnurl') return null;
    const url = new TextDecoder('utf-8', { fatal: true }).decode(bech32.fromWords(decoded.words));
    return { encoded: encoded.toLowerCase(), url };
  } catch {
    return null;
  }
}

/**
 * Refuse anything that is not a plain HTTPS request to a public host.
 *
 * The pay-params host comes from a pasted address and the callback host comes
 * from that server's response, so both are untrusted. Without this a pasted
 * "address" turns the background worker into a probe for the user's LAN and
 * for link-local metadata services.
 *
 * @throws if the URL is unusable or points somewhere non-public.
 */
export function assertPublicHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('LNURL: malformed URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('LNURL: refusing non-HTTPS endpoint');
  }

  if (parsed.username || parsed.password) {
    throw new Error('LNURL: refusing URL credentials');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('LNURL: refusing local endpoint');
  }
  if (PRIVATE_IPV4.test(host)) {
    throw new Error('LNURL: refusing private-network endpoint');
  }
  // Any bare IP literal is refused outright, which is also what covers every
  // private IPv6 range (::1, fc00::/7, fe80::/10): an IPv6 literal is the only
  // hostname that can contain a colon.
  //
  // This deliberately does NOT prefix-match the hostname for "fc"/"fd". That
  // test was meant for unique-local addresses but ran against every hostname,
  // so it rejected real domains — fdn.fr, fc2.com, fdroid.org — as
  // "private-network" endpoints. Prefix-matching a name for an address range
  // is a category error; requiring a name at all is the actual defence.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    throw new Error('LNURL: refusing bare IP endpoint — use a domain');
  }

  return parsed;
}
