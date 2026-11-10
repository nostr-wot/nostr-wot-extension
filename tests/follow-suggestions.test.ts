/**
 * Follow suggestions never trap onboarding behind unreachable relays.
 *
 * Run with:
 *   node --import tsx --test tests/follow-suggestions.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anyProfileReachable, selectFollowSuggestions } from '../src/domain/wizard/followSuggestions.ts';
import { TIER_1, TIER_2 } from '../src/constants/followSuggestions.ts';

describe('selectFollowSuggestions', () => {
  it('uses the updated community identities without the retired recommendations', () => {
    for (const npub of [
      'npub1rujdpkd8mwezrvpqd2rx2zphfaztqrtsfg6w3vdnljdghs2q8qrqtt9u68',
      'npub19tv378w29hx4ljy7wgydreg9nu96czrs6clu8wkzr3af8z86rr7sujx4xe',
      'npub1579rjxygc6n69cg544ndcrj88w04v9e5clcf3j249vh9hwzq6fkqes5jjs',
    ]) assert.equal(TIER_2.filter(value => value === npub).length, 1);
    for (const npub of [
      'npub1spdnfacgsd7lk0nlqkq443tkq4jx9z6c6ksvaquuewmw7d3qltpslcq6j7',
      'npub16c0nh3dnadzqpm76uctf5hqhe2lny344zsmpm6feee9p5rdxaa9q586nvr',
      'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk',
    ]) assert.ok(!TIER_2.includes(npub));
  });
  it('includes the additional curated account in the eligible pool', () => {
    const account = 'npub1rujdpkd8mwezrvpqd2rx2zphfaztqrtsfg6w3vdnljdghs2q8qrqtt9u68';
    assert.equal(TIER_2.filter(npub => npub === account).length, 1);
    assert.ok(selectFollowSuggestions(() => 0.999).includes(account));
  });
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
