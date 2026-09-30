import { useState } from 'react';
import { createPortal } from 'react-dom';
import OverlayPanel from '@components/OverlayPanel';
import ConfirmDialog from '@components/ConfirmDialog';
import Text from '@components/Text';
import Container from '@components/Container';
import Button, { ButtonDanger } from '@components/Button';
import EmptyState from '@components/EmptyState';
import FormError from '@components/FormError';
import IconGlobe from '@assets/IconGlobe';
import IconPlus from '@assets/IconPlus';
import { COMMON_PERM_KEYS } from '@constants/permissions';
import { filterKeysForAccountKind, availablePermKeys } from '@domain/permissions/permissionRules';
import { hasSiteScope } from '@domain/site/siteScope';
import { useAccount } from '@context/AccountContext';
import { usePermissions } from '@context/PermissionsContext';
import useAsyncResource from '@hooks/useAsyncResource';
import useStorageWatch from '@hooks/useStorageWatch';
import { resolveActiveTabDomain } from '@services/browser/activeTabDomain';
import { rpc } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import PermissionsDetailLayout from './PermissionsDetailLayout';
import PermissionRulesList from './PermissionRulesList';
import AddRuleModal from './AddRuleModal';
import DeclinedSites, { type DeclinedSite } from './DeclinedSites';

/** Only the browser's current website is editable; there is no site-list route. */
export default function RulesScreen({ onBack }: { onBack: () => void }) {
  const { activeId } = useAccount();
  const { data, loading, error, refresh } = useAsyncResource<{domain:string|null; declined?:DeclinedSite}>({domain:null}, {
    load: async (patch, current) => {
      const {domain, restricted} = await resolveActiveTabDomain();
      if (!current()) return;
      if (!domain || restricted) { patch({domain:null, declined:undefined}); return; }
      const dismissed = await rpc<DeclinedSite[]>('getDismissedDomains');
      if (current()) patch({domain, declined:dismissed.find(site => hasSiteScope([site.domain], domain))});
    },
  });
  useStorageWatch([{area:'local',keys:['dismissedDomains']},{area:'session',keys:['sessionDismissedDomains']}], refresh);
  return <OverlayPanel title={t('perms.rules')} onBack={onBack}>
    {loading ? <Text variant="hint">{t('common.loading')}</Text> : error ? <>
      <FormError>{error}</FormError><Button small onClick={() => void refresh()}>{t('common.retry')}</Button>
    </> : !data.domain ? <EmptyState icon={<IconGlobe size={24} />} text={t('perms.visitSite')} />
      : data.declined ? <Container gap={4}>
        <Text>{data.domain}</Text>
        <DeclinedSites key={data.declined.domain} site={data.declined} onChange={refresh} />
      </Container>
      : <SiteRulesEditor key={`${data.domain}:${activeId}`} domain={data.domain} />}
  </OverlayPanel>;
}

function SiteRulesEditor({domain}:{domain:string}) {
  const { accounts, activeId } = useAccount();
  const permissions = usePermissions();
  const account = accounts?.find(account => account.id === activeId);
  const own = permissions.getForBucket(domain, activeId);
  const rules = permissions.getEffective(domain, activeId);
  const inheritedKeys = Object.keys(rules).filter(key => !(key in own));
  const keys = filterKeysForAccountKind(Object.keys(rules), {readOnly:account?.readOnly === true || account?.type === 'npub', nip46:account?.type === 'nip46'}, false);
  const [addOpen, setAddOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (key:string, decision:string) => {
    setError('');
    try {
      if (decision === 'inherit') { await rpc('signer_inheritRule', {domain,key,accountId:activeId}); await permissions.reload(); }
      else await permissions.savePermission(domain,key,decision,activeId);
    } catch { setError(t('perms.saveFailed')); }
  };
  const reset = async () => {
    setBusy(true); setError('');
    try {
      await rpc('signer_clearRuleBucket', {domain,accountId:activeId});
      await permissions.reload(); setResetOpen(false);
    } catch { setError(t('perms.saveFailed')); }
    finally { setBusy(false); }
  };
  return <>
    <PermissionsDetailLayout domain={domain} actions={<Container variant="row" className="justify-between">
      <Button small disabled={!activeId || !permissions.loaded} onClick={() => setAddOpen(true)}><IconPlus size={12} /> {t('perms.addRule')}</Button>
      <ButtonDanger small disabled={!activeId || !permissions.loaded} onClick={() => setResetOpen(true)}>{t('perms.resetSiteRules')}</ButtonDanger>
    </Container>}>
      {keys.length ? <PermissionRulesList keys={keys} permissions={rules} inheritedKeys={inheritedKeys} accountMode onChange={save} />
        : <EmptyState icon={<IconGlobe size={24} />} text={t('perms.noRules')} />}
      <FormError>{error}</FormError>
    </PermissionsDetailLayout>
    {addOpen && <AddRuleModal availableKeys={availablePermKeys(COMMON_PERM_KEYS,rules)} onAdd={save} onClose={() => setAddOpen(false)} />}
    {resetOpen && createPortal(<ConfirmDialog title={t('perms.resetSiteRules')} message={t('perms.resetSiteRulesConfirm',{site:domain})}
      danger busy={busy} error={error} onConfirm={() => void reset()} onCancel={() => setResetOpen(false)} />,document.body)}
  </>;
}
