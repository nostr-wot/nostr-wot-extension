import { makeLnurlInvoice } from './helpers/lnurl-invoice.ts';
/** Negative regression cases for the 2026-09-10 audit. No real keys or payments. */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as permissions from '../src/services/permissions/permissions.ts';
import * as signer from '../src/services/signing/signer.ts';
import * as queue from '../src/services/signing/approvalQueue.ts';
import { handlers } from '../src/services/background/wallet-handlers.ts';
import { handlers as vaultHandlers } from '../src/services/background/vault-handlers.ts';
import { setWalletProvider, clearWalletProviders, removeWalletProvider } from '../src/services/wallet/index.ts';
import type { WalletProvider } from '../src/domain/wallet/types.ts';
import { getPublicKey } from 'nostr-tools/pure';
import { nip04Encrypt } from '../src/lib/crypto/nip04.ts';
import { nip44Encrypt } from '../src/lib/crypto/nip44.ts';
import { captureAccountSession } from '../src/services/signing/accountSession.ts';

const keys = [new Uint8Array(32).fill(21), new Uint8Array(32).fill(22)];
const accounts = keys.map((key, i) => ({ id: `audit-${i}`, name: `Audit ${i}`, type: 'nsec' as const,
  pubkey: getPublicKey(key), privkey: Buffer.from(key).toString('hex'), mnemonic: null, nip46Config: null,
  readOnly: false, createdAt: 1, walletConfig: { type: 'lnbits' as const, instanceUrl: 'https://wallet.invalid', adminKey: 'synthetic' } }));
const origin = 'audit.invalid';
const invoice = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
async function select(i: number) {
  await vault.setActiveAccount(accounts[i].id);
  await browser.storage.local.set({ activeAccountId: accounts[i].id });
  await browser.storage.sync.set({ myPubkey: accounts[i].pubkey });
}
function provider(pay: () => void, overrides: Partial<WalletProvider> = {}): WalletProvider {
  return { type: 'lnbits', isConnected: () => true, connect: async () => {}, disconnect: () => {},
    payInvoice: async () => { pay(); return { preimage: 'synthetic' }; },
    getInfo: async () => ({ methods: [], alias: 'Audit' }), getBalance: async () => ({ balance: 0 }),
    makeInvoice: async () => ({ bolt11: invoice, paymentHash: 'synthetic' }),
    lookupInvoice: async () => ({ paid: false }), listTransactions: async () => [], ...overrides };
}
async function pending() {
  for (let i = 0; i < 100; i++) {
    const request = (await queue.getPending())[0];
    if (request) { await new Promise(r => setTimeout(r, 10)); return request; }
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('Missing pending approval');
}
const send = () => handlers.get('webln_sendPayment')!({ origin, paymentRequest: invoice });

describe('audit A1–A3: authorization stays bound to its account and session', () => {
  beforeEach(async () => {
    vault.lock(); await queue.cleanupStale(); resetMockStorage(); permissions.invalidateCache(); clearWalletProviders();
    await vault.create('audit-password', { accounts, activeAccountId: accounts[0].id });
    await browser.storage.local.set({ accounts: accounts.map(({ id, pubkey, type }) => ({ id, pubkey, type })), activeAccountId: accounts[0].id });
    await browser.storage.sync.set({ myPubkey: accounts[0].pubkey });
  });
  afterEach(async () => { vault.lock(); await queue.cleanupStale(); });

  for (const method of ['nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt'] as const) {
    for (const backToA of [false, true]) it(`${method} rejects switch ${backToA ? 'A → B → A' : 'A → B'} during permission setup`, async () => {
      await permissions.save(origin, method, null, 'allow', accounts[0].id);
      let payload = 'audit message';
      if (method.endsWith('Decrypt')) payload = await (method.startsWith('nip04') ? nip04Encrypt : nip44Encrypt)(payload, keys[1], Buffer.from(accounts[0].pubkey, 'hex'));
      const original = browser.storage.local.get;
      let switched = false;
      browser.storage.local.get = async (...args) => {
        const result = await original(...args);
        if (!switched && typeof args[0] === 'string' && args[0].toLowerCase().includes('vault')) {
          switched = true; await select(1); if (backToA) await select(0);
        }
        return result;
      };
      try {
        const fn = { nip04Encrypt: signer.handleNip04Encrypt, nip04Decrypt: signer.handleNip04Decrypt,
          nip44Encrypt: signer.handleNip44Encrypt, nip44Decrypt: signer.handleNip44Decrypt }[method];
        await assert.rejects(fn(accounts[1].pubkey, payload, origin), /Account switched|session changed/);
        assert.equal(switched, true);
      } finally { browser.storage.local.get = original; }
    });
  }

  for (const type of ['lnbits', 'nwc'] as const) {
    it(`${type}: B's threshold cannot authorize A's captured provider`, async () => {
      let paid = 0;
      setWalletProvider(accounts[0].id, provider(() => { paid++; }, { type, isConnected: () => false, connect: () => select(1) }));
      await browser.storage.local.set({ [`walletThreshold_${accounts[1].id}`]: 999999 });
      await assert.rejects(send(), /Account switched|session changed/);
      assert.equal(paid, 0);
    });
    for (const action of ['lock', 'replace', 'switch'] as const) it(`${type}: ${action} invalidates a queued payment`, async () => {
      let paid = 0;
      setWalletProvider(accounts[0].id, provider(() => { paid++; }, { type }));
      const rejected = assert.rejects(send(), /locked|switched|changed|replaced|denied|cancel/i);
      const request = await pending();
      if (action === 'lock') await vaultHandlers.get('vault_lock')!({});
      else if (action === 'switch') await select(1);
      else { removeWalletProvider(accounts[0].id); setWalletProvider(accounts[0].id, provider(() => { paid++; }, { type })); }
      await queue.resolveRequest(request.id, { allow: true });
      await rejected; assert.equal(paid, 0);
    });
  }

  it('account-specific deny wins over a per-invoice threshold', async () => {
    let paid = 0; setWalletProvider(accounts[0].id, provider(() => { paid++; }));
    await permissions.setUseGlobalDefaults(false);
    await permissions.save(origin, 'webln_sendPayment', null, 'deny', accounts[0].id);
    await browser.storage.local.set({ [`walletThreshold_${accounts[0].id}`]: 999999 });
    await assert.rejects(send(), /Permission denied/); assert.equal(paid, 0);
  });

  it('a permitted current account still pays within its own threshold', async () => {
    let paid = 0; setWalletProvider(accounts[0].id, provider(() => { paid++; }));
    await permissions.setUseGlobalDefaults(false);
    await permissions.save(origin, 'webln_sendPayment', null, 'allow', accounts[0].id);
    await permissions.save(origin, 'webln_sendPayment', null, 'deny', accounts[1].id);
    await browser.storage.local.set({ [`walletThreshold_${accounts[0].id}`]: 999999 });
    await send(); assert.equal(paid, 1);
  });

  it('remembered payment permission belongs to the approved account', async () => {
    setWalletProvider(accounts[0].id, provider(() => {})); await permissions.setUseGlobalDefaults(false);
    const result = send(); const request = await pending();
    await queue.resolveRequest(request.id, { allow: true, remember: true }); await result;
    assert.equal(await permissions.check(origin, 'webln_sendPayment', undefined, accounts[0].id), 'allow');
    assert.equal(await permissions.check(origin, 'webln_sendPayment', undefined, accounts[1].id), 'ask');
    assert.equal(await permissions.check(origin, 'webln_sendPayment'), 'ask');
  });

  it('LNURL invoice resolution cannot dispatch after an account switch', async () => {
    let paid = 0; setWalletProvider(accounts[0].id, provider(() => { paid++; }));
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      if (String(input).includes('.well-known')) return new Response(JSON.stringify({ tag: 'payRequest', callback: 'https://pay.invalid/invoice', minSendable: 1000, maxSendable: 999999999, metadata: '[["text/plain","audit"]]' }));
      await select(1); return new Response(JSON.stringify({ pr: makeLnurlInvoice('[["text/plain","audit"]]') }));
    };
    try { await assert.rejects(handlers.get('wallet_payToLightningAddress')!({ address: 'audit@pay.invalid', amountSats: 250000, intentId: 'audit-only' }), /Account switched|session changed/); assert.equal(paid, 0); }
    finally { globalThis.fetch = original; }
  });

  it('crypto output is withheld if the vault locks while encryption completes', async () => {
    await permissions.save(origin, 'nip04Encrypt', null, 'allow', accounts[0].id);
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    crypto.subtle.encrypt = async (...args) => { const result = await original(...args); vault.lock(); return result; };
    try { await assert.rejects(signer.handleNip04Encrypt(accounts[1].pubkey, 'audit', origin), /locked/); }
    finally { crypto.subtle.encrypt = original; }
  });

  it('remote queue setup cannot revive a request after A → B → A', async () => {
    const session = captureAccountSession();
    const account = vault.getActiveAccount()!;
    const original = browser.storage.session.get;
    let switched = false;
    browser.storage.session.get = async (...args) => {
      const result = await original(...args);
      if (!switched) { switched = true; await select(1); await select(0); }
      return result;
    };
    try { await assert.rejects(queue.runNip46Request(account, 'nip04Encrypt', {}, origin, session), /session changed/); }
    finally { browser.storage.session.get = original; }
    assert.deepEqual(await queue.getPending(), []);
  });
  for (const method of ['wallet_getBalance','wallet_getTransactions']) {
    it(`${method} withholds a response when account changes during cache persistence`, async () => {
      setWalletProvider(accounts[0].id,provider(()=>{}));
      const original=browser.storage.local.set;
      let changed=false;
      browser.storage.local.set=async(items)=>{
        await original(items);
        if (!changed && Object.keys(items).some(key=>key.startsWith('walletDisplay_'))) {
          changed=true; await select(1);
        }
      };
      try { await assert.rejects(handlers.get(method)!({}),/Account switched|session changed/); assert.equal(changed,true); }
      finally { browser.storage.local.set=original; }
    });
  }

});
