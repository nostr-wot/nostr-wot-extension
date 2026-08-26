/**
 * LNURL-pay resolution for Lightning Addresses (LUD-16 → LUD-06)
 *
 * A Lightning Address (`name@domain`) is sugar for an LNURL-pay endpoint at
 * `https://{domain}/.well-known/lnurlp/{name}`. Paying one is two round trips:
 *
 *   1. GET  https://{domain}/.well-known/lnurlp/{name}   → pay params
 *   2. GET  {callback}?amount={msats}&comment={text}      → { pr: <bolt11> }
 *
 * Both URLs are attacker-influenced — the user pastes the address, and the
 * *server* picks the callback. This module runs in the background service
 * worker, next to the wallet's admin key, so every hop is constrained:
 * HTTPS only, no private/loopback hosts, and the amount the server encodes
 * into the invoice is verified against the amount the user approved. The
 * caller still decides whether to pay; this module only produces an invoice
 * it has checked.
 *
 * @see https://github.com/lnurl/luds/blob/luds/16.md (Lightning Address)
 * @see https://github.com/lnurl/luds/blob/luds/06.md (payRequest)
 * @see https://github.com/lnurl/luds/blob/luds/12.md (comment)
 *
 * @module lib/wallet/lnurl
 */

import { decodeBolt11 } from './bolt11.ts';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Cap on the pay-params body, so a hostile server cannot stream forever. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface LnurlPayParams {
  /** Normalised `name@domain` this was resolved from. */
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

// ── Address parsing ──

// LUD-16 keeps the local part to `a-z0-9-_.` (lowercase). Domains are the
// usual dot-separated labels; a trailing dot or an empty label is rejected.
const LOCAL_PART = /^[a-z0-9-_.]+$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Split a Lightning Address into its parts, lowercasing as LUD-16 requires.
 * Returns null for anything that is not a plausible address — this is the
 * function the UI uses to tell "invoice" from "address", so it must not throw.
 */
export function parseLightningAddress(input: string): { name: string; domain: string } | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 320) return null;
  if (trimmed.startsWith('lnurl') || trimmed.startsWith('lnbc')) return null;

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

// ── URL safety ──

const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./;

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

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('LNURL: refusing local endpoint');
  }
  if (PRIVATE_IPV4.test(host)) {
    throw new Error('LNURL: refusing private-network endpoint');
  }
  // IPv6 loopback / unique-local / link-local, and any bare IP literal.
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    throw new Error('LNURL: refusing private-network endpoint');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    throw new Error('LNURL: refusing bare IP endpoint — use a domain');
  }

  return parsed;
}

// ── Fetch helpers ──

async function fetchJson(
  url: string,
  fetchFn: FetchFn,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, { redirect: 'follow', headers: { Accept: 'application/json' } });
  } catch {
    // Network failure, DNS failure, or a server that refuses cross-origin
    // reads. All three look identical from here; say so instead of leaking a
    // browser-specific message into the UI.
    throw new Error('LNURL: could not reach the endpoint');
  }
  if (!res.ok) {
    throw new Error(`LNURL: endpoint returned ${res.status}`);
  }

  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error('LNURL: response too large');
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('LNURL: endpoint did not return JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('LNURL: endpoint did not return JSON');
  }

  const obj = body as Record<string, unknown>;
  // LUD-06 error shape: { status: "ERROR", reason: "..." }
  if (typeof obj.status === 'string' && obj.status.toUpperCase() === 'ERROR') {
    const reason = typeof obj.reason === 'string' && obj.reason.trim()
      ? obj.reason.trim().slice(0, 200)
      : 'request rejected';
    throw new Error(`LNURL: ${reason}`);
  }

  return obj;
}

/** Pull the `text/plain` line out of the LUD-06 metadata array. */
function descriptionFromMetadata(metadata: string): string | null {
  try {
    const entries = JSON.parse(metadata) as unknown;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      if (Array.isArray(entry) && entry[0] === 'text/plain' && typeof entry[1] === 'string') {
        return entry[1].slice(0, 500);
      }
    }
  } catch {
    // Malformed metadata is not fatal — the payment still works without a description.
  }
  return null;
}

// ── Public API ──

/**
 * Resolve a Lightning Address to its LNURL-pay parameters.
 *
 * @param address - `name@domain`
 * @param fetchFn - Optional fetch override for testing
 * @throws if the address, the endpoint, or the response is invalid.
 */
export async function fetchPayParams(
  address: string,
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<LnurlPayParams> {
  const parsed = parseLightningAddress(address);
  if (!parsed) throw new Error('Not a valid Lightning Address');

  const url = lightningAddressToLnurlpUrl(address);
  assertPublicHttpsUrl(url);
  const body = await fetchJson(url, fetchFn);

  if (body.tag !== 'payRequest') {
    throw new Error('LNURL: endpoint is not a pay request');
  }

  const callback = typeof body.callback === 'string' ? body.callback : '';
  assertPublicHttpsUrl(callback);

  const minSendable = Number(body.minSendable);
  const maxSendable = Number(body.maxSendable);
  if (!Number.isFinite(minSendable) || !Number.isFinite(maxSendable)
    || minSendable <= 0 || maxSendable < minSendable) {
    throw new Error('LNURL: endpoint returned an invalid sendable range');
  }

  const metadata = typeof body.metadata === 'string' ? body.metadata : '';
  const commentRaw = Number(body.commentAllowed);
  const commentAllowed = Number.isFinite(commentRaw) && commentRaw > 0
    ? Math.min(Math.floor(commentRaw), 1000)
    : 0;

  return {
    address: `${parsed.name}@${parsed.domain}`,
    domain: parsed.domain,
    callback,
    minSendable,
    maxSendable,
    metadata,
    description: descriptionFromMetadata(metadata),
    commentAllowed,
    allowsNostr: body.allowsNostr === true,
    nostrPubkey: typeof body.nostrPubkey === 'string' ? body.nostrPubkey : null,
  };
}

/**
 * Ask the LNURL callback for an invoice for `amountSats`.
 *
 * The returned invoice is decoded and its amount compared to the requested
 * amount before it is handed back: the user approves a number in the popup,
 * and the server must not be able to substitute a different one. An invoice
 * with no amount is refused for the same reason.
 *
 * @param params - Pay params from {@link fetchPayParams}
 * @param amountSats - Amount the user approved
 * @param comment - Optional LUD-12 comment; truncated to `commentAllowed`
 * @param fetchFn - Optional fetch override for testing
 */
export async function requestInvoice(
  params: LnurlPayParams,
  amountSats: number,
  comment?: string,
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<ResolvedInvoice> {
  if (!Number.isFinite(amountSats) || !Number.isInteger(amountSats) || amountSats <= 0) {
    throw new Error('LNURL: amount must be a positive whole number of sats');
  }

  const amountMsats = amountSats * 1000;
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    const min = Math.ceil(params.minSendable / 1000);
    const max = Math.floor(params.maxSendable / 1000);
    throw new Error(`LNURL: amount must be between ${min} and ${max} sats`);
  }

  const url = assertPublicHttpsUrl(params.callback);
  url.searchParams.set('amount', String(amountMsats));
  if (comment && params.commentAllowed > 0) {
    url.searchParams.set('comment', comment.slice(0, params.commentAllowed));
  }

  const body = await fetchJson(url.toString(), fetchFn);

  const bolt11 = typeof body.pr === 'string' ? body.pr.trim() : '';
  if (!bolt11) {
    throw new Error('LNURL: callback did not return an invoice');
  }

  const decoded = decodeBolt11(bolt11);
  if (!decoded) {
    throw new Error('LNURL: callback returned an undecodable invoice');
  }
  if (decoded.amountSats === null) {
    throw new Error('LNURL: callback returned an amountless invoice');
  }
  if (Math.round(decoded.amountSats) !== amountSats) {
    throw new Error(
      `LNURL: invoice is for ${Math.round(decoded.amountSats)} sats, not the ${amountSats} sats requested`,
    );
  }

  return { bolt11, amountSats };
}
