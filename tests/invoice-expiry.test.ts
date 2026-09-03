/**
 * Invoice expiry, and the transaction-row date.
 *
 * Both were inline in Wallet.tsx reading the clock directly — the expiry one as
 * an IIFE inside JSX — so neither could be tested. Taking `now` as a parameter
 * is the whole change that makes them checkable.
 *
 * Run with:
 *   node --import tsx --test tests/invoice-expiry.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeInvoiceExpiry } from '../src/shared/invoiceExpiry.ts';

const T = 1_700_000_000; // invoice timestamp, epoch seconds
const at = (secondsAfterIssue: number) => (T + secondsAfterIssue) * 1000;

describe('describeInvoiceExpiry', () => {
  it('is expired exactly at the deadline, not a moment later', () => {
    assert.deepEqual(describeInvoiceExpiry(T, 3600, at(3600)), { state: 'expired' });
    assert.deepEqual(describeInvoiceExpiry(T, 3600, at(3601)), { state: 'expired' });
  });

  it('rounds partial minutes up', () => {
    // 30 seconds left is "1 minute", never "0 minutes" — a zero reads as expired
    // to someone deciding whether it is still worth paying.
    assert.deepEqual(describeInvoiceExpiry(T, 3600, at(3570)), { state: 'minutes', n: 1 });
  });

  it('switches from minutes to hours at 60', () => {
    assert.deepEqual(describeInvoiceExpiry(T, 3600, at(60)), { state: 'minutes', n: 59 });
    assert.deepEqual(describeInvoiceExpiry(T, 3600, at(0)), { state: 'hours', n: 1 });
  });

  it('rounds hours to nearest', () => {
    // 89 minutes -> 1h, 91 minutes -> 2h (Math.round on minutes/60).
    assert.deepEqual(describeInvoiceExpiry(T, 89 * 60, at(0)), { state: 'hours', n: 1 });
    assert.deepEqual(describeInvoiceExpiry(T, 91 * 60, at(0)), { state: 'hours', n: 2 });
  });

  it('handles a long-dated invoice', () => {
    assert.deepEqual(describeInvoiceExpiry(T, 86400, at(0)), { state: 'hours', n: 24 });
  });
});
