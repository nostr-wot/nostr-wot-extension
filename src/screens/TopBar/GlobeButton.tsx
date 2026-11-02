import useConnectionTemplate from '@hooks/useConnectionTemplate';
import { hasSiteScope } from '@domain/site/siteScope.ts';
import { useState, useEffect, useRef } from 'react';
import { rpc, rpcNotify } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import SiteIcon from '@components/SiteIcon';
import { resolveActiveTabDomain } from '@services/browser/activeTabDomain.ts';
import IconGlobe from '@assets/IconGlobe.tsx';
import Button, { ButtonDanger } from '@components/Button';
import IconButton from '@components/IconButton';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import useBrowserStorage from '@hooks/useBrowserStorage.ts';
import Text from '@components/Text';

export default function GlobeButton() {
  const [domain, setDomain] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
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
  const connected = domain ? hasSiteScope(allowedDomains, domain) : null;

  useOutsideClick(ref, () => setOpen(false), open);

  const connection = useConnectionTemplate(domain, () => { setOpen(false); rpcNotify('configUpdated'); });
  const handleConnect = connection.open;

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

  return (
    <div ref={ref} className="relative">
      {connection.dialog}
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
          <SiteIcon domain={domain} className="w-18 h-18 mb-3" />
          <div className="text-md font-semibold text-heading mb-1 break-all">{domain || '—'}</div>
          <Text variant="secondary" as="div" className="text-xs mb-5">
            {connected === null
              ? t('common.loading')
              : connected
                ? t('globe.connected')
                : t('globe.notConnected')}
          </Text>
          {connected && domain && (
            <ButtonDanger
              small
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full"
            >
              {disconnecting ? t('common.loading') : t('common.disconnect')}
            </ButtonDanger>
          )}
          {connected === false && domain && (
            <>
              <Button small onClick={handleConnect} className="w-full">
                {t('common.connect')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
