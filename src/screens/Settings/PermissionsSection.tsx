import PermissionRulesList from './PermissionRulesList';
import { COMMON_PERM_KEYS } from '@constants/permissions.ts';
import { useState, useEffect, useImperativeHandle, forwardRef, ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { countDecisions, filterKeysForAccountKind, availablePermKeys } from '@domain/permissions/permissionRules.ts';
import Input from '@components/Input/Input';
import IconShield from '@assets/IconShield.tsx';
import IconUsers from '@assets/IconUsers.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import { useAccount } from '@context/AccountContext';
import { usePermissions } from '@context/PermissionsContext';
import PermissionsDetailLayout from './PermissionsDetailLayout';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import DeclinedSites from './DeclinedSites';
import AddRuleModal from './AddRuleModal';
import Toggle from '@components/Toggle/Toggle';
import EmptyState from '@components/EmptyState/EmptyState';
import ListRow from '@components/ListRow/ListRow';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

export interface PermissionsSectionHandle {
  goBack: () => boolean;
}

interface PermissionsSectionProps {
  initialDomain?: string | null;
  onDetailChange?: (domain: string | null) => void;
}

export default forwardRef<PermissionsSectionHandle, PermissionsSectionProps>(function PermissionsSection({ initialDomain, onDetailChange }, ref) {
  const { accounts, activeId, profileCache } = useAccount();
  const permissions = usePermissions();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [detailDomain, setDetailDomain] = useState<string | null>(initialDomain || null);

  const allAccountsMode = permissions.useGlobalDefaults;

  // When toggle is ON, use _default (null) for global permissions; otherwise per-account
  const effectiveAccountId = allAccountsMode ? null : selectedAccountId;

  // Is the currently selected account read-only or NIP-46?
  const selectedAccount = (accounts || []).find((a: any) => a.id === selectedAccountId);
  const isSelectedReadOnly = selectedAccount?.readOnly === true || selectedAccount?.type === 'npub';
  const isSelectedNip46 = selectedAccount?.type === 'nip46';

  // Derive the visible domains from the provider for the current bucket
  const domains = permissions.getDomainsForBucket(effectiveAccountId)
    .filter((d: string) => !query || d.toLowerCase().includes(query.toLowerCase()));

  // Domain detail — derived from provider state
  const domainPerms: Record<string, string> = detailDomain ? permissions.getForBucket(detailDomain, effectiveAccountId) : {};

  // Initialize selected account to active account
  useEffect(() => {
    if (activeId && selectedAccountId === null) {
      setSelectedAccountId(activeId);
    }
  }, [activeId, selectedAccountId]);

  // Notify parent when entering/leaving detail view
  useEffect(() => {
    onDetailChange?.(detailDomain);
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
    await permissions.savePermission(detailDomain!, key, decision, effectiveAccountId);
  };

  const handleRevoke = async () => {
    await permissions.clearPermissions(detailDomain!, effectiveAccountId);
    setDetailDomain(null);
  };

  const handleAccountChange = (val: string) => {
    setSelectedAccountId(val);
  };

  const getAccountLabel = (a: any): string => {
    const profile = profileCache[a.pubkey];
    if (profile?.name) return profile.name;
    if (a.name) return a.name;
    return a.pubkey?.slice(0, 12) + '...';
  };

  const filterKeysForAccount = (keys: string[]): string[] =>
    filterKeysForAccountKind(keys, { readOnly: isSelectedReadOnly, nip46: isSelectedNip46 }, allAccountsMode);

  // Account scope picker block
  const hasMultipleAccounts = accounts && accounts.length > 1;
  const accountOptions = (accounts || []).map((a: any) => ({ value: a.id, label: getAccountLabel(a) }));

  const accountScopeBlock = hasMultipleAccounts && (
    <Container gap={3} className="pb-5 mb-3 border-b border-card-border">
      <Card className="p-0 overflow-hidden mb-0">
        <Container variant="row" className="justify-between py-5.5 px-7">
          <Container variant="row" gap={4}>
            <IconUsers size={15} className="text-brand shrink-0" />
            <div>
              <span className="text-md font-medium text-body">{t('perms.allAccounts')}</span>
              <Text variant="muted" as="div" className="mt-px">
                {allAccountsMode ? t('perms.allAccountsOnHint') : t('perms.allAccountsOffHint')}
              </Text>
            </div>
          </Container>
          <Toggle checked={allAccountsMode} onChange={(val: boolean) => {
            void permissions.setUseGlobalDefaults(val);
          }} />
        </Container>
      </Card>

      {!allAccountsMode && (
        <>
          <span className="text-xs font-semibold text-secondary mb-1">{t('perms.accountLabel')}</span>
          <Dropdown
            options={accountOptions}
            value={selectedAccountId || ''}
            onChange={handleAccountChange}
            small
          />
        </>
      )}

      {!allAccountsMode && isSelectedReadOnly && (
        <Container variant="box" gap={1} className="rounded-md border-card-active mb-4">
          <span className="text-sm font-semibold text-brand">{t('perms.readOnlyTitle')}</span>
          <span className="text-xs text-muted leading-normal">{t('perms.readOnlyHint')}</span>
        </Container>
      )}

      {!allAccountsMode && isSelectedNip46 && (
        <Container variant="box" gap={1} className="rounded-md border-card-active mb-4">
          <span className="text-sm font-semibold text-brand">{t('perms.managedBySigner')}</span>
          <span className="text-xs text-muted leading-normal">{t('perms.managedBySignerHint')}</span>
        </Container>
      )}
    </Container>
  );

  // ── Add Rule modal state ──
  const [addRuleOpen, setAddRuleOpen] = useState<boolean>(false);

  const availableKeys = availablePermKeys(COMMON_PERM_KEYS, domainPerms);

  // Detail view
  if (detailDomain) {
    const allKeys = filterKeysForAccount(Object.keys(domainPerms));

    return (
      <>
      <PermissionsDetailLayout domain={detailDomain} actions={
        <Container variant="row" className="justify-between">
          <Button small onClick={() => setAddRuleOpen(true)}><IconPlus size={12} /> {t('perms.addRule')}</Button>
          <Button variant="danger" small onClick={handleRevoke}>{t('perms.revokeAll')}</Button>
        </Container>
      }>
        {allKeys.length === 0 ? (
          <EmptyState
            icon={<IconShield size={24} />}
            text={t('perms.noRules')}
          />
        ) : (
          <PermissionRulesList keys={allKeys} permissions={domainPerms} onChange={handleChip} />
        )}

      </PermissionsDetailLayout>

        {/* Add Rule modal */}
        {addRuleOpen && (
          <AddRuleModal
            availableKeys={availableKeys}
            onAdd={(key, decision) => permissions.savePermission(detailDomain!, key, decision, effectiveAccountId)}
            onClose={() => setAddRuleOpen(false)}
          />
        )}
      </>
    );
  }

  // List view
  return (
    <Container gap={4} className="flex-1 min-h-0 py-2">
      {accountScopeBlock}

      <Input type="search" label={t('perms.searchSites')} placeholder={t('perms.searchSites')}
        value={query} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} />


      {domains.length === 0 ? (
        <EmptyState
          icon={<IconShield size={24} />}
          text={t('perms.noPermsYet')}
          hint={t('perms.permsHint')}
        />
      ) : (
        <Container className="flex-1 overflow-y-auto overflow-x-hidden border border-card-border bg-glass rounded-panel shadow-[0_2px_12px_var(--brand-tint-active)]">
          {domains.map((domain: string) => {
            const bucketPerms = permissions.getForBucket(domain, effectiveAccountId);
            return (
              <ListRow
                key={domain}
                leading={domain.charAt(0).toUpperCase()}
                title={domain}
                subtitle={getPermSummary(bucketPerms)}
                onClick={() => openDetail(domain)}
              />
            );
          })}
        </Container>
      )}

      <DeclinedSites />
    </Container>
  );
});

