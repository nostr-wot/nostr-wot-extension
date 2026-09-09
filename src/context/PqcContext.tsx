import { useCallback, type ReactNode } from 'react';
import { rpc } from '@services/rpc.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { mergePqcStatus, mergePqcPublished } from '@domain/pqc/pqcState.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import { PQC_PUBLISHED_CACHE } from '@services/relayCacheNames.ts';
import type { PqcPanelStatus, PqcPublished } from '@domain/pqc/pqcState.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';
import { useAccount } from './AccountContext';

interface PqcData {
  /** The full `pqc_getStatus` answer. `null` until the first successful read. */
  status: PqcPanelStatus | null;
  /** The `pqc_checkPublished` answer. `null` when unknown, or when `status`
   *  cannot derive keys and the question was never worth asking relays. */
  published: PqcPublished | null;
}

interface PqcContextValue extends PqcData {
  /** True while a read is in flight. Consumers that already have a `status`
   *  should keep rendering it rather than blank on this — see PqcSection. */
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  /** Optimistic update for callers that already hold the new status from an
   *  RPC's own return value (`pqc_importKeys`) — refetching would repeat a
   *  round trip whose answer is already in hand. */
  applyStatus: (status: PqcPanelStatus) => void;
}

const [PqcContext, usePqc] = createRequiredContext<PqcContextValue>('usePqc');

interface PqcProviderProps {
  children: ReactNode;
}

/**
 * Post-quantum status and published state, fetched once here.
 *
 * `PqcCard` (home) and `PqcSection` (settings) used to each call
 * `pqc_getStatus` and, when keys can be derived, `pqc_checkPublished` on their
 * own mount — two RPCs, twice, for the same account. The decision logic those
 * two answers feed stays in `@domain/pqc/pqcState.ts` (`derivePqcCardState`,
 * `isAlreadyPublished`); this context only supplies the data.
 */
export function PqcProvider({ children }: PqcProviderProps) {
  const { active } = useAccount();

  const { data, loading, error, refresh, patch } = useAsyncResource<PqcData>(
    { status: null, published: null },
    {
      // Post-quantum keys are a function of the active account. Key on the
      // id, not the `active` object — AccountContext recomputes it with
      // `.find()` on every render, so an effect keyed on the object re-runs
      // on unrelated writes.
      deps: [active?.id],
      enabled: !!active?.id,
      load: async (patch, isCurrent) => {
        const nextStatus = await rpc<PqcPanelStatus>('pqc_getStatus');
        if (!isCurrent() || nextStatus.pubkey !== active?.pubkey) return;
        patch(previous => mergePqcStatus(previous, nextStatus));

        // An account that cannot derive never reaches the publish UI, so
        // asking relays it will not use would be latency for nothing.
        if (!nextStatus.canDerive) {
          patch({ published: null });
          return;
        }

        const nextPublished = await rpc<PqcPublished>('pqc_checkPublished').catch(() => null);
        if (!isCurrent()) return;
        patch(previous => ({ published: mergePqcPublished(previous.published, nextPublished) }));
      },
    },
  );

  const applyStatus = useCallback((next: PqcPanelStatus) => {
    patch(previous => mergePqcStatus(previous, next));
  }, [patch]);

  // The published check is served from the background's cache
  // (lib/bg/relayCache.ts) so the popup paints without a relay round trip;
  // this picks up the answer once the background finishes refreshing it. Runs
  // through the same run-versioned `refresh` as the mount effect, so this can
  // overlap an account-switch read in flight without the slower one winning.
  useStorageWatch([{ area: 'local', keys: [`relayCache_${PQC_PUBLISHED_CACHE}_${active?.pubkey}`] }], refresh);

  const current = data.status?.pubkey === active?.pubkey ? data : { status: null, published: null };
  const value: PqcContextValue = { ...current, loading, error, refresh, applyStatus };

  return <PqcContext.Provider value={value}>{children}</PqcContext.Provider>;
}

export { usePqc };
