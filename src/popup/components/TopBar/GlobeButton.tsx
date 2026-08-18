import React, { useState, useEffect, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { getClientIconUrl } from '@shared/clientIcons.ts';
import { IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import styles from './TopBar.module.css';

export default function GlobeButton() {
  const [domain, setDomain] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [open, setOpen] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function check() {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          const url = new URL(tab.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            setDomain(url.hostname);
            // Derive connection from the allowlist (single source of truth),
            // not browser.permissions.contains() — granting <all_urls> would
            // make that read "connected" on every site.
            const allowed = await rpc<string[]>('getAllowedDomains').catch(() => null);
            setConnected(allowed ? allowed.includes(url.hostname) : false);
          }
        }
      } catch {
        // No access to tabs
      }
    }
    check();
  }, []);

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  // One step, same as the home card. See lib/bg/domain-handlers.ts connectDomain.
  const handleConnect = async () => {
    if (!domain) return;
    await rpc('connectDomain', { domain });
    setConnected(true);
    rpcNotify('configUpdated');
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

  const iconUrl = domain ? getClientIconUrl(domain) : null;

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
            <Button small onClick={handleConnect} style={{ width: '100%' }}>
              {t('common.connect')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
