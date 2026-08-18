import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from '../helpers/browser-mock.ts';
import * as permissions from '../../lib/permissions.ts';
import * as signer from '../../lib/signer.ts';
import { handlers as walletHandlers } from '../../lib/bg/wallet-handlers.ts';
import { addAllowedDomain, addWeblnAllowedDomain, isWeblnAllowed } from '../../lib/bg/domain-handlers.ts';

describe('wallet permissions', () => {
  beforeEach(() => {
    resetMockStorage();
  });

  it('webln_sendPayment defaults to ask', async () => {
    const result = await permissions.check('primal.net', 'webln_sendPayment');
    assert.equal(result, 'ask');
  });

  it('saves and checks webln_sendPayment permission', async () => {
    await permissions.save('primal.net', 'webln_sendPayment', null, 'allow');
    const result = await permissions.check('primal.net', 'webln_sendPayment');
    assert.equal(result, 'allow');
  });

  it('webln_getBalance defaults to ask', async () => {
    const result = await permissions.check('example.com', 'webln_getBalance');
    assert.equal(result, 'ask');
  });

  it('webln permissions are domain-isolated', async () => {
    await permissions.save('primal.net', 'webln_sendPayment', null, 'allow');
    const result = await permissions.check('coracle.social', 'webln_sendPayment');
    assert.equal(result, 'ask');
  });

  it('webln deny is respected', async () => {
    await permissions.save('evil.com', 'webln_sendPayment', null, 'deny');
    const result = await permissions.check('evil.com', 'webln_sendPayment');
    assert.equal(result, 'deny');
  });

  it('webln wildcard works', async () => {
    await permissions.save('trusted.com', '*', null, 'allow');
    const result = await permissions.check('trusted.com', 'webln_sendPayment');
    assert.equal(result, 'allow');
  });

  it('permissionKey passes webln_ methods through as-is', () => {
    assert.equal(permissions.permissionKey('webln_sendPayment'), 'webln_sendPayment');
    assert.equal(permissions.permissionKey('webln_getBalance'), 'webln_getBalance');
    assert.equal(permissions.permissionKey('webln_makeInvoice'), 'webln_makeInvoice');
    assert.equal(permissions.permissionKey('webln_getInfo'), 'webln_getInfo');
  });
});

// ── Wallet access is a separate consent, and must be asked for separately ──

describe('webln_enable does not ride along on a NIP-07 connection', () => {
  beforeEach(async () => {
    resetMockStorage();
  });

  it('asks before granting wallet access to an already-connected site', async () => {
    await addAllowedDomain('social.example');   // NIP-07 connected, never asked about the wallet

    const enable = walletHandlers.get('webln_enable')!;
    const pending = enable({ origin: 'social.example', shownConnectCard: false });

    // The user must be asked: the call parks on an approval request.
    await new Promise(r => setTimeout(r, 20));
    const queued = await signer.getPending();
    const ask = queued.find(r => r.type === 'webln_enable' && r.origin === 'social.example');
    assert.ok(ask, 'an already-connected site must still be asked about the wallet');
    assert.strictEqual(await isWeblnAllowed('social.example'), false, 'nothing granted while asking');

    signer.resolveRequest(ask!.id, { allow: true, remember: false });
    assert.strictEqual(await pending, true);
    assert.strictEqual(await isWeblnAllowed('social.example'), true);
  });

  it('grants nothing when the user refuses', async () => {
    await addAllowedDomain('social.example');
    const enable = walletHandlers.get('webln_enable')!;
    const pending = enable({ origin: 'social.example', shownConnectCard: false });

    await new Promise(r => setTimeout(r, 20));
    const ask = (await signer.getPending()).find(r => r.type === 'webln_enable');
    signer.resolveRequest(ask!.id, { allow: false, remember: false });

    await assert.rejects(() => pending as Promise<unknown>, /denied/i);
    assert.strictEqual(await isWeblnAllowed('social.example'), false);
  });

  it('does not ask twice when the Connect card was shown for this wallet request', async () => {
    // The card was raised BY the enable() call, so answering it was the wallet consent.
    const enable = walletHandlers.get('webln_enable')!;
    assert.strictEqual(await enable({ origin: 'zap.example', shownConnectCard: true }), true);
    assert.strictEqual(await isWeblnAllowed('zap.example'), true);
    assert.deepStrictEqual(await signer.getPending(), []);
  });

  it('is a no-op once wallet access is already granted', async () => {
    await addWeblnAllowedDomain('zap.example');
    const enable = walletHandlers.get('webln_enable')!;
    assert.strictEqual(await enable({ origin: 'zap.example', shownConnectCard: false }), true);
    assert.deepStrictEqual(await signer.getPending(), [], 're-enabling must not re-prompt');
  });
});
