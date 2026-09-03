/**
 * The "new password, twice" rule.
 *
 * Trivial on its own; the point is that it had eight hand-written copies
 * guarding encrypted key exports, vault creation and the change-password form.
 *
 * Run with:
 *   node --import tsx --test tests/password-pair.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordPair, MIN_PASSWORD_LENGTH } from '../src/shared/passwordPair.ts';

describe('validatePasswordPair', () => {
  it('accepts a long enough matching pair', () => {
    assert.equal(validatePasswordPair('correct horse', 'correct horse'), null);
  });

  it('rejects one character short, and accepts exactly the minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH);
    assert.equal(validatePasswordPair(short, short), 'tooShort');
    assert.equal(validatePasswordPair(exact, exact), null);
  });

  it('reports the length before the mismatch', () => {
    // Telling someone their passwords do not match, when the real objection is
    // that both are too short, sends them to fix the wrong thing.
    assert.equal(validatePasswordPair('abc', 'xyz'), 'tooShort');
  });

  it('rejects a mismatch once both are long enough', () => {
    assert.equal(validatePasswordPair('longenough1', 'longenough2'), 'mismatch');
  });

  it('treats an empty confirm as a mismatch, not as acceptable', () => {
    assert.equal(validatePasswordPair('longenough1', ''), 'mismatch');
  });

  it('honours a caller-supplied minimum', () => {
    assert.equal(validatePasswordPair('abcd', 'abcd', 4), null);
    assert.equal(validatePasswordPair('abc', 'abc', 4), 'tooShort');
  });
});
