import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import useRelayCache from '@hooks/useRelayCache.ts';
import { PQC_PUBLISHED_CACHE } from '@shared/relayCacheNames.ts';
import type { PqcPanelStatus, PqcPublished } from '@shared/pqcState.ts';
import { useAccount } from './AccountContext';

interface PqcContextValue {
  /** The full `pqc_getStatus` answer. `null` until the first successful read. */
  status: PqcPanelStatus | null;
  /** The `pqc_checkPublished` answer. `null` when unknown, or when `status`
   *  cannot derive keys and the question was never worth asking relays. */
  published: PqcPublished | null;
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

const PqcContext = createContext<PqcContextValue | null>(null);

interface PqcProviderProps {
  children: ReactNode;
}

/**
 * Post-quantum status and published state, fetched once here.
 *
 * `PqcCard` (home) and `PqcSection` (settings) used to each call
 * `pqc_getStatus` and, when keys can be derived, `pqc_checkPublished` on their
 * own mount — two RPCs, twice, for the same account. The decision logic those
 * two answers feed stays in `@shared/pqcState.ts` (`derivePqcCardState`,
 * `isAlreadyPublished`); this context only supplies the data.
 */
export function PqcProvider({ children }: PqcProviderProps) {
  const { active } = useAccount();
  const [status, setStatus] = useState<PqcPanelStatus | null>(null);
  const [published, setPublished] = useState<PqcPublished | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Run-versioned rather than a per-call `cancelled` flag: this also re-runs
  // whenever the background refreshes its relay cache (below), so two passes
  // can overlap and the slower one must not win by finishing last (docs §9).
  const runRef = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;
    setLoading(true);
    setError('');
    try {
      const nextStatus = await rpc<PqcPanelStatus>('pqc_getStatus');
      if (!current()) return;
      setStatus(nextStatus);

      // An account that cannot derive never reaches the publish UI, so asking
      // relays it will not use would be latency for nothing.
      if (!nextStatus.canDerive) {
        setPublished(null);
        return;
      }

      const nextPublished = await rpc<PqcPublished>('pqc_checkPublished').catch(() => null);
      if (!current()) return;
      setPublished(nextPublished);
    } catch (e: any) {
      if (!current()) return;
      // Leave `status`/`published` at their last known values. A failed read
      // (vault locked, no active account, a cold service worker) is unknown,
      // not "nothing is set up" — that reading previously invited a user who
      // had already published to redo it.
      setError(e?.message || t('common.error'));
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  const applyStatus = useCallback((next: PqcPanelStatus) => {
    setStatus(next);
  }, []);

  // Post-quantum keys are a function of the active account. Key on the id, not
  // the `active` object — AccountContext recomputes it with `.find()` on every
  // render, so an effect keyed on the object re-runs on unrelated writes.
  useEffect(() => {
    if (!active?.id) return;
    refresh();
  }, [active?.id, refresh]);

  // The published check is served from the background's cache
  // (lib/bg/relayCache.ts) so the popup paints without a relay round trip;
  // this picks up the answer once the background finishes refreshing it.
  useRelayCache(PQC_PUBLISHED_CACHE, refresh);

  const value: PqcContextValue = { status, published, loading, error, refresh, applyStatus };

  return <PqcContext.Provider value={value}>{children}</PqcContext.Provider>;
}

export function usePqc(): PqcContextValue {
  const ctx = useContext(PqcContext);
  if (!ctx) throw new Error('usePqc must be used within PqcProvider');
  return ctx;
}
