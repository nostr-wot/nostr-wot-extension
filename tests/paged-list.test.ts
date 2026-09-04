/**
 * The client-side "load more" window Activity's log is rendered through.
 *
 * `paginate` is the one thing worth getting wrong: whether `hasMore` agrees
 * with what `visible` actually shows. `usePagedList` (src/hooks/) is a thin
 * `useState` wrapper around it and isn't tested here — there is no harness
 * that renders React in this repo (docs/component-standards.md §2).
 *
 * Run with:
 *   node --import tsx --test tests/paged-list.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/shared/pagedList.ts';

describe('paginate', () => {
  it('shows the first `count` items and reports more when the array is longer', () => {
    const result = paginate([1, 2, 3, 4, 5], 3);
    assert.deepEqual(result.visible, [1, 2, 3]);
    assert.equal(result.hasMore, true);
  });

  it('reports no more once the count reaches the array length', () => {
    const result = paginate([1, 2, 3], 3);
    assert.deepEqual(result.visible, [1, 2, 3]);
    assert.equal(result.hasMore, false);
  });

  it('does not throw or fabricate rows when count exceeds the array length', () => {
    const result = paginate([1, 2], 10);
    assert.deepEqual(result.visible, [1, 2]);
    assert.equal(result.hasMore, false);
  });

  it('shows nothing and reports no more for an empty list', () => {
    const result = paginate([], 10);
    assert.deepEqual(result.visible, []);
    assert.equal(result.hasMore, false);
  });

  it('shows nothing when count is zero, even with items available', () => {
    const result = paginate([1, 2, 3], 0);
    assert.deepEqual(result.visible, []);
    assert.equal(result.hasMore, true);
  });
});
