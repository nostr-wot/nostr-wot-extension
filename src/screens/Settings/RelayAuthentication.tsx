import { forwardRef, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthenticationGrant } from '@domain/signing/authentication';
import { connectedSiteOrigins, groupRelayPermissions, type RelayPermissionGroup } from '@domain/signing/relayPermissions';
import { rpc } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import useAsyncResource from '@hooks/useAsyncResource';
import useStorageWatch from '@hooks/useStorageWatch';
import OverlayPanel from '@components/OverlayPanel';
import IconButton from '@components/IconButton';
import IconInfo from '@assets/IconInfo';
import IconShield from '@assets/IconShield';
import Modal from '@components/Modal';
import Card from '@components/Card';
import ListRow from '@components/ListRow';
import Container from '@components/Container';
import Text from '@components/Text';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Checkbox from '@components/Checkbox';
import Toggle from '@components/Toggle';
import SiteIcon from '@components/SiteIcon';

export interface RelayAuthenticationHandle { goBack: () => boolean }
export default forwardRef<RelayAuthenticationHandle, { accountId: string; onBack: () => void }>(function RelayAuthentication({ accountId, onBack }, ref) {
  const [destination, setDestination] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const { data, loading, error, refresh } = useAsyncResource<{ grants: AuthenticationGrant[]; sites: string[] }>({ grants: [], sites: [] }, {
    deps: [accountId],
    load: async (patch, current) => {
      const [grants, sites] = await Promise.all([rpc<AuthenticationGrant[]>('signer_getAuthenticationGrants'), rpc<string[]>('getAllowedDomains')]);
      if (current()) patch({ grants, sites: connectedSiteOrigins(sites) });
    },
  });
  useStorageWatch([{ area: 'local', keys: ['authenticationGrants', 'allowedDomains'] }], refresh);
  const groups = groupRelayPermissions(data.grants, accountId);
  const selected = groups.find(group => group.destination === destination);
  useImperativeHandle(ref, () => ({ goBack: () => { if (!destination) return false; setDestination(null); return true; } }), [destination]);
  const back = () => destination ? setDestination(null) : onBack();
  return <OverlayPanel title={t('auth.relayPermissions')} onBack={back} headerRight={
    <IconButton aria-label={t('auth.relayInfoTitle')} title={t('auth.relayInfoTitle')} onClick={() => setInfoOpen(true)}><IconInfo /></IconButton>
  }>
    {error && <><FormError>{error}</FormError><Button small onClick={() => void refresh()}>{t('common.retry')}</Button></>}
    {loading && <Text variant="hint">{t('common.loading')}</Text>}
    {selected ? <RelaySites key={`${accountId}:${selected.destination}`} group={selected} sites={data.sites} accountId={accountId} onSave={async () => { await refresh(); setDestination(null); }} /> :
      <Container className="flex-1 min-h-0 overflow-y-auto">
        {!loading && !error && !groups.length && <Text variant="hint">{t('auth.noGrants')}</Text>}
        {!!groups.length && <Card className="p-0 overflow-hidden mb-0 shrink-0">
          {groups.map(group => <ListRow key={group.destination} leading={<IconShield />} title={group.destination.replace(/^wss?:\/\//, '').replace(/\/$/, '')}
            subtitle={`${group.allSites ? t('auth.allSitesApproved') : t(group.allowedOrigins.length === 1 ? 'auth.oneSiteApproved' : 'auth.sitesApproved', { count: group.allowedOrigins.length })}${group.deniedOrigins.length ? ` · ${t(group.deniedOrigins.length === 1 ? 'auth.oneSiteBlocked' : 'auth.sitesBlocked', { count: group.deniedOrigins.length })}` : ''}`}
            onClick={() => setDestination(group.destination)} />)}
        </Card>}
      </Container>}
    {infoOpen && createPortal(<Modal title={t('auth.relayInfoTitle')} onClose={() => setInfoOpen(false)}>
      <Text>{t('auth.relayInfo')}</Text><Text>{t('auth.accountOnly')}</Text>
    </Modal>, document.body)}
  </OverlayPanel>;
});

function RelaySites({ group, sites, accountId, onSave }: { group: RelayPermissionGroup; sites: string[]; accountId: string; onSave: () => Promise<void> }) {
  const [allSites, setAllSites] = useState(group.allSites);
  const [revision] = useState(group.revision);
  const [selected, setSelected] = useState(() => group.allowedOrigins.filter(origin => sites.includes(origin)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = [...new Set([...sites, ...group.allowedOrigins, ...group.deniedOrigins])].sort();
  const save = async () => {
    setBusy(true); setError('');
    try {
      await rpc('signer_setRelayAuthenticationSites', { accountId, destination: group.destination, origins: allSites ? [] : selected.filter(origin => sites.includes(origin)), allSites, revision });
      await onSave();
    } catch { setError(t('approval.actionFailed')); }
    finally { setBusy(false); }
  };
  return <Container className="flex-1 min-h-0">
    <Text className="font-semibold break-all">{group.destination}</Text>
    <Container variant="row" className="justify-between py-5 border-b border-card-border">
      <Text>{t('auth.allConnectedSites')}</Text>
      <Toggle aria-label={t('auth.allConnectedSites')} checked={allSites} disabled={busy} onChange={setAllSites} />
    </Container>
    <Text variant="hint">{t('auth.selectRelaySites')}</Text>
    <Container className="flex-1 min-h-0 overflow-y-auto">
      {choices.map(origin => <label key={origin} className="flex items-center gap-4 py-5 border-b border-card-border cursor-pointer">
        <SiteIcon domain={origin} />
        <div className="flex-1 min-w-0">
          <Text className="break-all">{origin}</Text>
          {!sites.includes(origin) && <Text variant="muted">{t('auth.siteDisconnected')}</Text>}
          {group.deniedOrigins.includes(origin) && !selected.includes(origin) && <Text variant="muted">{t('auth.siteBlocked')}</Text>}
        </div>
        <Checkbox aria-label={origin} disabled={busy || allSites || !sites.includes(origin)}
          checked={allSites ? sites.includes(origin) && !group.deniedOrigins.includes(origin) : selected.includes(origin)}
          onChange={event => setSelected(previous => event.target.checked ? [...previous, origin] : previous.filter(site => site !== origin))} />
      </label>)}
    </Container>
    <FormError>{error}</FormError>
    <Button disabled={busy} onClick={() => void save()}>{t('common.save')}</Button>
  </Container>;
}
