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
