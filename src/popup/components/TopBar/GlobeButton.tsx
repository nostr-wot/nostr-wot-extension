import React, { useState, useEffect, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { getFaviconUrl } from '@shared/clientIcons.ts';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import { IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import styles from './TopBar.module.css';
import useOutsideClick from '@shared/hooks/useOutsideClick.ts';

export default function GlobeButton() {
  const [domain, setDomain] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [open, setOpen] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  // Which site is this? Not `tab.url` — the browser withholds it from an
  // extension holding no host permission, which is now every site, so this
  // button went blank on exactly the popups the background opens for a request.
  // See shared/activeTabDomain, which the home card already uses.
  useEffect(() => {
    let cancelled = false;
    resolveActiveTabDomain()
      .then(({ domain: d, restricted }) => {
        if (cancelled || restricted || !d) return;
        setDomain(d);
      })
      .catch(() => { /* nothing to name */ });
    return () => { cancelled = true; };
  }, []);

  // Whether that site is connected is not a question to answer once. The user
  // can connect or disconnect it from the home card without this button
  // unmounting, and it used to keep showing whatever was true when it mounted.
  // The allowlist is the single source of truth (not permissions.contains() —
  // granting <all_urls> would make that read "connected" everywhere), and
  // storage.onChanged is how an open popup hears about a write.
  useEffect(() => {
    if (!domain) return;
    let cancelled = false;

    const read = async () => {
      const allowed = await rpc<string[]>('getAllowedDomains').catch(() => null);
      if (cancelled) return;
      // A read that failed is "unknown", not "not connected". Painting a
      // definite answer from a transport failure invites the user to reconnect
      // a site that was connected all along.
      setConnected(allowed ? allowed.includes(domain) : null);
    };
    read();

    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && changes.allowedDomains) read();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [domain]);

  useOutsideClick(ref, () => setOpen(false), open);

  // One step, same as the home card. See lib/bg/domain-handlers.ts connectDomain.
  //
  // Guarded like handleDisconnect three lines below, which it was not: a failed
  // connectDomain — the worker asleep past rpc()'s three wake retries — was an
  // unhandled rejection, so the dot stayed as it was and the user got no
  // indication that the click had done nothing.
  const handleConnect = async () => {
    if (!domain) return;
    setConnecting(true);
    try {
      await rpc('connectDomain', { domain });
      setConnected(true);
      setOpen(false);
      rpcNotify('configUpdated');
    } catch {
      setConnectError(true);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!domain) return;
    setDisconnecting(true);
    try {
      await rpc('removeAllowedDomain', { domain });
      setConnected(false);
      setOpen(false);
      rpcNotify('configUpdated');
    } catch {
      // failed
    } finally {
      setDisconnecting(false);
    }
  };

  const iconUrl = domain ? getFaviconUrl(domain) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={styles.globeBtn}
        title={t('topbar.siteConnection')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe size={16} />
        {/* Neutral/blank dot while loading (connected === null) so we never
            flash a misleading "connected" or "not connected" state. */}
        {connected !== null && (
          <span className={`${styles.globeDot} ${connected ? styles.globeConnected : styles.globeDisconnected}`} />
        )}
      </button>

      {open && (
        <div className={styles.globePopover}>
          {iconUrl && (
            <img src={iconUrl} alt={domain!} className={styles.clientIconLarge} />
          )}
          <div className={styles.globeDomain}>{domain || '—'}</div>
          <div className={styles.globeStatus}>
            {connected === null
              ? t('common.loading')
              : connected
                ? t('globe.connected')
                : t('globe.notConnected')}
          </div>
          {connected && domain && (
            <Button
              variant="danger"
              small
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{ width: '100%' }}
            >
              {disconnecting ? t('common.loading') : t('common.disconnect')}
            </Button>
          )}
          {connected === false && domain && (
            <>
              {connectError && (
                <div className={styles.globeError}>{t('globe.connectFailed')}</div>
              )}
              <Button small onClick={handleConnect} disabled={connecting} style={{ width: '100%' }}>
                {connecting ? t('common.loading') : t('common.connect')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
