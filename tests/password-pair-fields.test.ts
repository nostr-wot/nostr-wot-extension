/**
 * `PasswordPairFields`'s live-checklist half: both requirement booleans at
 * once, not just the first one `validatePasswordPair` would report.
 *
 * This is the piece worth its own test. Six call sites hand-rolled
 * `longEnough` / `matches` / `ready` before this refactor, and five of them
 * never got as far as `ready` at all — they refused only once the button was
 * already pressed. `usePasswordPair` is a thin `useState` wrapper this repo
 * has no harness to render, so the derivation is pulled out pure and tested
 * here instead.
 *
 * Run with:
 *   node --import tsx --test tests/password-pair-fields.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePasswordPairState } from '../src/domain/vault/passwordPair.ts';
import { MIN_PASSWORD_LENGTH } from '@constants/vault.ts';

describe('derivePasswordPairState', () => {
  it('is not ready while too short, even if the two already match', () => {
    const state = derivePasswordPairState('short', 'short');
    assert.equal(state.longEnough, false);
    assert.equal(state.matches, true);
    assert.equal(state.ready, false);
  });

  it('is not ready while mismatched, even once long enough', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, `${long}x`);
    assert.equal(state.longEnough, true);
    assert.equal(state.matches, false);
    assert.equal(state.ready, false);
  });

  it('is ready exactly when both requirements hold', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, long);
    assert.equal(state.longEnough, true);
    assert.equal(state.matches, true);
    assert.equal(state.ready, true);
  });

  it('does not treat an empty confirm as a match', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, '');
    assert.equal(state.matches, false);
  });

  it('carries validatePasswordPair\'s code for a caller with the checklist off', () => {
    assert.equal(derivePasswordPairState('short', 'short').problem, 'tooShort');
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    assert.equal(derivePasswordPairState(long, `${long}x`).problem, 'mismatch');
    assert.equal(derivePasswordPairState(long, long).problem, null);
  });

  it('honours a caller-supplied minimum, same as validatePasswordPair', () => {
    assert.equal(derivePasswordPairState('abcd', 'abcd', 4).ready, true);
    assert.equal(derivePasswordPairState('abc', 'abc', 4).ready, false);
  });
});
