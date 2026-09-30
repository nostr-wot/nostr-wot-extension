import OverlayPanel from '@components/OverlayPanel';
import PermissionRulesList from './PermissionRulesList';
import { COMMON_PERM_KEYS } from '@constants/permissions.ts';
import { useState, useEffect, useRef, useImperativeHandle, forwardRef, ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { countDecisions, filterKeysForAccountKind, availablePermKeys } from '@domain/permissions/permissionRules.ts';
import Input from '@components/Input';
import IconShield from '@assets/IconShield.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import { useAccount } from '@context/AccountContext';
import { usePermissions } from '@context/PermissionsContext';
import PermissionsDetailLayout from './PermissionsDetailLayout';
import Button, { ButtonDanger } from '@components/Button';
import Modal from '@components/Modal';
import { createPortal } from 'react-dom';
import DeclinedSites, { describeDeclinedSite, type DeclinedSite } from './DeclinedSites';
import useAsyncResource from '@hooks/useAsyncResource';
import useStorageWatch from '@hooks/useStorageWatch';
import { rpc } from '@services/rpc';
import FormError from '@components/FormError';
import AddRuleModal from './AddRuleModal';
import EmptyState from '@components/EmptyState';
import ListRow from '@components/ListRow';
import Container from '@components/Container';

export interface RulesScreenHandle {
  goBack: () => boolean;
}

interface RulesScreenProps {
  initialDomain?: string | null;
  onBack: () => void;
  onDetailChange?: (domain: string | null) => void;
}

export default forwardRef<RulesScreenHandle, RulesScreenProps>(function RulesScreen({ initialDomain, onDetailChange, onBack }, ref) {
  const { accounts, activeId } = useAccount();
  const permissions = usePermissions();
  const selectedAccountId = activeId;
  const [declinedDomain, setDeclinedDomain] = useState<string | null>(null);
  const { data: declined, error: declinedError, refresh: refreshDeclined } = useAsyncResource<{ sites: DeclinedSite[]; connected: string[] }>({ sites: [], connected: [] }, {
    load: async (patch, current) => {
      const [sites, connected] = await Promise.all([rpc<DeclinedSite[]>('getDismissedDomains'), rpc<string[]>('getAllowedDomains')]);
      if (current()) patch({ sites: sites || [], connected: connected || [] });
    },
  });
  useStorageWatch([{ area: 'local', keys: ['dismissedDomains', 'allowedDomains'] }, { area: 'session', keys: ['sessionDismissedDomains'] }], refreshDeclined);
  const selectedDeclined = declined.sites.find(site => site.domain === declinedDomain);
  const [query, setQuery] = useState<string>('');
  const [detailDomain, setDetailDomain] = useState<string | null>(initialDomain || null);

  const effectiveAccountId = selectedAccountId;

  // Is the currently selected account read-only or NIP-46?
  const selectedAccount = (accounts || []).find((a: any) => a.id === selectedAccountId);
  const isSelectedReadOnly = selectedAccount?.readOnly === true || selectedAccount?.type === 'npub';
  const isSelectedNip46 = selectedAccount?.type === 'nip46';

  // Declined sites share the searchable list and take precedence over dormant rules.
  const domains = [...new Set([...declined.connected, ...permissions.getDomainsForBucket(null), ...permissions.getDomainsForBucket(effectiveAccountId), ...declined.sites.map(site => site.domain)])]
    .filter(domain => domain.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  // Domain detail — derived from provider state
  const ownPerms = detailDomain ? permissions.getForBucket(detailDomain, effectiveAccountId) : {};
  const domainPerms = detailDomain ? permissions.getEffective(detailDomain, effectiveAccountId) : {};
  const inheritedKeys = Object.keys(domainPerms).filter(key => !(key in ownPerms));
  const [actionError, setActionError] = useState('');
  const back = () => detailDomain ? setDetailDomain(null) : onBack();

  // Notify on navigation, using the current callback without treating a new
  // parent callback identity as another navigation event.
  const onDetailChangeRef = useRef(onDetailChange);
  onDetailChangeRef.current = onDetailChange;
  useEffect(() => {
    onDetailChangeRef.current?.(detailDomain);
  }, [detailDomain]);

  // Expose goBack so the parent can navigate back from detail -> list
  useImperativeHandle(ref, () => ({
    goBack: () => {
      if (detailDomain) {
        setDetailDomain(null);
        return true; // handled internally
      }
      return false; // nothing to go back from
    },
  }), [detailDomain]);

  const getPermSummary = (bucketPerms: Record<string, string>): string => {
    const { allow, deny } = countDecisions(bucketPerms);
    const parts: string[] = [];
    if (allow) parts.push(t('perms.allowed', { count: allow }));
    if (deny) parts.push(t('perms.denied', { count: deny }));
    return parts.join(', ') || t('perms.noRules');
  };

  const openDetail = (domain: string) => {
    setDetailDomain(domain);
  };

  const handleChip = async (key: string, decision: string) => {
    setActionError('');
    try {
      if (decision === 'inherit') { await rpc('signer_inheritRule', {domain:detailDomain, key, accountId:effectiveAccountId}); await permissions.reload(); }
      else await permissions.savePermission(detailDomain!, key, decision, effectiveAccountId);
    } catch { setActionError(t('perms.saveFailed')); }
  };

  const handleRevoke = async () => {
    setActionError('');
    try {
      await rpc('signer_clearRuleBucket', {domain:detailDomain, accountId:effectiveAccountId});
      await permissions.reload(); setDetailDomain(null);
    } catch { setActionError(t('perms.saveFailed')); }
  };

  const filterKeysForAccount = (keys: string[]): string[] =>
    filterKeysForAccountKind(keys, { readOnly: isSelectedReadOnly, nip46: isSelectedNip46 }, false);

  // ── Add Rule modal state ──
  const [addRuleOpen, setAddRuleOpen] = useState<boolean>(false);

  const availableKeys = availablePermKeys(COMMON_PERM_KEYS, domainPerms);

  // Detail view
  if (detailDomain) {
    const allKeys = filterKeysForAccount(Object.keys(domainPerms));

    return (
      <OverlayPanel title={t('perms.rules')} onBack={back}>
      <PermissionsDetailLayout domain={detailDomain} actions={
        <Container variant="row" className="justify-between">
          <Button small onClick={() => setAddRuleOpen(true)}><IconPlus size={12} /> {t('perms.addRule')}</Button>
          <ButtonDanger small onClick={handleRevoke}>{t('perms.resetSiteRules')}</ButtonDanger>
        </Container>
      }>
        {allKeys.length === 0 ? (
          <EmptyState
            icon={<IconShield size={24} />}
            text={t('perms.noRules')}
          />
        ) : (
          <PermissionRulesList keys={allKeys} permissions={domainPerms} inheritedKeys={inheritedKeys} accountMode onChange={handleChip} />
        )}

        <FormError>{actionError}</FormError>
      </PermissionsDetailLayout>

        {/* Add Rule modal */}
        {addRuleOpen && (
          <AddRuleModal
            availableKeys={availableKeys}
            onAdd={(key, decision) => permissions.savePermission(detailDomain!, key, decision, effectiveAccountId)}
            onClose={() => setAddRuleOpen(false)}
          />
        )}
      </OverlayPanel>
    );
  }

  // List view
  return (
    <OverlayPanel title={t('perms.rules')} onBack={onBack}>
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
      <Input type="search" label={t('perms.searchSites')} placeholder={t('perms.searchSites')}
        value={query} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} />


      {domains.length === 0 ? (
        <EmptyState
          icon={<IconShield size={24} />}
          text={t('perms.noPermsYet')}
          hint={t('perms.permsHint')}
        />
      ) : (
        <Container className="shrink-0 overflow-x-hidden border border-card-border bg-glass rounded-panel shadow-[0_2px_12px_var(--brand-tint-active)]">
          {domains.map((domain: string) => {
            const bucketPerms = permissions.getEffective(domain, effectiveAccountId);
            const dismissal = declined.sites.find(site => site.domain === domain);
            return (
              <ListRow
                key={domain}
                leading={domain.charAt(0).toUpperCase()}
                title={domain}
                subtitle={dismissal ? describeDeclinedSite(dismissal.until) : getPermSummary(bucketPerms)}
                onClick={() => dismissal ? setDeclinedDomain(domain) : openDetail(domain)}
              />
            );
          })}
        </Container>
      )}

      <FormError>{declinedError}</FormError>
      {declinedError && <Button small onClick={() => void refreshDeclined()}>{t('common.retry')}</Button>}
      {selectedDeclined && createPortal(<Modal title={selectedDeclined.domain} onClose={() => setDeclinedDomain(null)}>
        <DeclinedSites key={selectedDeclined.domain} site={selectedDeclined} onChange={refreshDeclined} onClose={() => setDeclinedDomain(null)} />
      </Modal>, document.body)}

    </Container>
    </OverlayPanel>
  );
});

