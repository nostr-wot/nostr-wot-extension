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
import { IconSearch, IconShield, IconUsers, IconPlus } from '@assets';
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
import useOutsideClick from '@hooks/useOutsideClick.ts';
import Chip from '@components/Chip/Chip';
import ListRow from '@components/ListRow/ListRow';


/**
 * Decision -> dot colour, as an explicit map rather than `styles[`permDot${...}`]`.
 *
 * The dynamic lookup was invisible to `tests/css-selectors.test.ts` (it
 * skips any stylesheet a component indexes into with a computed key) and it
 * is the only reason Settings.module.css was exempt from that test. Naming
 * the three cases here removes the dynamic access, so the rest of this
 * file's CSS module usage is checked like every other component's.
 */
const DECISION_DOT_TONE: Record<string, string> = {
  allow: 'bg-success',
  deny: 'bg-error',
  ask: 'bg-warning',
};

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
    <div className="flex flex-col gap-3 pb-5 mb-3 border-b border-card-border">
      <Card className={styles.accountScopeCard}>
        <div className="flex items-center justify-between py-5.5 px-7">
          <div className="flex items-center gap-4">
            <IconUsers size={15} className="text-brand shrink-0" />
            <div>
              <span className="text-md font-medium text-body">{t('perms.allAccounts')}</span>
              <div className="text-xs text-muted mt-px leading-normal">
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
        <div className="flex flex-col gap-1 py-5 px-6 rounded-md bg-card border border-card-active mb-4">
          <span className="text-sm font-semibold text-brand">{t('perms.readOnlyTitle')}</span>
          <span className="text-xs text-muted leading-normal">{t('perms.readOnlyHint')}</span>
        </div>
      )}

      {!allAccountsMode && isSelectedNip46 && (
        <div className="flex flex-col gap-1 py-5 px-6 rounded-md bg-card border border-card-active mb-4">
          <span className="text-sm font-semibold text-brand">{t('perms.managedBySigner')}</span>
          <span className="text-xs text-muted leading-normal">{t('perms.managedBySignerHint')}</span>
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





  const availableKeys = availablePermKeys(COMMON_PERM_KEYS, domainPerms);

  // Detail view
  if (detailDomain) {
    const allKeys = filterKeysForAccount(Object.keys(domainPerms));

    return (
      <div className="flex-1 min-h-0 py-2 flex flex-col gap-4">
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
                <div key={key} className="flex items-center justify-between py-5 border-b border-card last:border-b-0">
                  <span className="text-md font-medium text-body">
                    {formatLabel(key)}
                  </span>
                  <div className="relative shrink-0" ref={openDropdownKey === key ? dropdownRef : undefined}>
                    {/* Always toned: this chip is not a selection among
                        options, it is the decision currently in force, and its
                        colour is how that reads at a glance. */}
                    <Chip
                      selected
                      tone={current as 'allow' | 'deny' | 'ask'}
                      onClick={() => setOpenDropdownKey(openDropdownKey === key ? null : key)}
                    >
                      {t(`perms.${current}`)}
                    </Chip>
                    {openDropdownKey === key && (
                      // Not <Dropdown>: Dropdown owns its own trigger button;
                      // here the trigger is already the Chip above, opening a
                      // compact popover anchored to it. Not ListRow either —
                      // a full title/subtitle/chevron row would dwarf this
                      // 100px-wide menu of status-dot + label options.
                      <div className="absolute right-0 top-[calc(100%+4px)] z-raised bg-elevated border border-card-border rounded-md shadow-[0_4px_16px_rgb(0_0_0_/_0.12)] min-w-50 overflow-hidden">
                        {DECISIONS.map((d) => (
                          <button
                            key={d}
                            className={`flex items-center gap-3 w-full py-3.5 px-6 border-none bg-transparent text-sm font-medium text-body cursor-pointer font-[inherit] text-left transition-colors hover:bg-brand-tint-hover ${d === current ? 'font-bold' : ''}`}
                            onClick={() => { handleChip(key, d); setOpenDropdownKey(null); }}
                          >
                            <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${DECISION_DOT_TONE[d]}`} />
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

        <div className="flex justify-between mt-4">
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
    <div className="flex-1 min-h-0 py-2 flex flex-col gap-4">
      {accountScopeBlock}

      <div className="relative mb-2">
        <IconSearch className="absolute left-5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          className="w-full py-5 pr-5 pl-[34px] border border-card-border rounded-panel text-md bg-card text-heading outline-none transition-colors focus:border-brand"
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
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden border border-card-border bg-glass rounded-panel shadow-[0_2px_12px_var(--brand-tint-active)]">
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
        </div>
      )}

      <DeclinedSites />
    </div>
  );
});


