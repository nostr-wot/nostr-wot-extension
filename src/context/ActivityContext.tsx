import { type ReactNode } from 'react';
import { rpc } from '@services/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';
import type { ActivityEntry } from '@domain/activity/activity.ts';

interface ActivityData {
  log: ActivityEntry[];
}

interface ActivityContextValue {
  log: ActivityEntry[];
  loading: boolean;
  /** True when the most recent read threw. An unread log and a failed read
   *  both used to render as "No activity yet" — the first only briefly, the
   *  second permanently, and neither distinguishable from a genuinely empty
   *  log. On a surface whose job is showing what sites have done with the
   *  user's key, "nothing happened" is the one wrong answer that reassures. */
  loadFailed: boolean;
  refresh: () => Promise<void>;
}

const [ActivityContext, useActivity] = createRequiredContext<ActivityContextValue>('useActivity');

interface ActivityProviderProps {
  /** Gates the read — the log is only worth fetching while the overlay that
   *  shows it is open. Unlike the other providers in this folder, this one is
   *  not mounted for the whole popup lifetime (PopupApp already renders
   *  `ActivityOverlay` and is owned elsewhere); it wraps just that overlay, so
   *  "enabled" has to arrive as a prop rather than being inferred from an
   *  always-mounted tree position. */
  visible: boolean;
  children: ReactNode;
}

/**
 * The activity log, read once here instead of inside `ActivityOverlay`
 * itself — built on the same primitives as the other six contexts in this
 * folder, for consistency, even though this one still has a single consumer.
 */
export function ActivityProvider({ visible, children }: ActivityProviderProps) {
  const { data, loading, error, refresh } = useAsyncResource<ActivityData>(
    { log: [] },
    {
      // `enabled` alone is `visible`'s dependency-array entry — no separate
      // `deps` needed, since re-opening the overlay is exactly `visible`
      // flipping false→true, the same transition `enabled` already tracks.
      enabled: visible,
      load: async (patch) => {
        const log = await rpc<ActivityEntry[]>('getActivityLog') || [];
        patch({ log });
      },
    },
  );

  const value: ActivityContextValue = { log: data.log, loading, loadFailed: !!error, refresh };

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export { useActivity };
