import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.ts';
import { formatLabel } from '@shared/permissions.ts';
import { IconSearch, IconShield, IconChevronRight, IconUsers, IconPlus } from '@assets';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../context/PermissionsContext';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import Toggle from '@components/Toggle/Toggle';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

const DECISIONS = ['allow', 'deny', 'ask'] as const;
const READ_ONLY_KEYS = ['getPublicKey'];

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
    let allow = 0, deny = 0;
    Object.values(bucketPerms).forEach((v) => {
      if (v === 'allow') allow++;
      else if (v === 'deny') deny++;
    });
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

  // Filter permission keys for read-only/NIP-46 accounts (only getPublicKey)
  const filterKeysForAccount = (keys: string[]): string[] => {
    if (!allAccountsMode && (isSelectedReadOnly || isSelectedNip46)) {
      return keys.filter((k) => READ_ONLY_KEYS.includes(k));
    }
    return keys;
  };

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
  const [addRuleKey, setAddRuleKey] = useState<string>('signEvent:1');
  const [addRuleCustomKind, setAddRuleCustomKind] = useState<string>('');
  const [addRuleDecision, setAddRuleDecision] = useState<string>('allow');
  const [addRuleUseCustom, setAddRuleUseCustom] = useState<boolean>(false);

  // ── Inline decision dropdown state ──
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openDropdownKey) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownKey(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdownKey]);

  const openAddRule = () => {
    setAddRuleKey('signEvent:1');
    setAddRuleCustomKind('');
    setAddRuleDecision('allow');
    setAddRuleUseCustom(false);
    setAddRuleOpen(true);
  };

  const handleAddRule = async () => {
    const key = addRuleUseCustom && addRuleCustomKind.trim()
      ? `signEvent:${addRuleCustomKind.trim()}`
      : addRuleKey;
    await permissions.savePermission(detailDomain!, key, addRuleDecision, effectiveAccountId);
    setAddRuleOpen(false);
  };

  const chipClass = (d: string) =>
    styles[`chip${d.charAt(0).toUpperCase() + d.slice(1)}`] || '';

  // Available keys for add-rule dropdown (exclude already-set ones)
  const existingKeys = new Set(Object.keys(domainPerms));
  const availableKeys = COMMON_PERM_KEYS.filter(k => !existingKeys.has(k));

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
          <Button small onClick={openAddRule}>
            <IconPlus size={12} /> {t('perms.addRule')}
          </Button>
          <Button variant="danger" small onClick={handleRevoke}>{t('perms.revokeAll')}</Button>
        </div>

        {/* Add Rule modal */}
        {addRuleOpen && createPortal(
          <div className={styles.permModalOverlay} onClick={() => setAddRuleOpen(false)}>
            <div className={styles.permModal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.permModalHeader}>
                <span className={styles.permModalTitle}>{t('perms.addRule')}</span>
                <button className={styles.permModalClose} onClick={() => setAddRuleOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className={styles.permModalSection}>
                <span className={styles.permModalLabel}>{t('perms.permission')}</span>
                {!addRuleUseCustom ? (
                  <Dropdown
                    options={availableKeys.map(k => ({ value: k, label: formatLabel(k) }))}
                    value={addRuleKey}
                    onChange={setAddRuleKey}
                    small
                  />
                ) : (
                  <div className={styles.permCustomKindRow}>
                    <span className={styles.permCustomKindPrefix}>signEvent:</span>
                    <input
                      type="number"
                      className={styles.permCustomKindInput}
                      placeholder="e.g. 30023"
                      value={addRuleCustomKind}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setAddRuleCustomKind(e.target.value)}
                    />
                  </div>
                )}
                <button
                  className={styles.permToggleCustom}
                  onClick={() => setAddRuleUseCustom(!addRuleUseCustom)}
                >
                  {addRuleUseCustom ? t('perms.usePreset') : t('perms.customKind')}
                </button>
              </div>

              <div className={styles.permModalSection}>
                <span className={styles.permModalLabel}>{t('perms.decision')}</span>
                <div className={styles.chipGroup}>
                  {DECISIONS.map((d) => (
                    <button
                      key={d}
                      className={`${styles.chip} ${addRuleDecision === d ? chipClass(d) : ''}`}
                      onClick={() => setAddRuleDecision(d)}
                    >
                      {t(`perms.${d}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.permModalActions}>
                <Button small variant="secondary" onClick={() => setAddRuleOpen(false)}>{t('common.cancel')}</Button>
                <Button small onClick={handleAddRule}>{t('perms.addRule')}</Button>
              </div>
            </div>
          </div>,
          document.getElementById('root') || document.body,
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

/**
 * Sites the user declined to connect, and how long that lasts.
 *
 * "Not now" used to be permanent and invisible: nothing listed it, and the only way out was
 * discovering that connecting cleared it. A decision the user cannot see is one they cannot
 * revisit, so every dismissal appears here — including the explicit "Never" — with a way to
 * undo it.
 */
function DeclinedSites() {
  const [declined, setDeclined] = useState<Array<{ domain: string; until: number | 'session' | 'never' }>>([]);
  const [duration, setDuration] = useState<number>(604_800_000);

  const load = useCallback(async () => {
    const [list, ms] = await Promise.all([
      rpc<Array<{ domain: string; until: number | 'session' | 'never' }>>('getDismissedDomains'),
      rpc<number>('getDismissDuration'),
    ]);
    setDeclined(list || []);
    setDuration(typeof ms === 'number' ? ms : 604_800_000);
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeDuration = async (ms: number) => {
    setDuration(ms);
    await rpc('setDismissDuration', { ms });
  };

  const undo = async (domain: string) => {
    await rpc('removeDismissedDomain', { domain });
    load();
  };

  const describe = (until: number | 'session' | 'never'): string =>
    until === 'never' ? t('perm.declinedNever')
      : until === 'session' ? t('perm.declinedSession')
      : t('perm.declinedUntil', { date: new Date(until).toLocaleDateString() });

  const DURATIONS: Array<[number, string]> = [
    [0, t('perm.duration.session')],
    [86_400_000, t('perm.duration.day')],
    [604_800_000, t('perm.duration.week')],
    [2_592_000_000, t('perm.duration.month')],
  ];

  return (
    <div className={styles.declinedBlock}>
      <SectionLabel>{t('perm.declinedTitle')}</SectionLabel>
      <p className={styles.declinedDesc}>{t('perm.declinedDesc')}</p>

      <label className={styles.declinedDurationRow}>
        <span>{t('perm.dismissDurationLabel')}</span>
        <select
          className={styles.declinedSelect}
          value={duration}
          onChange={(e) => changeDuration(Number(e.target.value))}
        >
          {DURATIONS.map(([ms, label]) => <option key={ms} value={ms}>{label}</option>)}
        </select>
      </label>

      {declined.length === 0 ? (
        <p className={styles.declinedDesc}>{t('perm.declinedNone')}</p>
      ) : (
        <div className={styles.permsList}>
          {declined.map(({ domain, until }) => (
            <div key={domain} className={styles.declinedRow}>
              <div className={styles.permInfo}>
                <div className={styles.permDomain}>{domain}</div>
                <div className={styles.permSummary}>{describe(until)}</div>
              </div>
              <button className={styles.declinedRemove} onClick={() => undo(domain)}>
                {t('perm.declinedRemove')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
