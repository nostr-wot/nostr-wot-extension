/**
 * The Send box pays what the field says, or it pays nothing.
 *
 * Resolving a Lightning Address is debounced, so between "the user edited the
 * field" and "the new address resolved" the component holds a resolution for
 * an address that is no longer on screen. The Pay button used to gate on the
 * text (`sendIsAddress`) while the handler branched on the resolution
 * (`sendAddress`), and in that window both were satisfied by *different*
 * addresses: the field read bob@…, the sats went to alice@….
 *
 * The first test below is that bug. It is about money leaving for the wrong
 * person, so it is the one to keep passing.
 *
 * Run with:
 *   node --import tsx --test tests/send-target.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { resolveSendTarget, canSend, type SendTargetInput } from '../src/domain/wallet/sendTarget.ts';

const ALICE = { address: 'alice@example.com', minSats: 1, maxSats: 100_000 };

/** A field showing a resolved, payable address. */
function base(over: Partial<SendTargetInput> = {}): SendTargetInput {
  return {
    input: 'alice@example.com',
    isAddress: true,
    resolved: ALICE,
    amount: '500',
    invoiceDecodable: false,
    ...over,
  };
}

describe('resolveSendTarget — the stale-recipient window', () => {
  it('refuses to pay a resolution that is not for the address on screen', () => {
    // The user has retyped the field; alice is still the last resolution.
    const target = resolveSendTarget(base({ input: 'bob@example.com' }));

    assert.deepEqual(
      target,
      { kind: 'none', reason: 'resolving' },
      'a resolution for another address must never be payable',
    );
  });

  it('never reports the old address as the recipient mid-edit', () => {
    const target = resolveSendTarget(base({ input: 'bob@example.com' }));
    assert.notEqual(
      (target as { address?: string }).address,
      'alice@example.com',
      'this is the payment that went to the wrong person',
    );
  });

  it('disables Pay for the whole window', () => {
    assert.equal(canSend(base({ input: 'bob@example.com' })), false);
  });

  it('pays again once the new address has resolved', () => {
    const bob = { address: 'bob@example.com', minSats: 1, maxSats: 10 };
    assert.deepEqual(
      resolveSendTarget(base({ input: 'bob@example.com', resolved: bob, amount: '5' })),
      { kind: 'address', address: 'bob@example.com', amountSats: 5 },
    );
  });

  it('matches case-insensitively, since LUD-16 addresses resolve lowercased', () => {
    assert.deepEqual(
      resolveSendTarget(base({ input: '  Alice@Example.com  ' })),
      { kind: 'address', address: 'alice@example.com', amountSats: 500 },
    );
  });
});

describe('resolveSendTarget — addresses', () => {
  it('pays a resolved address for the typed amount', () => {
    assert.deepEqual(
      resolveSendTarget(base()),
      { kind: 'address', address: 'alice@example.com', amountSats: 500 },
    );
  });

  it('is not payable while the first resolution is still in flight', () => {
    assert.deepEqual(
      resolveSendTarget(base({ resolved: null })),
      { kind: 'none', reason: 'resolving' },
    );
  });

  it('rejects an amount outside the endpoint range', () => {
    assert.equal(resolveSendTarget(base({ amount: '0' })).kind, 'none');
    assert.equal(resolveSendTarget(base({ amount: '100001' })).kind, 'none');
    assert.deepEqual(resolveSendTarget(base({ amount: '100000' })).kind, 'address');
  });

  it('rejects a fractional or non-numeric amount', () => {
    for (const amount of ['1.5', '', 'abc', 'NaN', '1e3x']) {
      assert.equal(
        resolveSendTarget(base({ amount })).kind,
        'none',
        `"${amount}" must not be payable`,
      );
    }
  });

  it('reports "amount" rather than "resolving" when only the amount is wrong', () => {
    // The UI needs to tell "waiting on the endpoint" from "fix your number".
    assert.deepEqual(
      resolveSendTarget(base({ amount: '0' })),
      { kind: 'none', reason: 'amount' },
    );
  });
});

describe('resolveSendTarget — invoices', () => {
  it('pays a decodable invoice verbatim', () => {
    assert.deepEqual(
      resolveSendTarget(base({ input: '  lnbc25u1p...  ', isAddress: false, invoiceDecodable: true })),
      { kind: 'invoice', bolt11: 'lnbc25u1p...' },
    );
  });

  it('refuses an invoice it could not decode', () => {
    assert.deepEqual(
      resolveSendTarget(base({ input: 'lnbcgarbage', isAddress: false, invoiceDecodable: false })),
      { kind: 'none', reason: 'unresolved' },
    );
  });

  it('pays the invoice, not a leftover address resolution', () => {
    // Pasting an invoice over a resolved address must switch recipients
    // completely — the invoice is the instruction, alice is history.
    const target = resolveSendTarget(base({
      input: 'lnbc25u1p...',
      isAddress: false,
      invoiceDecodable: true,
      resolved: ALICE,
    }));
    assert.deepEqual(target, { kind: 'invoice', bolt11: 'lnbc25u1p...' });
  });

  it('treats an empty field as nothing to pay', () => {
    assert.deepEqual(
      resolveSendTarget(base({ input: '   ', isAddress: false })),
      { kind: 'none', reason: 'empty' },
    );
  });
});

it('LNURL recipients retain the stale-recipient guard and normalize lightning links', () => {
  const encoded = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode('https://example.com/pay')), 2000);
  const input = `lightning:${encoded.toUpperCase()}`;
  assert.equal(canSend(base({ input })), false);
  assert.deepEqual(resolveSendTarget(base({ input, resolved: { ...ALICE, address: encoded } })),
    { kind: 'address', address: encoded, amountSats: 500 });
});
