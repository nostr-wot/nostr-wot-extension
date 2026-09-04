import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.ts';
import { filterActivityEntries, countActivityFilters, activityDomains, TYPE_METHODS, groupActivityEntries, type GroupedActivity } from '@shared/activity.ts';
import { truncateNpub } from '@shared/format/text.ts';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import Input from '@components/Input/Input';
import StatusDot from '@components/StatusDot/StatusDot';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import { IconTuner } from '@assets';
import { useAccount } from '@popup/context/AccountContext';
import { ActivityProvider, useActivity } from '@popup/context/ActivityContext';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import usePagedList from '@hooks/usePagedList.ts';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import styles from './ActivityOverlay.module.css';
import type { DropdownOption } from '@models/dropdown.ts';

/** Rendered rows per page. Grown by the "show more" button, reset whenever
 *  the filters narrowing `rawLog` change (see the effect below). */
const PAGE_SIZE = 40;

interface ActivityOverlayProps {
  visible: boolean;
  initialDomain: string | null;
  initialPubkey: string;
  onClose: () => void;
}

export default function ActivityOverlay(props: ActivityOverlayProps) {
  // The log is only worth fetching while this overlay is open — `visible`
  // gates the context's own read (see ActivityContext), so the provider is
  // scoped to this component rather than mounted for the whole popup like
  // the other six contexts in `src/popup/context/`.
  return (
    <ActivityProvider visible={props.visible}>
      <ActivityOverlayInner {...props} />
    </ActivityProvider>
  );
}

function ActivityOverlayInner({ visible, initialDomain, initialPubkey, onClose }: ActivityOverlayProps) {
  const [filter, setFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pubkeyFilter, setPubkeyFilter] = useState<string>('');
  const [advancedTypes, setAdvancedTypes] = useState<boolean>(false);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupedActivity | null>(null);
  const { accounts, profileCache } = useAccount();
  const { log: rawLog, loading, loadFailed, refresh: loadActivity } = useActivity();

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

  // The detail view for a group from a stale log would show the wrong
  // decision or a payload no longer worth showing — close it whenever a
  // (re)load actually lands a new log.
  useEffect(() => {
    setSelectedGroup(null);
  }, [rawLog]);

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

  // Renders a growing prefix of `entries` rather than all of it — the log can
  // hold up to 2000 raw entries (lib/constants.ts), and grouping does not
  // bound how many rows that becomes.
  const page = usePagedList(entries, PAGE_SIZE);

  // Reset to one page whenever the filters actually change, not whenever
  // `entries` changes identity — a background refresh under the same filters
  // (a new site interaction arriving while the overlay is open) produces a
  // new array too, and that case must not yank the window back out from under
  // someone who has already clicked "show more".
  useEffect(() => {
    page.reset();
  }, [accountFilter, filter, typeFilter, pubkeyFilter, page.reset]);

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
  for (const entry of page.visible) {
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
        {page.hasMore && (
          <div className={styles.showMore}>
            <Button small variant="secondary" onClick={page.loadMore}>{t('common.showMore')}</Button>
          </div>
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
