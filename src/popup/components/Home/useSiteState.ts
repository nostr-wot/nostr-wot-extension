import { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import { resolveSiteState } from '@shared/siteState.ts';

export interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
}

/**
 * Which site the popup is looking at, and whether this identity is enabled there.
 *
 * Lived inside HomeTab.tsx. The run-versioning and the `active?.id` keying are
 * the load-bearing parts — see docs/component-standards.md §9.
 */
export default function useSiteState(active: Account | null) {
  const [domain, setDomain] = useState<string | null>(null);
  const [siteState, setSiteState] = useState<string | null>(null); // null = loading, 'empty' | 'notConnected' | 'connected' | 'error'
  const [identityEnabled, setIdentityEnabled] = useState<boolean>(true);

  // Which run of loadHomeState is the current one. Without this the slower of
  // two overlapping runs wins simply by finishing last, and paints its stale
  // answer over the newer one.
  const runRef = useRef(0);

  const loadHomeState = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;

    // Re-enter the loading state so re-runs (e.g. when `active` resolves) don't
    // linger on a stale connected view while async detection is in flight.
    setSiteState(null);
    let resolvedDomain: string | null = null;
    try {
      // Not tab.url: the browser withholds it from us on a site we hold no host
      // permission for, which is now every site. See shared/activeTabDomain.
      const { domain: d, restricted } = await resolveActiveTabDomain();
      if (!current()) return;
      if (restricted || !d) {
        setSiteState('empty');
        return;
      }
      resolvedDomain = d;
      setDomain(d);

      const [allowedR, identityR] = await Promise.allSettled([
        rpc<string[]>('getAllowedDomains'),
        rpc<string[]>('getIdentityDisabledSites'),
      ]);
      if (!current()) return;

      const allowedDomains = allowedR.status === 'fulfilled' ? (allowedR.value || []) : null;
      const identityDisabled = identityR.status === 'fulfilled' ? (identityR.value || []) : [];

      const state = resolveSiteState(allowedDomains, d);
      if (state === 'error') {
        setSiteState('error');
        return;
      }

      const identityDisabledSet = new Set<string>(identityDisabled || []);

      setIdentityEnabled(!identityDisabledSet.has(d));

      setSiteState(state);
    } catch {
      if (!current()) return;
      setSiteState(resolvedDomain ? 'error' : 'empty');
    }
  }, []);

  // `active.id`, not `active`. AccountContext recomputes `active` with
  // `accounts.find(...)` on every render, so any write it watches — including a
  // profileCache write, which happens whenever a profile resolves — hands this
  // effect a new object identity for the same account. It then re-ran the whole
  // detection, reset siteState to null ("Loading…"), and remounted every card
  // below, each of which re-fired its own fetches. With several accounts that is
  // the same work several times over on a single popup open.
  //
  // loadHomeState never reads `active`; it only needed to re-run when the
  // account genuinely changes.
  useEffect(() => {
    loadHomeState();
  }, [active?.id, loadHomeState]);

  // The allowlist can change while this view is mounted — from the globe button
  // in the top bar, or from the background — and the card kept showing whatever
  // it decided when it loaded. That is how the globe and the home card ended up
  // contradicting each other inside one 380px window: the dot went green while
  // the card below it still offered Connect.
  //
  // storage.onChanged rather than a runtime message: runtime messages are not
  // delivered back to the document that sent them, so the popup cannot notify
  // itself this way. See docs/component-standards.md §9.
  useEffect(() => {
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (changes.allowedDomains || changes.identityDisabledSites) loadHomeState();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [loadHomeState]);

  return { domain, siteState, identityEnabled, setIdentityEnabled, loadHomeState };
}
