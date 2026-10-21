/**
 * Follow suggestions never trap onboarding behind unreachable relays.
 *
 * Run with:
 *   node --import tsx --test tests/follow-suggestions.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anyProfileReachable, selectFollowSuggestions } from '../src/domain/wizard/followSuggestions.ts';
import { TIER_1 } from '../src/constants/followSuggestions.ts';

describe('selectFollowSuggestions', () => {
  it('picks twelve distinct accounts, one TIER_1 in each half', () => {
    const picked = selectFollowSuggestions();
    assert.equal(picked.length, 12);
    assert.equal(new Set(picked).size, 12);
    assert.equal(picked.slice(0, 5).filter((n) => TIER_1.includes(n)).length >= 1, true);
    assert.equal(picked.slice(5).filter((n) => TIER_1.includes(n)).length >= 1, true);
  });
});

describe('anyProfileReachable', () => {
  it('answers true on the first profile found, without waiting for the rest', async () => {
    const never = new Promise(() => {});
    const result = await anyProfileReachable(['a', 'b'], (pk) => (pk === 'b' ? Promise.resolve({ name: 'b' }) : never), 1000);
    assert.equal(result, true);
  });

  it('answers false once every lookup came back empty or failed', async () => {
    const result = await anyProfileReachable(['a', 'b'], (pk) => (pk === 'a' ? Promise.resolve(null) : Promise.reject(new Error('offline'))), 1000);
    assert.equal(result, false);
  });

  it('answers false at the deadline when relays never answer', async () => {
    const started = Date.now();
    const result = await anyProfileReachable(['a'], () => new Promise(() => {}), 30);
    assert.equal(result, false);
    assert.ok(Date.now() - started < 1000);
  });

  it('answers false with nothing to look up', async () => {
    assert.equal(await anyProfileReachable([], () => Promise.resolve({})), false);
  });
});
