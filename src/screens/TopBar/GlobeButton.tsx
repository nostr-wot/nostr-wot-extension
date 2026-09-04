import { useState, useEffect, useRef } from 'react';
import { rpc, rpcNotify } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import { getFaviconUrl } from '@utils/faviconUrl.ts';
import { resolveActiveTabDomain } from '@domain/site/activeTabDomain.ts';
import { IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import IconButton from '@components/IconButton/IconButton';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import useBrowserStorage from '@hooks/useBrowserStorage.ts';

export default function GlobeButton() {
  const [domain, setDomain] = useState<string | null>(null);
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
  // granting <all_urls> would make that read "connected" everywhere), read
  // directly rather than through an RPC: this used to ask the background for
  // `getAllowedDomains` and treat a failure as "unknown" rather than "not
  // connected", because that call could stall for seconds behind a sleeping
  // service worker's wake retries. A same-process `storage.local` read has no
  // such stall, so the value can come straight from useBrowserStorage, which
  // already re-reads on the write this button's own connect/disconnect makes.
  const allowedDomains = useBrowserStorage<string[]>('allowedDomains', [], 'local');
  const connected = domain ? allowedDomains.includes(domain) : null;

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
      // `allowedDomains` already reflects this write by the time `rpc()`
      // resolves — `connectDomain` awaits the storage.local.set before
      // returning — so `connected` above updates on its own; nothing to set here.
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
    <div ref={ref} className="relative">
      <IconButton
        tone="brand"
        className="relative"
        title={t('topbar.siteConnection')}
        aria-label={t('topbar.siteConnection')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe size={16} />
        {/* Neutral/blank dot while loading (connected === null) so we never
            flash a misleading "connected" or "not connected" state. */}
        {connected !== null && (
          <span
            className={`absolute top-2 right-2 size-3.5 rounded-full border-[1.5px] border-[rgba(255,255,255,0.8)] ${connected ? 'bg-success-bright' : 'bg-error-bright'}`}
          />
        )}
      </IconButton>

      {open && (
        <div className="absolute top-full right-0 mt-2 bg-elevated border border-card-border rounded-panel py-6 px-7 z-[calc(var(--z-topbar)+1)] shadow-pop min-w-100 text-center">
          {iconUrl && (
            <img src={iconUrl} alt={domain!} className="w-16 h-16 rounded-sm object-contain mb-3" />
          )}
          <div className="text-md font-semibold text-heading mb-1 break-all">{domain || '—'}</div>
          <div className="text-xs text-secondary mb-5">
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
                <div className="text-xs text-error mb-4">{t('globe.connectFailed')}</div>
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
