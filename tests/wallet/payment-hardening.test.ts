import { it } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { createHash } from 'node:crypto';
import { decodeBolt11 } from '../../src/domain/wallet/bolt11.ts';
import { requestInvoice } from '../../src/services/wallet/lnurl.ts';

export function invoice(hrp: string, metadata?: string): string {
  const hash = metadata === undefined ? [] : bech32.toWords(createHash('sha256').update(metadata).digest());
  return bech32.encode(hrp, [...Array(7).fill(0), ...(hash.length ? [23, 1, 20, ...hash] : []), ...Array(104).fill(0)], 2000);
}
const metadata = '[["text/plain", "Coffee ☕"]]';
const params = { address: 'a@example.com', domain: 'example.com', callback: 'https://example.com/cb', minSendable: 1, maxSendable: 1e12, metadata, description: 'Coffee', commentAllowed: 0, allowsNostr: false, nostrPubkey: null };
it('preserves exact millisatoshis and rejects malformed amount encodings', () => {
  assert.equal(decodeBolt11(invoice('lnbc10010p'))?.amountMsats, 1001);
  assert.equal(decodeBolt11(invoice('lnbc10010p'))?.amountSats, 1.001);
  for (const hrp of ['lnbc1p', 'lnbc1.1u', 'lnbc123junk', 'lnbc999999999999999999999m']) assert.equal(decodeBolt11(invoice(hrp)), null);
});
it('LNURL rejects sub-sat substitutions without imposing metadata-hash binding', async () => {
  const fetchInvoice = (pr: string) => async () => new Response(JSON.stringify({ pr }));
  await assert.rejects(requestInvoice(params, 1, undefined, fetchInvoice(invoice('lnbc10010p', metadata))), /not the 1 sats/);
  const differentHashInvoice = invoice('lnbc10n', 'a different description');
  const accepted = await requestInvoice(params, 1, undefined, fetchInvoice(differentHashInvoice));
  assert.equal(accepted.bolt11, differentHashInvoice);
  assert.equal((await requestInvoice(params, 1, undefined, fetchInvoice(invoice('lnbc10n', metadata)))).amountSats, 1);
});
it('decodes each amount multiplier without rounding and rejects ambiguous tagged fields', () => {
 for (const [hrp, expected] of [['lnbc1',100000000000], ['lntb1m',100000000], ['lnbcrt1u',100000], ['lnbc1n',100], ['lnbc10p',1]] as const) {
   assert.equal(decodeBolt11(invoice(hrp))?.amountMsats, expected);
 }
 const hash = bech32.toWords(createHash('sha256').update(metadata).digest());
 const encode = (tags: number[]) => bech32.encode('lnbc10n', [...Array(7).fill(0), ...tags, ...Array(104).fill(0)], 2000);
 for (const tags of [[23,1,20,...hash,23,1,20,...hash], [23,0,1,0], [23,1,20,0], [23]]) assert.equal(decodeBolt11(encode(tags)), null);
 const valid = invoice('lnbc10n', metadata);
 assert.equal(decodeBolt11('L' + valid.slice(1)), null);
 assert.equal(decodeBolt11(bech32.encode('lnbc10n', Array(35).fill(0),2000)), null);
});

it('LNURL accepts a plain-description invoice without an h tag', async () => {
  const plainInvoice = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
  const decoded = decodeBolt11(plainInvoice);
  assert.equal(decoded?.description, '1 cup coffee');
  assert.equal(decoded?.descriptionHash, null);
  const result = await requestInvoice(params, 250000, undefined, async () => new Response(JSON.stringify({ pr: plainInvoice })));
  assert.deepEqual(result, { bolt11: plainInvoice, amountSats: 250000 });
});
