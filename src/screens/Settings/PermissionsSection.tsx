import RelayAuthentication, { type RelayAuthenticationHandle } from './RelayAuthentication';
import DefaultBackendAuth from './DefaultBackendAuth';
import AuthenticationPermissions from './AuthenticationPermissions';
import PermissionRulesList from './PermissionRulesList';
import { COMMON_PERM_KEYS } from '@constants/permissions.ts';
import { useState, useEffect, useRef, useImperativeHandle, forwardRef, ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { countDecisions, filterKeysForAccountKind, availablePermKeys } from '@domain/permissions/permissionRules.ts';
import Input from '@components/Input';
import IconShield from '@assets/IconShield.tsx';
import IconChevronRight from '@assets/IconChevronRight.tsx';
import IconUsers from '@assets/IconUsers.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import { useAccount } from '@context/AccountContext';
import { usePermissions } from '@context/PermissionsContext';
import PermissionsDetailLayout from './PermissionsDetailLayout';
import Card from '@components/Card';
import Button, { ButtonDanger } from '@components/Button';
import Modal from '@components/Modal';
import { createPortal } from 'react-dom';
import DeclinedSites, { describeDeclinedSite, type DeclinedSite } from './DeclinedSites';
import useAsyncResource from '@hooks/useAsyncResource';
import useStorageWatch from '@hooks/useStorageWatch';
import { rpc } from '@services/rpc';
import FormError from '@components/FormError';
import AddRuleModal from './AddRuleModal';
import Toggle from '@components/Toggle';
import EmptyState from '@components/EmptyState';
import ListRow from '@components/ListRow';
import Container from '@components/Container';
import Text from '@components/Text';

export interface PermissionsSectionHandle {
  goBack: () => boolean;
}

interface PermissionsSectionProps {
  initialDomain?: string | null;
  onDetailChange?: (domain: string | null) => void;
}

export default forwardRef<PermissionsSectionHandle, PermissionsSectionProps>(function PermissionsSection({ initialDomain, onDetailChange }, ref) {
  const { accounts, activeId } = useAccount();
  const permissions = usePermissions();
  const selectedAccountId = activeId;
  const authenticationAccount = accounts?.find(account => account.id === activeId) || accounts?.[0];
  const [relayPermissionsOpen, setRelayPermissionsOpen] = useState(false);
  const relayPermissionsRef = useRef<RelayAuthenticationHandle>(null);
  const [declinedDomain, setDeclinedDomain] = useState<string | null>(null);
  const { data: declined, error: declinedError, refresh: refreshDeclined } = useAsyncResource<{ sites: DeclinedSite[] }>({ sites: [] }, {
    load: async (patch, current) => {
      const sites = await rpc<DeclinedSite[]>('getDismissedDomains');
      if (current()) patch({ sites: sites || [] });
    },
  });
  useStorageWatch([{ area: 'local', keys: ['dismissedDomains'] }, { area: 'session', keys: ['sessionDismissedDomains'] }], refreshDeclined);
  const selectedDeclined = declined.sites.find(site => site.domain === declinedDomain);
  const [query, setQuery] = useState<string>('');
  const [detailDomain, setDetailDomain] = useState<string | null>(initialDomain || null);

  const allAccountsMode = permissions.useGlobalDefaults;

  // When toggle is ON, use _default (null) for global permissions; otherwise per-account
  const effectiveAccountId = allAccountsMode ? null : selectedAccountId;

  // Is the currently selected account read-only or NIP-46?
  const selectedAccount = (accounts || []).find((a: any) => a.id === selectedAccountId);
  const isSelectedReadOnly = selectedAccount?.readOnly === true || selectedAccount?.type === 'npub';
  const isSelectedNip46 = selectedAccount?.type === 'nip46';

  // Declined sites share the searchable list and take precedence over dormant rules.
  const domains = [...new Set([...permissions.getDomainsForBucket(effectiveAccountId), ...declined.sites.map(site => site.domain)])]
    .filter(domain => domain.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  // Domain detail — derived from provider state
  const domainPerms: Record<string, string> = detailDomain ? permissions.getForBucket(detailDomain, effectiveAccountId) : {};

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
      if (relayPermissionsOpen) {
        if (!relayPermissionsRef.current?.goBack()) setRelayPermissionsOpen(false);
        return true;
      }
      if (detailDomain) {
        setDetailDomain(null);
        return true; // handled internally
      }
      return false; // nothing to go back from
    },
  }), [detailDomain, relayPermissionsOpen]);

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

  const filterKeysForAccount = (keys: string[]): string[] =>
    filterKeysForAccountKind(keys, { readOnly: isSelectedReadOnly, nip46: isSelectedNip46 }, allAccountsMode);

  // Account scope picker block
  const hasMultipleAccounts = accounts && accounts.length > 1;

  const accountScopeBlock = hasMultipleAccounts && (
    <div>
      <Container variant="row" gap={3} className="justify-between py-5.5 px-7">
        <Container variant="row" gap={4} className="min-w-0 flex-1">
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
    </div>
  );

  // ── Add Rule modal state ──
  const [addRuleOpen, setAddRuleOpen] = useState<boolean>(false);

  const availableKeys = availablePermKeys(COMMON_PERM_KEYS, domainPerms);

  if (relayPermissionsOpen && authenticationAccount) {
    return <RelayAuthentication key={authenticationAccount.id} ref={relayPermissionsRef} accountId={authenticationAccount.id} onBack={() => setRelayPermissionsOpen(false)} />;
  }

  // Detail view
  if (detailDomain) {
    const allKeys = filterKeysForAccount(Object.keys(domainPerms));

    return (
      <>
      <PermissionsDetailLayout domain={detailDomain} actions={
        <Container variant="row" className="justify-between">
          <Button small onClick={() => setAddRuleOpen(true)}><IconPlus size={12} /> {t('perms.addRule')}</Button>
          <ButtonDanger small onClick={handleRevoke}>{t('perms.revokeAll')}</ButtonDanger>
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
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
      <Card className="p-0 overflow-hidden mb-0 shrink-0 [&>*+*]:[border-top:1px_solid_var(--brand-tint-active)]">
        {accountScopeBlock}
        {authenticationAccount && <DefaultBackendAuth key={authenticationAccount.id} accountId={authenticationAccount.id} />}
        <ListRow leading={<IconShield size={15} />} leadingChip={false}
          className="px-7 py-5.5 gap-4" title={t('auth.relayPermissions')} subtitle={t('auth.manageRelays')}
          trailing={<span className="w-20 flex justify-center"><IconChevronRight size={16} /></span>}
          onClick={() => setRelayPermissionsOpen(true)} />
      </Card>

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
            const bucketPerms = permissions.getForBucket(domain, effectiveAccountId);
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
      <AuthenticationPermissions accounts={accounts || []} activeId={activeId}/>

    </Container>
  );
});

