/**
 * LNURL-pay / Lightning Address tests
 *
 * Covers address parsing, the URL safety guard, pay-param fetching, and
 * invoice requests — including the checks that stop a hostile LNURL server
 * from changing the amount the user approved.
 *
 * Run with:
 *   node --import tsx --test tests/wallet/lnurl.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLightningAddress, isLightningAddress, lightningAddressToLnurlpUrl,
  assertPublicHttpsUrl, fetchPayParams, requestInvoice,
  type LnurlPayParams,
} from '../../lib/wallet/lnurl.ts';

// lnbc2500u = 250,000 sats
const INVOICE_250K =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

// Valid bolt11 with no amount in the HRP
const INVOICE_AMOUNTLESS =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';

const METADATA = JSON.stringify([['text/plain', 'Sats for alice'], ['text/identifier', 'alice@example.com']]);

const PAY_PARAMS_BODY = {
  tag: 'payRequest',
  callback: 'https://example.com/lnurlp/api/v1/lnurl/cb/abc',
  minSendable: 1000,
  maxSendable: 100_000_000,
  metadata: METADATA,
  commentAllowed: 140,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Records requested URLs and replays canned responses in order. */
function mockFetch(responses: Array<Response | Error>) {
  const urls: string[] = [];
  let i = 0;
  const fetchFn = async (url: string): Promise<Response> => {
    urls.push(url);
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, urls };
}

const BASE_PARAMS: LnurlPayParams = {
  address: 'alice@example.com',
  domain: 'example.com',
  callback: 'https://example.com/lnurlp/api/v1/lnurl/cb/abc',
  minSendable: 1000,
  maxSendable: 1_000_000_000,
  metadata: METADATA,
  description: 'Sats for alice',
  commentAllowed: 140,
  allowsNostr: false,
  nostrPubkey: null,
};

describe('parseLightningAddress', () => {
  it('parses a plain address and lowercases it', () => {
    assert.deepEqual(parseLightningAddress('Alice@Example.COM'), { name: 'alice', domain: 'example.com' });
  });

  it('accepts dots, hyphens and underscores in the local part', () => {
    assert.deepEqual(parseLightningAddress('a.b-c_d@sub.example.co.uk'),
      { name: 'a.b-c_d', domain: 'sub.example.co.uk' });
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(parseLightningAddress('  bob@example.com \n'), { name: 'bob', domain: 'example.com' });
  });

  it('rejects invoices, lnurl strings, and non-addresses', () => {
    assert.equal(parseLightningAddress(INVOICE_250K), null);
    assert.equal(parseLightningAddress('lnurl1dp68gurn8ghj7'), null);
    assert.equal(parseLightningAddress('npub1abc'), null);
    assert.equal(parseLightningAddress(''), null);
  });

  it('rejects malformed addresses', () => {
    assert.equal(parseLightningAddress('@example.com'), null);
    assert.equal(parseLightningAddress('alice@'), null);
    assert.equal(parseLightningAddress('alice@@example.com'), null);
    assert.equal(parseLightningAddress('alice@bob@example.com'), null);
    assert.equal(parseLightningAddress('alice@localhost'), null);      // no dot
    assert.equal(parseLightningAddress('alice@example.com.'), null);   // trailing dot
    assert.equal(parseLightningAddress('ali ce@example.com'), null);
    assert.equal(parseLightningAddress('.alice@example.com'), null);
  });

  it('isLightningAddress mirrors the parser', () => {
    assert.equal(isLightningAddress('alice@example.com'), true);
    assert.equal(isLightningAddress(INVOICE_250K), false);
  });
});

describe('lightningAddressToLnurlpUrl', () => {
  it('builds the LUD-16 well-known URL', () => {
    assert.equal(lightningAddressToLnurlpUrl('Alice@Example.com'),
      'https://example.com/.well-known/lnurlp/alice');
  });

  it('throws on a non-address', () => {
    assert.throws(() => lightningAddressToLnurlpUrl('nope'), /valid Lightning Address/);
  });
});

describe('assertPublicHttpsUrl', () => {
  it('accepts a public https URL', () => {
    assert.equal(assertPublicHttpsUrl('https://example.com/cb').hostname, 'example.com');
  });

  it('rejects http', () => {
    assert.throws(() => assertPublicHttpsUrl('http://example.com/cb'), /non-HTTPS/);
  });

  it('rejects loopback and local names', () => {
    assert.throws(() => assertPublicHttpsUrl('https://localhost/cb'), /local endpoint/);
    assert.throws(() => assertPublicHttpsUrl('https://router.local/cb'), /local endpoint/);
  });

  it('rejects private and loopback IPs', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254']) {
      assert.throws(() => assertPublicHttpsUrl(`https://${host}/cb`), /private-network/, host);
    }
  });

  it('rejects bare public IPs and IPv6 literals', () => {
    assert.throws(() => assertPublicHttpsUrl('https://8.8.8.8/cb'), /bare IP/);
    assert.throws(() => assertPublicHttpsUrl('https://[2001:4860:4860::8888]/cb'), /bare IP/);
    assert.throws(() => assertPublicHttpsUrl('https://[::1]/cb'), /private-network/);
  });

  it('rejects malformed URLs', () => {
    assert.throws(() => assertPublicHttpsUrl('not a url'), /malformed/);
  });
});

describe('fetchPayParams', () => {
  it('requests the well-known URL and returns normalised params', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse(PAY_PARAMS_BODY)]);
    const params = await fetchPayParams('Alice@Example.com', fetchFn);

    assert.equal(urls[0], 'https://example.com/.well-known/lnurlp/alice');
    assert.equal(params.address, 'alice@example.com');
    assert.equal(params.domain, 'example.com');
    assert.equal(params.minSendable, 1000);
    assert.equal(params.maxSendable, 100_000_000);
    assert.equal(params.description, 'Sats for alice');
    assert.equal(params.commentAllowed, 140);
    assert.equal(params.allowsNostr, false);
  });

  it('reports nostr zap support when advertised', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, allowsNostr: true, nostrPubkey: 'abc123' })]);
    const params = await fetchPayParams('alice@example.com', fetchFn);
    assert.equal(params.allowsNostr, true);
    assert.equal(params.nostrPubkey, 'abc123');
  });

  it('treats a missing or malformed metadata string as no description', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, metadata: 'not json' })]);
    const params = await fetchPayParams('alice@example.com', fetchFn);
    assert.equal(params.description, null);
  });

  it('clamps a silly commentAllowed and treats missing as zero', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, commentAllowed: 999999 })]);
    assert.equal((await fetchPayParams('alice@example.com', fetchFn)).commentAllowed, 1000);

    const noComment = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, commentAllowed: undefined })]);
    assert.equal((await fetchPayParams('alice@example.com', noComment.fetchFn)).commentAllowed, 0);
  });

  it('surfaces a LUD-06 error response', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ status: 'ERROR', reason: 'No such user' })]);
    await assert.rejects(fetchPayParams('alice@example.com', fetchFn), /No such user/);
  });

  it('rejects a non-payRequest endpoint', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ tag: 'withdrawRequest', callback: 'https://example.com/cb' })]);
    await assert.rejects(fetchPayParams('alice@example.com', fetchFn), /not a pay request/);
  });

  it('rejects a callback that is not public https', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, callback: 'http://169.254.169.254/cb' })]);
    await assert.rejects(fetchPayParams('alice@example.com', fetchFn), /non-HTTPS/);
  });

  it('rejects an invalid sendable range', async () => {
    const swapped = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, minSendable: 5000, maxSendable: 1000 })]);
    await assert.rejects(fetchPayParams('alice@example.com', swapped.fetchFn), /sendable range/);

    const zero = mockFetch([jsonResponse({ ...PAY_PARAMS_BODY, minSendable: 0 })]);
    await assert.rejects(fetchPayParams('alice@example.com', zero.fetchFn), /sendable range/);
  });

  it('rejects non-JSON and error statuses', async () => {
    const html = mockFetch([new Response('<html>', { status: 200 })]);
    await assert.rejects(fetchPayParams('alice@example.com', html.fetchFn), /did not return JSON/);

    const notFound = mockFetch([jsonResponse({}, 404)]);
    await assert.rejects(fetchPayParams('alice@example.com', notFound.fetchFn), /returned 404/);
  });

  it('turns a network/CORS failure into a plain message', async () => {
    const { fetchFn } = mockFetch([new TypeError('Failed to fetch')]);
    await assert.rejects(fetchPayParams('alice@example.com', fetchFn), /could not reach the endpoint/);
  });

  it('rejects an address it cannot parse', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse(PAY_PARAMS_BODY)]);
    await assert.rejects(fetchPayParams('nope', fetchFn), /valid Lightning Address/);
    assert.equal(urls.length, 0);
  });
});

describe('requestInvoice', () => {
  it('calls the callback with the amount in msats and returns the invoice', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    const result = await requestInvoice(BASE_PARAMS, 250_000, undefined, fetchFn);

    const url = new URL(urls[0]);
    assert.equal(url.searchParams.get('amount'), '250000000');
    assert.equal(url.searchParams.get('comment'), null);
    assert.equal(result.bolt11, INVOICE_250K);
    assert.equal(result.amountSats, 250_000);
  });

  it('sends a comment when the endpoint allows one, truncated to the limit', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await requestInvoice({ ...BASE_PARAMS, commentAllowed: 5 }, 250_000, 'hello world', fetchFn);
    assert.equal(new URL(urls[0]).searchParams.get('comment'), 'hello');
  });

  it('drops the comment when the endpoint does not accept one', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await requestInvoice({ ...BASE_PARAMS, commentAllowed: 0 }, 250_000, 'hello', fetchFn);
    assert.equal(new URL(urls[0]).searchParams.get('comment'), null);
  });

  it('rejects an amount outside the sendable range before making a request', async () => {
    const low = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 0, undefined, low.fetchFn), /positive whole number/);
    assert.equal(low.urls.length, 0);

    const high = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 2_000_000, undefined, high.fetchFn),
      /between 1 and 1000000 sats/);
    assert.equal(high.urls.length, 0);
  });

  it('rejects fractional amounts', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 12.5, undefined, fetchFn), /whole number/);
  });

  it('refuses an invoice for a different amount than the user approved', async () => {
    // Endpoint returns a 250,000-sat invoice for a 1,000-sat request.
    const { fetchFn } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await assert.rejects(
      requestInvoice(BASE_PARAMS, 1000, undefined, fetchFn),
      /invoice is for 250000 sats, not the 1000 sats requested/,
    );
  });

  it('refuses an amountless invoice', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ pr: INVOICE_AMOUNTLESS })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 250_000, undefined, fetchFn), /amountless invoice/);
  });

  it('refuses an undecodable invoice', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ pr: 'lnbc1pvjluezpp5invalid' })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 250_000, undefined, fetchFn), /undecodable invoice/);
  });

  it('refuses a response with no invoice at all', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ status: 'OK' })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 250_000, undefined, fetchFn), /did not return an invoice/);
  });

  it('surfaces a LUD-06 error from the callback', async () => {
    const { fetchFn } = mockFetch([jsonResponse({ status: 'ERROR', reason: 'Wallet offline' })]);
    await assert.rejects(requestInvoice(BASE_PARAMS, 250_000, undefined, fetchFn), /Wallet offline/);
  });

  it('refuses a callback that was swapped for a private host', async () => {
    const { fetchFn, urls } = mockFetch([jsonResponse({ pr: INVOICE_250K })]);
    await assert.rejects(
      requestInvoice({ ...BASE_PARAMS, callback: 'https://192.168.0.10/cb' }, 250_000, undefined, fetchFn),
      /private-network/,
    );
    assert.equal(urls.length, 0);
  });
});
