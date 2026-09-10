import { LNURL_MAX_RESPONSE_BYTES as MAX_RESPONSE_BYTES, LNURL_REQUEST_TIMEOUT_MS as REQUEST_TIMEOUT_MS } from '@constants/wallet.ts';
import { decodeBolt11 } from '../../domain/wallet/bolt11.ts';
import {
  parseLightningAddress,
  parseLnurl,
  lightningAddressToLnurlpUrl,
  assertPublicHttpsUrl,
  type LnurlPayParams,
  type ResolvedInvoice,
} from '../../domain/wallet/lnurl.ts';

import type { FetchFn } from '@services/http/types.ts';

// ── Fetch helpers ──

/**
 * Read a response body, giving up as soon as it exceeds {@link MAX_RESPONSE_BYTES}.
 *
 * The cap has to be enforced *while* reading. Buffering first and measuring
 * afterwards means a hostile endpoint has already been allowed to stream an
 * unbounded body into the service worker — the check would then only decline to
 * parse what it had finished downloading.
 */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('LNURL: response too large');
  }

  // No stream to read incrementally (a test double, or a browser that gives no
  // body): fall back to buffering, still capped.
  if (!res.body) {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('LNURL: response too large');
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        // Cancelling releases the connection instead of letting the endpoint
        // keep sending into a body nobody will read.
        await reader.cancel().catch(() => {});
        throw new Error('LNURL: response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function fetchJson(
  url: string,
  fetchFn: FetchFn,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      // Never follow a redirect. assertPublicHttpsUrl vouches for the URL we
      // are about to request, and it cannot vouch for wherever a 302 points:
      // following one would let an endpoint that passed the check hand us an
      // internal address and walk the fetch straight back inside. This is the
      // guarantee docs/security.md §17 states ("the endpoint cannot redirect
      // the second hop inward"), so it has to be enforced here.
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError') {
      throw new Error('LNURL: the endpoint took too long to respond');
    }
    // Network failure, DNS failure, a refused redirect, or a server that
    // refuses cross-origin reads. They look identical from here; say so
    // instead of leaking a browser-specific message into the UI.
    throw new Error('LNURL: could not reach the endpoint');
  }
  if (!res.ok) {
    throw new Error(`LNURL: endpoint returned ${res.status}`);
  }

  const text = await readCapped(res);

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
 * Resolve a Lightning Address or bech32 LNURL to its LNURL-pay parameters.
 *
 * @param address - `name@domain`, `lnurl1…`, or `lightning:LNURL1…`
 * @param fetchFn - Optional fetch override for testing
 * @throws if the address, the endpoint, or the response is invalid.
 */
export async function fetchPayParams(
  address: string,
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<LnurlPayParams> {
  const parsed = parseLightningAddress(address);
  const lnurl = parsed ? null : parseLnurl(address);
  if (!parsed && !lnurl) throw new Error('Not a valid Lightning Address or LNURL');

  const url = lnurl ? lnurl.url : lightningAddressToLnurlpUrl(address);
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
    address: lnurl ? lnurl.encoded : `${parsed!.name}@${parsed!.domain}`,
    domain: new URL(url).hostname,
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
  if (!Number.isSafeInteger(amountSats * 1000) || !Number.isInteger(amountSats) || amountSats <= 0) {
    throw new Error('LNURL: amount must be a positive whole number of sats');
  }

  const amountMsats = amountSats * 1000;
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    const min = Math.ceil(params.minSendable / 1000);
    const max = Math.floor(params.maxSendable / 1000);
    // A range narrower than one sat (say 500–900 msats) has no whole-sat amount
    // in it, and rounding the ends inward inverts them — the old message read
    // "must be between 1 and 0 sats". Name the real problem instead.
    if (max < min) {
      throw new Error('LNURL: this endpoint does not accept any whole-sat amount');
    }
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
  if (decoded.amountMsats !== amountMsats) {
    throw new Error(
      `LNURL: invoice is for ${decoded.amountSats} sats, not the ${amountSats} sats requested`,
    );
  }

  return { bolt11, amountSats };
}
