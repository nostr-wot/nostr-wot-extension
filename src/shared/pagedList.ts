/**
 * A slice-based "load more" window over an already-loaded array.
 *
 * Activity's RPC has no server-side offset — `getActivityLog` always returns
 * the whole log (capped at 2000 entries in `lib/bg/activity-handlers.ts`) in
 * one round trip. So unlike `txPager.ts`, which pages a remote API with no
 * server-side filter and fetches pages until enough post-filter matches
 * exist, there is nothing further to fetch here — only a rendered prefix to
 * grow. `usePagedList` (`src/hooks/usePagedList.ts`) is the state wrapper;
 * this is the part worth testing without a React renderer: whether `hasMore`
 * agrees with what `visible` actually shows.
 */

export interface PagedListResult<T> {
  visible: T[];
  hasMore: boolean;
}

/** The first `count` items of `items`, and whether there are more beyond them. */
export function paginate<T>(items: T[], count: number): PagedListResult<T> {
  return { visible: items.slice(0, count), hasMore: items.length > count };
}
