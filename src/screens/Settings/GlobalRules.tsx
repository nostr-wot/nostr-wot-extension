import { useState } from 'react';
import { createPortal } from 'react-dom';
import { COMMON_PERM_KEYS, GLOBAL_RULES_SCOPE } from '@constants/permissions';
import { availablePermKeys } from '@domain/permissions/permissionRules';
import { usePermissions } from '@context/PermissionsContext';
import { rpc } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import Text from '@components/Text';
import Button, { ButtonDanger } from '@components/Button';
import ConfirmDialog from '@components/ConfirmDialog';
import EmptyState from '@components/EmptyState';
import FormError from '@components/FormError';
import IconPlus from '@assets/IconPlus';
import IconShield from '@assets/IconShield';
import AddRuleModal from './AddRuleModal';
import PermissionRulesList from './PermissionRulesList';

/** Shared defaults have no selected website or website-list navigation. */
export default function GlobalRules({ onBack, onOpenSiteRules }: { onBack: () => void; onOpenSiteRules?: () => void }) {
  const permissions = usePermissions();
  const rules = permissions.getForBucket(GLOBAL_RULES_SCOPE);
  const [addOpen, setAddOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (key: string, decision: string) => {
    setError('');
    try { await permissions.savePermission(GLOBAL_RULES_SCOPE, key, decision); }
    catch { setError(t('perms.saveFailed')); }
  };
  const reset = async () => {
    setBusy(true); setError('');
    try { await rpc('signer_resetAccountRules'); await permissions.reload(); setResetOpen(false); }
    catch { setError(t('perms.saveFailed')); }
    finally { setBusy(false); }
  };
  return <OverlayPanel title={t('perms.globalRules')} onBack={onBack}>
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
      <Text variant="muted">{t('perms.globalRulesInfo')}</Text>
      <Container variant="row"><Button small onClick={() => setAddOpen(true)}><IconPlus size={12} /> {t('perms.addRule')}</Button></Container>
      {Object.keys(rules).length
        ? <PermissionRulesList keys={Object.keys(rules)} permissions={rules} onChange={save} />
        : <EmptyState icon={<IconShield size={24} />} text={t('perms.noRules')} />}
      <ButtonDanger small onClick={() => setResetOpen(true)}>{t('perms.resetAccountRules')}</ButtonDanger>
      <FormError>{error}</FormError>
      {onOpenSiteRules && <Button small onClick={onOpenSiteRules}>{t('perms.goToCurrentSite')}</Button>}
    </Container>
    {addOpen && <AddRuleModal availableKeys={availablePermKeys(COMMON_PERM_KEYS.filter(key => !['signEvent:22242', 'signEvent:24242', 'signEvent:27235'].includes(key)), rules)} onAdd={save} onClose={() => setAddOpen(false)} />}
    {resetOpen && createPortal(<ConfirmDialog title={t('perms.resetAccountRules')} message={t('perms.resetAccountRulesHint')}
      busy={busy} error={error} danger onConfirm={() => void reset()} onCancel={() => setResetOpen(false)} />, document.body)}
  </OverlayPanel>;
}
