import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createAutomaticPaymentBudget } from '../../src/services/wallet/automatic-payment-budget.ts';
const DAY = 86400000;
function storage() {
  const data = new Map<string, unknown>();
  return { data, async read(key: string) { return structuredClone(data.get(key) ?? null); }, async write(key: string, value: unknown) { data.set(key, structuredClone(value)); } };
}
it('serializes concurrent requests and persists reservations through restart and uncertain failure', async () => {
  const store = storage();
  const reserve = createAutomaticPaymentBudget(store);
  assert.deepEqual(await Promise.all([reserve('a', 600, 1, 1000), reserve('a', 600, 1, 1000)]), [true, false]);
  // No completion/release API: provider timeouts cannot make another silent payment possible.
  const restarted = createAutomaticPaymentBudget(store);
  assert.equal(await restarted('a', 500, 1, 1001), false);
  assert.equal(await restarted('b', 1000, 1, 1001), true);
  assert.equal(await restarted('a', 1000, 1, DAY + 1000), true);
});
it('fails closed on invalid amounts, corrupt state and storage failures', async () => {
  const store = storage(); const reserve = createAutomaticPaymentBudget(store);
  for (const amount of [0, -1, NaN, 1.5, Infinity]) assert.equal(await reserve('a', amount, 1), false);
  assert.equal(await reserve('a', 1000, Infinity), false);
  store.data.set('walletAutoBudget_a', { bad: true });
  assert.equal(await reserve('a', 1000, 1), false);
  const failing = createAutomaticPaymentBudget({read: async () => null, write: async () => { throw new Error('quota'); }});
  assert.equal(await failing('a', 1000, 1), false);
});
it('future reservations survive clock rollback and lowered thresholds do not reset spending', async () => {
 const reserve = createAutomaticPaymentBudget(storage());
 assert.equal(await reserve('a', 600, 1, 10000), true);
 assert.equal(await reserve('a', 500, 1, 9000), false);
 assert.equal(await reserve('a', 100, 0.5, 10001), false);
});
it('actual WebLN handler persists encrypted budget across lock/unlock and prompts after uncertain payment', async () => {
 const vault = await import('../../src/services/vault/vault.ts');
 const { default: browser, resetMockStorage } = await import('../helpers/browser-mock.ts');
 const { handlers } = await import('../../src/services/background/wallet-handlers.ts');
 const queue = await import('../../src/services/signing/approvalQueue.ts');
 const { setWalletProvider, clearWalletProviders } = await import('../../src/services/wallet/index.ts');
 const { makeLnurlInvoice } = await import('../helpers/lnurl-invoice.ts');
 const { getPublicKey } = await import('nostr-tools/pure');
 const privkey = new Uint8Array(32).fill(27);
 await vault.destroy(); resetMockStorage();
 await vault.create('budget-test-password', { activeAccountId: 'budget', accounts: [{
   id: 'budget', name: 'Budget', type: 'nsec', pubkey: getPublicKey(privkey), privkey: Buffer.from(privkey).toString('hex'),
   mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1,
   walletConfig: { type: 'lnbits', instanceUrl: 'https://example.com', adminKey: 'synthetic' },
 }] });
 let paid = 0;
 const provider = { type: 'lnbits' as const, isConnected: () => true, connect: async () => {}, disconnect: () => {},
   payInvoice: async () => { paid++; if (paid === 1) throw new Error('Uncertain timeout'); return { preimage: 'synthetic' }; },
   getInfo: async () => ({ methods: [], alias: 'test' }), getBalance: async () => ({ balance: 0 }),
   makeInvoice: async () => ({ bolt11: '', paymentHash: '' }), lookupInvoice: async () => ({ paid: false }), listTransactions: async () => [] };
 setWalletProvider('budget', provider);
 await handlers.get('wallet_setAutoApproveThreshold')!({ threshold: 1 });
 const pay = () => handlers.get('webln_sendPayment')!({ origin: 'budget.example', paymentRequest: makeLnurlInvoice('[]', 'lnbc10n') });
 try {
   await assert.rejects(pay(), /Uncertain timeout/);
   assert.equal(paid, 1);
   const stored = (await browser.storage.local.get('walletAutoBudget_budget')).walletAutoBudget_budget;
   assert.equal(stored.privateCache, 1); assert.doesNotMatch(JSON.stringify(stored), /msats/);
   vault.lock(); await vault.unlock('budget-test-password'); setWalletProvider('budget', provider);
   const result = pay();
   let request;
   for (let i = 0; i < 100; i++) { request = (await queue.getPending())[0]; if (request) break; await new Promise(r => setTimeout(r, 5)); }
   assert.ok(request); assert.equal(paid, 1);
   await queue.resolveRequest(request.id, { allow: true });
   await result; assert.equal(paid, 2);
   await assert.rejects(handlers.get('wallet_setAutoApproveThreshold')!({ threshold: -1 }), /Threshold/);
 } finally { vault.lock(); await queue.cleanupStale(); clearWalletProviders(); await vault.destroy(); }
});

/**
 * A silent payment spends the fee as surely as it spends the amount, so the rolling
 * allowance has to count both. These drive the real webln_sendPayment handler.
 *
 * The invoice is lnbc10n — 1 sat, 1000 msat — and the threshold is 1 sat, so the
 * amount alone exactly fills the allowance. Any fee at all must push it over.
 */
async function budgetFixture(provider: Record<string, unknown>) {
  const vault = await import('../../src/services/vault/vault.ts');
  const { resetMockStorage } = await import('../helpers/browser-mock.ts');
  const { handlers } = await import('../../src/services/background/wallet-handlers.ts');
  const queue = await import('../../src/services/signing/approvalQueue.ts');
  const { setWalletProvider, clearWalletProviders } = await import('../../src/services/wallet/index.ts');
  const { makeLnurlInvoice } = await import('../helpers/lnurl-invoice.ts');
  const { getPublicKey } = await import('nostr-tools/pure');
  const privkey = new Uint8Array(32).fill(29);
  await vault.destroy(); resetMockStorage();
  await vault.create('fee-test-password', { activeAccountId: 'fee', accounts: [{
    id: 'fee', name: 'Fee', type: 'nsec', pubkey: getPublicKey(privkey), privkey: Buffer.from(privkey).toString('hex'),
    mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1,
    walletConfig: { type: 'lnbits', instanceUrl: 'https://example.com', adminKey: 'synthetic' },
  }] });
  setWalletProvider('fee', provider as never);
  await handlers.get('wallet_setAutoApproveThreshold')!({ threshold: 1 });
  return {
    pay: (hrp = 'lnbc10n') => handlers.get('webln_sendPayment')!({ origin: 'fee.example', paymentRequest: makeLnurlInvoice('[]', hrp) }),
    /** Resolves to the queued request, or null once it is clear nothing will be queued. */
    async pending() {
      for (let i = 0; i < 40; i++) {
        const request = (await queue.getPending())[0];
        if (request) return request;
        await new Promise(r => setTimeout(r, 5));
      }
      return null;
    },
    queue,
    async cleanup() { vault.lock(); await queue.cleanupStale(); clearWalletProviders(); await vault.destroy(); },
  };
}

/** A provider that quotes, counts its calls, and settles. */
function quotingProvider(feeMsat: number | null) {
  const calls = { paid: 0, quoted: 0 };
  return { calls, provider: {
    type: 'lnbits' as const, isConnected: () => true, connect: async () => {}, disconnect: () => {},
    quoteSend: async () => { calls.quoted++; return { feeMsat }; },
    payInvoice: async () => { calls.paid++; return { preimage: 'synthetic' }; },
    getInfo: async () => ({ methods: [], alias: 'test' }), getBalance: async () => ({ balance: 0 }),
    makeInvoice: async () => ({ bolt11: '', paymentHash: '' }), lookupInvoice: async () => ({ paid: false }),
    listTransactions: async () => [],
  } };
}

it('counts the quoted fee against the silent allowance, so a fee that does not fit asks the user', async () => {
  const { calls, provider } = quotingProvider(1);
  const f = await budgetFixture(provider);
  try {
    const result = f.pay();
    const request = await f.pending();

    // The amount alone fitted; amount + fee did not, so this stopped being silent.
    assert.ok(request, 'the user was never asked');
    assert.equal(calls.paid, 0);
    await f.queue.resolveRequest(request.id, { allow: true });
    await result;
    assert.equal(calls.paid, 1);
  } finally { await f.cleanup(); }
});

it('asks the user when the deployment cannot quote a fee, rather than paying blind', async () => {
  const { calls, provider } = quotingProvider(null);
  const f = await budgetFixture(provider);
  try {
    const result = f.pay();
    const request = await f.pending();

    assert.ok(request, 'an unknown fee was approved silently');
    assert.equal(calls.paid, 0);
    await f.queue.resolveRequest(request.id, { allow: true });
    await result;
    assert.equal(calls.paid, 1);
  } finally { await f.cleanup(); }
});

it('leaves a wallet that cannot quote at all paying silently, as it did before', async () => {
  // NWC has no pre-flight quote anywhere in NIP-47. Requiring one would end silent
  // payments for every NWC user, which is a regression, not a safety improvement.
  const { calls, provider } = quotingProvider(0);
  const { quoteSend: _omitted, ...withoutQuote } = provider;
  const f = await budgetFixture({ ...withoutQuote, type: 'nwc' as const });
  try {
    await f.pay();

    assert.equal(calls.paid, 1);
    assert.equal(calls.quoted, 0);
    assert.deepEqual(await f.queue.getPending(), []);
  } finally { await f.cleanup(); }
});

it('never approves an invoice of unknown amount silently, even when the fee is tiny', async () => {
  // An amountless invoice decodes to 0. Reserving only the fee against it would let
  // any amount through on a 1-sat allowance, which is the opposite of the guarantee.
  const { calls, provider } = quotingProvider(1);
  const f = await budgetFixture(provider);
  try {
    const result = f.pay('lnbc');
    const request = await f.pending();

    assert.ok(request, 'an invoice of unknown amount was approved silently');
    assert.equal(calls.paid, 0);
    await f.queue.resolveRequest(request.id, { allow: false });
    await assert.rejects(result, /denied/);
    assert.equal(calls.paid, 0);
  } finally { await f.cleanup(); }
});
