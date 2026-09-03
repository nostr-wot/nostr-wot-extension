import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.ts';
import { formatLabel } from '@shared/permissions.ts';
import {
  countDecisions,
  filterKeysForAccountKind,
  availablePermKeys,
  buildRuleKey,
  DECISIONS,
} from '@shared/permissionRules.ts';
import { IconSearch, IconShield, IconChevronRight, IconUsers, IconPlus } from '@assets';
import { useAccount } from '@popup/context/AccountContext';
import { usePermissions } from '@popup/context/PermissionsContext';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import DeclinedSites from './DeclinedSites';
import AddRuleModal from './AddRuleModal';
import Modal from '@components/Modal/Modal';
import Toggle from '@components/Toggle/Toggle';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';
import useOutsideClick from '@shared/hooks/useOutsideClick.ts';


const COMMON_PERM_KEYS = [
  'getPublicKey',
  'signEvent:0',
  'signEvent:1',
  'signEvent:3',
  'signEvent:5',
  'signEvent:6',
  'signEvent:7',
  'signEvent:1111',
  'signEvent:9734',
  'signEvent:24242',
  'signEvent:27235',
  'signEvent:30023',
  'readMessages',
  'sendMessages',
];

export interface PermissionsSectionHandle {
  goBack: () => boolean;
}

interface PermissionsSectionProps {
  initialDomain?: string | null;
  onDetailChange?: (domain: string | null) => void;
}

export default forwardRef<PermissionsSectionHandle, PermissionsSectionProps>(function PermissionsSection({ initialDomain, onDetailChange }, ref) {
  const { accounts, active, activeId, profileCache } = useAccount();
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
    <div className={styles.accountScope}>
      <Card className={styles.accountScopeCard}>
        <div className={styles.controlRow}>
          <div className={styles.controlInfo}>
            <IconUsers size={15} className={styles.controlIcon} />
            <div>
              <span className={styles.controlLabel}>{t('perms.allAccounts')}</span>
              <div className={styles.controlHint}>
                {allAccountsMode ? t('perms.allAccountsOnHint') : t('perms.allAccountsOffHint')}
              </div>
            </div>
          </div>
          <Toggle checked={allAccountsMode} onChange={(val: boolean) => {
            permissions.setUseGlobalDefaults(val);
          }} />
        </div>
      </Card>

      {!allAccountsMode && (
        <>
          <span className={styles.fieldLabel}>{t('perms.accountLabel')}</span>
          <Dropdown
            options={accountOptions}
            value={selectedAccountId || ''}
            onChange={handleAccountChange}
            small
          />
        </>
      )}

      {!allAccountsMode && isSelectedReadOnly && (
        <div className={styles.nip46Banner}>
          <span className={styles.nip46BannerTitle}>{t('perms.readOnlyTitle')}</span>
          <span className={styles.nip46BannerHint}>{t('perms.readOnlyHint')}</span>
        </div>
      )}

      {!allAccountsMode && isSelectedNip46 && (
        <div className={styles.nip46Banner}>
          <span className={styles.nip46BannerTitle}>{t('perms.managedBySigner')}</span>
          <span className={styles.nip46BannerHint}>{t('perms.managedBySignerHint')}</span>
        </div>
      )}
    </div>
  );

  // ── Add Rule modal state ──
  const [addRuleOpen, setAddRuleOpen] = useState<boolean>(false);

  // ── Inline decision dropdown state ──
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(dropdownRef, () => setOpenDropdownKey(null), !!openDropdownKey);





  const chipClass = (d: string) =>
    styles[`chip${d.charAt(0).toUpperCase() + d.slice(1)}`] || '';

  const availableKeys = availablePermKeys(COMMON_PERM_KEYS, domainPerms);

  // Detail view
  if (detailDomain) {
    const allKeys = filterKeysForAccount(Object.keys(domainPerms));

    return (
      <div className={styles.section}>
        {allKeys.length === 0 ? (
          <EmptyState
            icon={<IconShield size={24} />}
            text={t('perms.noRules')}
          />
        ) : (
          <Card>
            {allKeys.map((key) => {
              const current = domainPerms[key] || 'ask';
              return (
                <div key={key} className={styles.permDetailRow}>
                  <span className={styles.permMethodName}>
                    {formatLabel(key)}
                  </span>
                  <div className={styles.permDecisionWrap} ref={openDropdownKey === key ? dropdownRef : undefined}>
                    <button
                      className={`${styles.chip} ${chipClass(current)}`}
                      onClick={() => setOpenDropdownKey(openDropdownKey === key ? null : key)}
                    >
                      {t(`perms.${current}`)}
                    </button>
                    {openDropdownKey === key && (
                      <div className={styles.permDecisionDropdown}>
                        {DECISIONS.map((d) => (
                          <button
                            key={d}
                            className={`${styles.permDecisionOption} ${d === current ? styles.permDecisionActive : ''}`}
                            onClick={() => { handleChip(key, d); setOpenDropdownKey(null); }}
                          >
                            <span className={`${styles.permDecisionDot} ${styles[`permDot${d.charAt(0).toUpperCase() + d.slice(1)}`]}`} />
                            {t(`perms.${d}`)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        <div className={styles.permDetailActions}>
          <Button small onClick={() => setAddRuleOpen(true)}>
            <IconPlus size={12} /> {t('perms.addRule')}
          </Button>
          <Button variant="danger" small onClick={handleRevoke}>{t('perms.revokeAll')}</Button>
        </div>

        {/* Add Rule modal */}
        {addRuleOpen && (
          <AddRuleModal
            availableKeys={availableKeys}
            onAdd={(key, decision) => permissions.savePermission(detailDomain!, key, decision, effectiveAccountId)}
            onClose={() => setAddRuleOpen(false)}
          />
        )}
      </div>
    );
  }

  // List view
  return (
    <div className={styles.section}>
      {accountScopeBlock}

      <div className={styles.searchWrap}>
        <IconSearch className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder={t('perms.searchSites')}
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </div>

      {domains.length === 0 ? (
        <EmptyState
          icon={<IconShield size={24} />}
          text={t('perms.noPermsYet')}
          hint={t('perms.permsHint')}
        />
      ) : (
        <div className={styles.permsList}>
          {domains.map((domain: string) => {
            const bucketPerms = permissions.getForBucket(domain, effectiveAccountId);
            return (
              <button key={domain} className={styles.permRow} onClick={() => openDetail(domain)}>
                <div className={styles.permFaviconFallback}>
                  {domain.charAt(0).toUpperCase()}
                </div>
                <div className={styles.permInfo}>
                  <div className={styles.permDomain}>{domain}</div>
                  <div className={styles.permSummary}>{getPermSummary(bucketPerms)}</div>
                </div>
                <IconChevronRight className={styles.chevron} />
              </button>
            );
          })}
        </div>
      )}

      <DeclinedSites />
    </div>
  );
});


