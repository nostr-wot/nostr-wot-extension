import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  /** Empty string when the last read succeeded (or hasn't run yet). */
  error: string;
  refresh: () => Promise<void>;
  /** Update `data` without a round trip — for a caller that already has the
   *  new value in hand (an RPC's own return value) or that needs to force a
   *  specific field on a failure path that means more than "unknown" (see
   *  `load`'s note on that). Merges shallowly over the previous `data`. Accepts
   *  a function of the previous data instead of a literal when the update
   *  depends on it — PermissionsContext's optimistic `savePermission` computes
   *  the next `rawPerms` from the current one, and two calls issued before a
   *  re-render must not have the second overwrite the first's result with a
   *  value it captured before the first one landed. */
  patch: (next: Partial<T> | ((prev: T) => Partial<T>)) => void;
}

export interface UseAsyncResourceOptions<T> {
  /**
   * Performs one read. Call `patch` as many times as the read has phases —
   * PqcContext patches `status` as soon as it resolves and `published`
   * afterward, so the status half is not withheld behind the slower
   * relay-backed answer.
   *
   * Check `isCurrent()` after every `await` before calling `patch`. This
   * effect can re-run while an earlier pass is still in flight (an account
   * switch mid-read, or a background cache refresh), and the slower of two
   * overlapping runs must not win by finishing last
   * (docs/component-standards.md §10).
   *
   * A failed read is unknown, not a negative answer (§9 again): if `load`
   * throws, this hook's `error` is set but `data` is left exactly where the
   * last `patch` put it — never reset to a default. A context whose failure
   * means something more specific than "unknown" (VaultContext sets
   * `locked: true` on a failed check, deliberately not "unknown") should
   * catch its own error inside `load`, `patch` the deliberate value, and not
   * rethrow.
   */
  load: (patch: (next: Partial<T> | ((prev: T) => Partial<T>)) => void, isCurrent: () => boolean) => Promise<void>;
  /** Re-run when these change — e.g. `[active?.id]` for data that is a
   *  function of the active account. Omit to load once on mount and rely on
   *  `refresh()` or a storage subscription for updates. */
  deps?: DependencyList;
  /** Skip loading while false. Wallet's balance read has nothing to do until
   *  `configType` names a configured provider; this leaves `data` untouched
   *  rather than clearing it, so a genuinely context-specific reset (Wallet
   *  clears the stale balance itself) stays a deliberate, visible line
   *  instead of a side effect of this flag. */
  enabled?: boolean;
}

/**
 * The shape every context in `src/popup/context/` re-implemented by hand:
 * `data`/`loading`/`error` state, a run-versioned `refresh` so a slow pass
 * cannot overwrite a faster later one, and a mount effect that re-runs on a
 * dependency list (typically the active account's id).
 *
 * Deliberately does not own storage subscriptions or context/Provider
 * wiring — see `useStorageWatch` and `createRequiredContext`. Folding those
 * in here would force every consumer through one subscription shape, and
 * PqcContext's is a background relay-cache listener (`useRelayCache`), not a
 * plain storage key match.
 */
export default function useAsyncResource<T>(
  initial: T,
  { load, deps = [], enabled = true }: UseAsyncResourceOptions<T>,
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string>('');

  // Run-versioned rather than a per-call `cancelled` flag: `refresh` can be
  // invoked again (a storage change, a manual retry) while an earlier pass is
  // still in flight, and the slower one must not win by finishing last.
  const runRef = useRef(0);
  // Held in a ref so `refresh`'s identity stays stable across renders even
  // though `load` is usually a fresh closure — callers that pass `refresh` to
  // an effect dependency array (or a storage subscription) must not have it
  // tear down and resubscribe on every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  const patch = useCallback((next: Partial<T> | ((prev: T) => Partial<T>)) => {
    setData((prev) => ({ ...prev, ...(typeof next === 'function' ? next(prev) : next) }));
  }, []);

  const refresh = useCallback(async () => {
    const run = ++runRef.current;
    const isCurrent = () => run === runRef.current;
    setLoading(true);
    setError('');
    try {
      await loadRef.current(patch, isCurrent);
    } catch (e) {
      if (isCurrent()) setError((e as Error)?.message || String(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [patch]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    // `deps` is deliberately spread into a hook-managed array rather than
    // passed as one value: callers supply their own dependency list (an
    // account id, a config type), and this effect must re-run on each entry
    // exactly like a normal `useEffect` would.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh, ...deps]);

  return { data, loading, error, refresh, patch };
}
