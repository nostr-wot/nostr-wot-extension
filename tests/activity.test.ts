/**
 * The activity log's grouping and filtering.
 *
 * `groupActivityEntries` has been shared for a while and had no tests at all;
 * the filter pipeline lived inside ActivityModal, where nothing could reach it.
 * This is the screen a user opens to answer "what has this site done with my
 * key?", so a filter that quietly drops entries is worse than a broken one.
 *
 * Run with:
 *   node --import tsx --test tests/activity.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterActivityEntries,
  countActivityFilters,
  activityDomains,
  buildDayGroups,
  TYPE_METHODS,
  type ActivityEntry,
} from '../src/shared/activity.ts';

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  method: 'signEvent',
  domain: 'alice.example',
  timestamp: 1,
  ...over,
} as ActivityEntry);

describe('filterActivityEntries — type grouping', () => {
  const entries = [
    entry({ method: 'nip04Encrypt' }),
    entry({ method: 'nip44Encrypt' }),
    entry({ method: 'nip04Decrypt' }),
    entry({ method: 'signEvent' }),
  ];

  it('"encrypt" spans both NIP-04 and NIP-44', () => {
    // To someone asking what a site did, the scheme is an implementation
    // detail — grouping only one of the two would under-report it.
    const out = filterActivityEntries(entries, { type: 'encrypt' });
    assert.deepEqual(out.map((e) => e.method), ['nip04Encrypt', 'nip44Encrypt']);
  });

  it('advanced mode can still pick one scheme', () => {
    const out = filterActivityEntries(entries, { type: 'nip44Encrypt' });
    assert.deepEqual(out.map((e) => e.method), ['nip44Encrypt']);
  });

  it('an unknown type narrows nothing rather than hiding everything', () => {
    // An empty screen reads as "no activity", not "your filter is broken".
    assert.equal(filterActivityEntries(entries, { type: 'notAType' }).length, entries.length);
  });

  it('every advertised type maps to at least one method', () => {
    for (const [key, methods] of Object.entries(TYPE_METHODS)) {
      assert.ok(methods.length > 0, `${key} maps to nothing`);
    }
  });
});

describe('filterActivityEntries — counterparty search', () => {
  it('matches the recorded counterparty, case-insensitively', () => {
    const e = entry({ theirPubkey: 'ABCDEF' });
    assert.equal(filterActivityEntries([e], { pubkeyQuery: 'abcd' }).length, 1);
  });

  it('also matches a p tag on the event', () => {
    // The counterparty of a signed event lives in its tags, not on the log
    // entry — searching only `theirPubkey` misses every note mentioning someone.
    const e = entry({ event: { kind: 1, content: '', tags: [['p', 'DEADBEEF']] } } as Partial<ActivityEntry>);
    assert.equal(filterActivityEntries([e], { pubkeyQuery: 'deadbeef' }).length, 1);
  });

  it('does not match an unrelated pubkey', () => {
    const e = entry({ theirPubkey: 'aaaa' });
    assert.equal(filterActivityEntries([e], { pubkeyQuery: 'bbbb' }).length, 0);
  });

  it('an entry with no counterparty and no tags does not throw', () => {
    assert.equal(filterActivityEntries([entry()], { pubkeyQuery: 'x' }).length, 0);
  });
});

describe('filterActivityEntries — account and domain', () => {
  const entries = [
    entry({ pubkey: 'a', domain: 'alice.example' }),
    entry({ pubkey: 'b', domain: 'bob.example' }),
  ];

  it('narrows by account and by site, and combines them', () => {
    assert.equal(filterActivityEntries(entries, { account: 'a' }).length, 1);
    assert.equal(filterActivityEntries(entries, { domain: 'bob.example' }).length, 1);
    assert.equal(filterActivityEntries(entries, { account: 'a', domain: 'bob.example' }).length, 0);
  });

  it('no filters returns everything', () => {
    assert.equal(filterActivityEntries(entries, {}).length, 2);
  });
});

describe('countActivityFilters', () => {
  it('counts only the two the badge represents', () => {
    // Account and domain are chosen from pickers that show their own state;
    // the badge is for the filters hidden behind the panel.
    assert.equal(countActivityFilters({}), 0);
    assert.equal(countActivityFilters({ type: 'encrypt' }), 1);
    assert.equal(countActivityFilters({ type: 'encrypt', pubkeyQuery: 'ab' }), 2);
    assert.equal(countActivityFilters({ account: 'a', domain: 'x' }), 0);
  });
});

describe('activityDomains', () => {
  it('is de-duplicated, sorted, and drops entries with no site', () => {
    const out = activityDomains([
      entry({ domain: 'b.example' }),
      entry({ domain: 'a.example' }),
      entry({ domain: 'b.example' }),
      entry({ domain: undefined }),
    ]);
    assert.deepEqual(out, ['a.example', 'b.example']);
  });
});

describe('buildDayGroups', () => {
  it('inserts a header at each day boundary and nowhere else', () => {
    const out = buildDayGroups([
      { day: 'Mon' }, { day: 'Mon' }, { day: 'Tue' },
    ]);
    assert.deepEqual(out.map((i) => i.type), ['header', 'entry', 'entry', 'header', 'entry']);
    assert.deepEqual(
      out.filter((i) => i.type === 'header').map((i) => (i as { day: string }).day),
      ['Mon', 'Tue'],
    );
  });

  it('handles an empty list', () => {
    assert.deepEqual(buildDayGroups([]), []);
  });

  it('a repeated day after a gap starts a new header', () => {
    // Groups arrive newest-first and are not re-sorted here, so the same day
    // reappearing is a real boundary rather than something to merge.
    const out = buildDayGroups([{ day: 'Mon' }, { day: 'Tue' }, { day: 'Mon' }]);
    assert.equal(out.filter((i) => i.type === 'header').length, 3);
  });
});
