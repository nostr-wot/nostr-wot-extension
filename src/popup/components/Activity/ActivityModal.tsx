import React, { useState, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.ts';
import { filterActivityEntries, countActivityFilters, activityDomains, TYPE_METHODS, groupActivityEntries, type ActivityEntry, type GroupedActivity } from '@shared/activity.ts';
import { truncateNpub } from '@shared/format/text.ts';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import Input from '@components/Input/Input';
import StatusDot from '@components/StatusDot/StatusDot';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import { IconTuner } from '@assets';
import { useAccount } from '@popup/context/AccountContext';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.ts';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import styles from './ActivityModal.module.css';


interface ActivityModalProps {
  visible: boolean;
  initialDomain: string | null;
  initialPubkey: string;
  onClose: () => void;
}

interface DropdownOption {
  value: string;
  label: string;
}

export default function ActivityModal({ visible, initialDomain, initialPubkey, onClose }: ActivityModalProps) {
  // Plain state, not a ref plus a version counter. The counter made every memo
  // below depend on a number while reading through a ref, so the dependency
  // arrays said nothing about what they actually used and each needed a
  // `void logVersion` to look honest.
  const [rawLog, setRawLog] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pubkeyFilter, setPubkeyFilter] = useState<string>('');
  const [advancedTypes, setAdvancedTypes] = useState<boolean>(false);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupedActivity | null>(null);
  const { accounts, profileCache } = useAccount();

  // Sync filters when modal opens
  useEffect(() => {
    if (visible) {
      setFilter(initialDomain || '');
      setAccountFilter(initialPubkey || '');
      setTypeFilter('');
      setPubkeyFilter('');
      setAdvancedTypes(false);
      setFiltersOpen(false);
      setSelectedGroup(null);
    }
  }, [visible, initialDomain, initialPubkey]);

  // Load raw log once when modal opens.
  //
  // This had no catch and no loading flag, so an unread log and a failed read
  // both rendered as "No activity yet" — the first only briefly, the second
  // permanently, and neither distinguishable from a genuinely empty log. On a
  // surface whose job is showing what sites have done with the user's key,
  // "nothing happened" is the one wrong answer that reassures.
  const [loading, setLoading] = useState<boolean>(false);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const log = await rpc<ActivityEntry[]>('getActivityLog') || [];
      setRawLog(log);
      setSelectedGroup(null);
    } catch {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) loadActivity();
  }, [visible, loadActivity]);

  // Build account dropdown options from log data
  const accountOptions = useMemo((): DropdownOption[] => {
    const pubkeys = [...new Set(rawLog.map((e) => e.pubkey).filter(Boolean))] as string[];
    const opts: DropdownOption[] = [{ value: '', label: t('activity.allAccounts') }];
    for (const pk of pubkeys) {
      const profile = profileCache?.[pk];
      const acct = (accounts || []).find((a) => a.pubkey === pk);
      const label = profile?.name || acct?.name || truncateNpub(pk);
      opts.push({ value: pk, label });
    }
    return opts;
  }, [rawLog, accounts, profileCache]);

  // Compute which methods are present in the filtered log
  const availableMethods = useMemo((): Set<string> => {
    let base = rawLog;
    if (filter) base = base.filter((e) => e.domain === filter);
    if (accountFilter) base = base.filter((e) => e.pubkey === accountFilter);
    return new Set(base.map((e) => e.method).filter(Boolean) as string[]);
  }, [rawLog, filter, accountFilter]);

  // Build type options dynamically — only show types present in data
  const typeOptions = useMemo((): DropdownOption[] => {
    const opts: DropdownOption[] = [{ value: '', label: t('activity.allOps') }];
    const has = (m: string) => availableMethods.has(m);

    if (has('signEvent'))    opts.push({ value: 'signEvent', label: t('approval.signEvent') });
    if (has('getPublicKey')) opts.push({ value: 'getPublicKey', label: t('perm.readProfile') });

    if (advancedTypes) {
      if (has('nip04Encrypt')) opts.push({ value: 'nip04Encrypt', label: t('activity.sendNip04') });
      if (has('nip44Encrypt')) opts.push({ value: 'nip44Encrypt', label: t('activity.sendNip44') });
      if (has('nip04Decrypt')) opts.push({ value: 'nip04Decrypt', label: t('activity.readNip04') });
      if (has('nip44Decrypt')) opts.push({ value: 'nip44Decrypt', label: t('activity.readNip44') });
    } else {
      if (has('nip04Encrypt') || has('nip44Encrypt')) opts.push({ value: 'encrypt', label: t('activity.sendMessage') });
      if (has('nip04Decrypt') || has('nip44Decrypt')) opts.push({ value: 'decrypt', label: t('activity.readMessage') });
    }

    return opts;
  }, [availableMethods, advancedTypes]);

  // Derive domains from raw log
  const domains = useMemo((): string[] => {
    return activityDomains(rawLog);
  }, [rawLog]);

  // Domain dropdown options
  const domainOptions = useMemo((): DropdownOption[] => [
    { value: '', label: t('activity.allSites') },
    ...domains.map((d) => ({ value: d, label: d })),
  ], [domains]);

  // Filtered + grouped entries
  const entries = useMemo((): GroupedActivity[] => {
    const filtered = filterActivityEntries(rawLog, {
      account: accountFilter,
      domain: filter,
      type: typeFilter,
      pubkeyQuery: pubkeyFilter,
    });
    return groupActivityEntries(filtered, { includeDay: true, includeDomain: true });
  }, [rawLog, accountFilter, filter, typeFilter, pubkeyFilter]);

  // Active filter count for badge
  const activeFilterCount = countActivityFilters({ type: typeFilter, pubkeyQuery: pubkeyFilter });

  const handleClear = async () => {
    await rpc('clearActivityLog', {
      domain: filter || undefined,
      accountPubkey: accountFilter || undefined,
      typeFilter: typeFilter || undefined,
      pubkeyFilter: pubkeyFilter || undefined,
    });
    loadActivity();
  };

  const handleClearFilters = () => {
    setTypeFilter('');
    setPubkeyFilter('');
    setAdvancedTypes(false);
  };

  const handleToggleAdvanced = () => {
    setTypeFilter('');
    setAdvancedTypes((v) => !v);
  };

  const { shouldRender, animating } = useAnimatedVisible(visible);

  if (!shouldRender) return null;

  // Group entries by day for display
  interface DayGroupItem {
    type: 'header' | 'entry';
    label?: string;
    idx?: number;
    [key: string]: any;
  }

  const dayGroups: DayGroupItem[] = [];
  let currentDay: string | null = null;
  let entryIdx = 0;
  for (const entry of entries) {
    if (entry.day !== currentDay) {
      currentDay = entry.day!;
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      let dayLabel = entry.day!;
      if (entry.day === today) dayLabel = t('activity.today');
      else if (entry.day === yesterday) dayLabel = t('activity.yesterday');
      dayGroups.push({ type: 'header', label: dayLabel });
    }
    dayGroups.push({ type: 'entry', idx: entryIdx, ...entry });
    entryIdx++;
  }

  const showDomain = !filter;

  return (
    <OverlayPanel title={t('activity.title')} onClose={onClose} animating={animating}>
      <div className={styles.toolbar}>
        <div className={styles.dropdowns}>
          <Dropdown
            options={domainOptions}
            value={filter}
            onChange={(v: string) => { setFilter(v); setTypeFilter(''); }}
            small
          />
          {accountOptions.length > 2 && (
            <Dropdown
              options={accountOptions}
              value={accountFilter}
              onChange={setAccountFilter}
              small
            />
          )}
        </div>
        <button
          className={`${styles.filterToggle} ${activeFilterCount > 0 ? styles.filterToggleActive : ''}`}
          onClick={() => setFiltersOpen(true)}
          title={t('activity.filters')}
        >
          <IconTuner size={16} />
          {activeFilterCount > 0 && (
            <span className={styles.filterBadge}>{activeFilterCount}</span>
          )}
        </button>
        {rawLog.length > 0 && (
          <Button variant="danger" small onClick={handleClear}>{t('activity.clearAll')}</Button>
        )}
      </div>

      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>{t('common.loading')}</div>
        ) : loadFailed ? (
          <div className={styles.empty}>
            <div role="alert">{t('activity.loadFailed')}</div>
            <Button small onClick={loadActivity}>{t('common.retry')}</Button>
          </div>
        ) : dayGroups.length === 0 ? (
          <div className={styles.empty}>
            {t('activity.noActivity')}
          </div>
        ) : (
          dayGroups.map((item, i) =>
            item.type === 'header' ? (
              <div key={`h-${i}`} className={styles.dayHeader}>{item.label}</div>
            ) : (
              <button
                key={`e-${i}`}
                className={styles.entry}
                onClick={() => setSelectedGroup(item as any)}
              >
                <StatusDot status={item.decision} />
                <span className={styles.entryTime}>{item.timeKey}</span>
                {showDomain && item.domain && (
                  <span className={styles.entryDomain}>{item.domain}</span>
                )}
                <span className={styles.entryAction}>{formatLabel(item.methodKey, item.entries?.[0]?.event)}</span>
                {item.count > 1 && (
                  <span className={styles.entryCount}>&times;{item.count}</span>
                )}
              </button>
            )
          )
        )}
      </div>

      {selectedGroup && (
        <EventDetailModal
          group={selectedGroup}
          onBack={() => setSelectedGroup(null)}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      {filtersOpen && (
        <OverlayPanel
          title={t('activity.filters')}
          onBack={() => setFiltersOpen(false)}
          onClose={() => setFiltersOpen(false)}
          zIndex={350}
        >
          <div className={styles.filterPanel}>
            <span className={styles.filterLabel}>{t('activity.filterByType')}</span>
            <ChipGroup
              options={typeOptions}
              value={typeFilter}
              onChange={setTypeFilter}
            />
            <button
              className={styles.advancedToggle}
              onClick={handleToggleAdvanced}
            >
              {advancedTypes ? t('activity.hideProtocols') : t('activity.showProtocols')}
            </button>
          </div>

          <div className={styles.filterPanel}>
            <span className={styles.filterLabel}>{t('activity.filterByPubkey')}</span>
            <Input
              mono
              placeholder={t('activity.pubkeyPlaceholder')}
              value={pubkeyFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPubkeyFilter(e.target.value)}
            />
          </div>

          {activeFilterCount > 0 && (
            <div className={styles.filterActions}>
              <Button variant="secondary" small onClick={handleClearFilters}>
                {t('activity.clearFilters')}
              </Button>
            </div>
          )}
        </OverlayPanel>
      )}
    </OverlayPanel>
  );
}
