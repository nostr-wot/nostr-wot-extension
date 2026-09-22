/**
 * `classifyDay` — the "Today" / "Yesterday" boundary the activity log's day
 * headers are built on.
 *
 * Pulled out of `ActivityOverlay` where it was inline and untested; the
 * boundary itself (what counts as "yesterday" relative to `now`) is exactly
 * the kind of off-by-one that is easy to get wrong and easy to miss by eye,
 * since a wrong header only shows up once a day actually rolls over.
 *
 * Run with:
 *   node --import tsx --test tests/format-time.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDay } from '../src/utils/format/time.ts';

const NOW = new Date('2026-03-15T12:00:00Z');

describe('classifyDay', () => {
  it('matches today', () => {
    assert.equal(classifyDay(NOW.toDateString(), NOW), 'today');
  });

  it('matches yesterday', () => {
    const yesterday = new Date(NOW.getTime() - 86400000);
    assert.equal(classifyDay(yesterday.toDateString(), NOW), 'yesterday');
  });

  it('falls back to "other" for anything further back', () => {
    const lastWeek = new Date(NOW.getTime() - 7 * 86400000);
    assert.equal(classifyDay(lastWeek.toDateString(), NOW), 'other');
  });

  it('falls back to "other" for a date in the future', () => {
    const tomorrow = new Date(NOW.getTime() + 86400000);
    assert.equal(classifyDay(tomorrow.toDateString(), NOW), 'other');
  });

  it('defaults `now` to the real clock when omitted', () => {
    assert.equal(classifyDay(new Date().toDateString()), 'today');
  });
});

import { formatTimeAgo, formatTxDate } from '../src/services/i18n/timeLabels.ts';
import { paymentErrorMessage, invoiceExpiryLabel } from '../src/services/i18n/paymentLabels.ts';
import { PAYMENT_IN_FLIGHT, PAYMENT_OUTCOME_UNKNOWN } from '../src/constants/wallet.ts';
import { formatSats } from '../src/domain/wallet/display.ts';
import { truncateNpub } from '../src/domain/nostr/display.ts';
import { npubEncode } from '../src/lib/crypto/bech32.ts';

it('translated relative dates preserve milliseconds versus transaction seconds', (ctx) => {
  ctx.mock.method(Date, 'now', () => NOW.getTime());
  const nowSeconds = NOW.getTime() / 1000;
  for (const [age, key] of [[0, 'justNow'], [120, 'minutesAgo'], [7200, 'hoursAgo'], [172800, 'daysAgo']] as const) {
    assert.equal(formatTimeAgo(NOW.getTime() - age * 1000), `time.${key}`);
    assert.equal(formatTxDate(nowSeconds - age, NOW), `time.${key}`);
  }
  for (const ts of [0, -1, NaN, Infinity]) assert.equal(formatTxDate(ts, NOW), '—');
  assert.equal(formatTxDate(nowSeconds + 60, NOW), new Date(NOW.getTime() + 60000).toLocaleDateString());
  assert.equal(formatTxDate(nowSeconds - 10 * 86400, NOW), new Date(NOW.getTime() - 10 * 86400000).toLocaleDateString(undefined, {month:'short',day:'numeric'}));
});

it('payment labels preserve actionable provider errors and expiry states', (ctx) => {
  ctx.mock.method(Date, 'now', () => NOW.getTime());
  assert.equal(paymentErrorMessage(new Error(PAYMENT_IN_FLIGHT)), 'wallet.paymentInFlight');
  assert.equal(paymentErrorMessage(new Error(PAYMENT_OUTCOME_UNKNOWN)), 'wallet.paymentOutcomeUnknown');
  assert.equal(paymentErrorMessage(new Error('Provider unavailable')), 'Provider unavailable');
  assert.equal(paymentErrorMessage(null), '');
  const timestamp = NOW.getTime() / 1000;
  assert.equal(invoiceExpiryLabel({timestamp: timestamp - 100, expiry: 1}), 'wallet.invoiceExpired');
  assert.equal(invoiceExpiryLabel({timestamp, expiry: 120}), 'wallet.invoiceMinutes');
  assert.equal(invoiceExpiryLabel({timestamp, expiry: 7200}), 'wallet.invoiceHours');
});

it('feature formatters retain their units and both ends of public keys', () => {
  assert.equal(formatSats(1234.6), `${(1235).toLocaleString()} sats`);
  const pubkey = 'ab'.repeat(32), npub = npubEncode(pubkey);
  assert.equal(truncateNpub(pubkey), `${npub.slice(0,12)}...${npub.slice(-4)}`);
  assert.equal(truncateNpub('invalid-public-key'), 'invalid-...-key');
});
