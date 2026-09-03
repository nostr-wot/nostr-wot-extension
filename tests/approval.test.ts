/**
 * The approval queue's decision logic.
 *
 * The first suite is the one that matters: `filterPendingForDomain` is a
 * cross-site isolation boundary. It lived inline in ApprovalOverlay with a
 * comment explaining why it must fail closed, and nothing anywhere asserted
 * that it does. A refactor that "simplified" the falsy-domain branch back to
 * returning everything would have been green.
 *
 * Run with:
 *   node --import tsx --test tests/approval.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPendingForDomain,
  partitionPending,
  groupApprovals,
  groupNip46,
  asGroup,
  liveIds,
  isRequestLive,
  isGroupLive,
  type PendingRequest,
} from '../src/shared/approval.ts';

const req = (over: Partial<PendingRequest> & { id: string; origin: string }): PendingRequest => ({
  type: 'signEvent',
  timestamp: 0,
  ...over,
});

describe('filterPendingForDomain — cross-site isolation', () => {
  const pending = [
    req({ id: 'a', origin: 'alice.example' }),
    req({ id: 'b', origin: 'bob.example' }),
    req({ id: 'c', origin: 'alice.example' }),
  ];

  it('shows only the current origin', () => {
    assert.deepEqual(
      filterPendingForDomain(pending, 'alice.example').map((r) => r.id),
      ['a', 'c'],
    );
  });

  it('shows NOTHING when the domain is unknown', () => {
    // Each of these is a real way the origin read can come back empty: a
    // chrome:// tab, a failed resolve, a service worker that has not woken yet.
    for (const unknown of [null, undefined, '']) {
      assert.deepEqual(
        filterPendingForDomain(pending, unknown as string | null),
        [],
        `an unknown domain (${JSON.stringify(unknown)}) must not leak another site's requests`,
      );
    }
  });

  it('does not match on a suffix or a prefix', () => {
    const tricky = [
      req({ id: 'x', origin: 'evil-alice.example' }),
      req({ id: 'y', origin: 'alice.example.evil.com' }),
    ];
    assert.deepEqual(filterPendingForDomain(tricky, 'alice.example'), []);
  });
});

describe('partitionPending', () => {
  it('keeps an in-flight NIP-46 request out of the actionable queue', () => {
    // It is waiting on a remote signer, not on the user — offering Approve
    // would be offering an answer to a question nobody asked.
    const p = partitionPending([
      req({ id: 'a', origin: 's', needsPermission: true }),
      req({ id: 'b', origin: 's', needsPermission: true, nip46InFlight: true }),
    ]);
    assert.deepEqual(p.actionable.map((r) => r.id), ['a']);
    assert.deepEqual(p.nip46InFlight.map((r) => r.id), ['b']);
  });

  it('collects unlock waiters independently of the other two queues', () => {
    const p = partitionPending([
      req({ id: 'a', origin: 's', waitingForUnlock: true }),
      req({ id: 'b', origin: 's', needsPermission: true, waitingForUnlock: true }),
    ]);
    assert.deepEqual(p.unlockWaiters.map((r) => r.id), ['a', 'b']);
    assert.deepEqual(p.actionable.map((r) => r.id), ['b']);
  });

  it('treats a request needing nothing as belonging to no queue', () => {
    const p = partitionPending([req({ id: 'a', origin: 's' })]);
    assert.deepEqual([p.actionable, p.nip46InFlight, p.unlockWaiters], [[], [], []]);
  });
});

describe('groupApprovals', () => {
  it('groups by origin and permKey', () => {
    const groups = groupApprovals([
      req({ id: '1', origin: 's', permKey: 'signEvent:1' }),
      req({ id: '2', origin: 's', permKey: 'signEvent:1' }),
      req({ id: '3', origin: 's', permKey: 'signEvent:7' }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].requests.map((r) => r.id), ['1', '2']);
    assert.deepEqual(groups[1].requests.map((r) => r.id), ['3']);
  });

  it('never merges two origins that want the same permission', () => {
    const groups = groupApprovals([
      req({ id: '1', origin: 'alice.example', permKey: 'signEvent:1' }),
      req({ id: '2', origin: 'bob.example', permKey: 'signEvent:1' }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((g) => g.origin), ['alice.example', 'bob.example']);
  });

  it('falls back to the request type when there is no permKey', () => {
    const groups = groupApprovals([req({ id: '1', origin: 's', type: 'nip04.encrypt' })]);
    assert.equal(groups[0].permKey, 'nip04.encrypt');
    assert.equal(groups[0].method, 'nip04.encrypt');
  });
});

describe('groupNip46', () => {
  it('groups by type and flags the group in-flight', () => {
    const groups = groupNip46([
      req({ id: '1', origin: 's', type: 'connect', nip46InFlight: true }),
      req({ id: '2', origin: 's', type: 'connect', nip46InFlight: true }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].nip46InFlight, true);
    assert.equal(groups[0].requests.length, 2);
  });
});

describe('stale-selection reconciliation', () => {
  const pending = [req({ id: 'a', origin: 's' })];
  const live = liveIds(pending);

  it('a selection whose request is gone is not live', () => {
    assert.equal(isRequestLive(req({ id: 'gone', origin: 's' }), live), false);
    assert.equal(isRequestLive(req({ id: 'a', origin: 's' }), live), true);
    assert.equal(isRequestLive(null, live), false);
  });

  it('a group survives while any one of its requests survives', () => {
    const partly = { origin: 's', method: 'signEvent', permKey: 'p', requests: [req({ id: 'gone', origin: 's' }), req({ id: 'a', origin: 's' })] };
    const allGone = { origin: 's', method: 'signEvent', permKey: 'p', requests: [req({ id: 'gone', origin: 's' })] };
    assert.equal(isGroupLive(partly, live), true);
    assert.equal(isGroupLive(allGone, live), false);
    assert.equal(isGroupLive(null, live), false);
  });
});

describe('asGroup', () => {
  it('produces the group the group handlers already expect', () => {
    const g = asGroup(req({ id: '1', origin: 's', permKey: 'signEvent:1' }));
    assert.deepEqual(g.requests.map((r) => r.id), ['1']);
    assert.equal(g.origin, 's');
    assert.equal(g.permKey, 'signEvent:1');
  });

  it('falls back to the type, matching groupApprovals', () => {
    // The four single-request handlers each repeated this fallback by hand.
    // If it drifted from groupApprovals, approving one request and approving a
    // group of one would write different permission keys.
    const r = req({ id: '1', origin: 's', type: 'nip04Encrypt' });
    assert.equal(asGroup(r).permKey, groupApprovals([r])[0].permKey);
  });
});
