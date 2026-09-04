import { useCallback, useMemo, useState } from 'react';
import { paginate } from '@shared/pagedList.ts';

export interface PagedList<T> {
  visible: T[];
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
}

/**
 * Reveals a growing prefix of an already-loaded array instead of rendering
 * all of it — for a list that only gets longer (Activity's log), rendering
 * every row is real, avoidable DOM cost even though the data itself is
 * already in memory.
 *
 * `reset()` is explicit rather than inferred from `items` changing identity,
 * because that identity already changes on every background refresh under
 * the same filters (a new entry arriving) — collapsing the window back to one
 * page on that would yank it out from under someone mid-scroll. Only an
 * actual filter change should reset it; callers do that themselves (see
 * ActivityOverlay, which resets when its filters change or the overlay
 * reopens).
 */
export default function usePagedList<T>(items: T[], pageSize: number): PagedList<T> {
  const [count, setCount] = useState(pageSize);
  const { visible, hasMore } = useMemo(() => paginate(items, count), [items, count]);
  const loadMore = useCallback(() => setCount((c) => c + pageSize), [pageSize]);
  const reset = useCallback(() => setCount(pageSize), [pageSize]);
  return { visible, hasMore, loadMore, reset };
}
