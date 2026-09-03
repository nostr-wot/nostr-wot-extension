import { useState, useEffect, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import type { PendingRequest } from '@lib/types.ts';

/**
 * How many pending requests need the user, for the home badge.
 *
 * Lived inside HomeTab.tsx.
 */
export default function usePendingCount(): number {
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRunRef = useRef(0);
  useEffect(() => {
    async function checkPending() {
      const run = ++pendingRunRef.current;
      try {
        const pending: PendingRequest[] = await rpc('signer_getPending') || [];
        if (run !== pendingRunRef.current) return;
        const actionable = pending.filter((r) => (r.needsPermission || r.waitingForUnlock) && !r.nip46InFlight);
        setPendingCount(actionable.length);
      } catch {
        // A failed read is not "no pending requests". Zeroing the badge on a
        // transport failure hides the queue instead of reporting it; keep the
        // last count we actually managed to read.
        if (run !== pendingRunRef.current) return;
      }
    }
    checkPending();
    const listener = (message: { type?: string }) => {
      if (message.type === 'signerPendingUpdated') checkPending();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  return pendingCount;
}
