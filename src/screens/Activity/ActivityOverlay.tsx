import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import { formatPermissionLabel } from '@domain/permissions/permissionLabels.ts';
import {
  filterActivityEntries,
  countActivityFilters,
  activityDomains,
  activityAccountOptions,
  availableTypeKeys,
  buildDayGroups,
  groupActivityEntries,
  type GroupedActivity,
} from '@domain/activity/activity.ts';
import { classifyDay } from '@utils/format/time.ts';
import Button from '@components/Button/Button';
import LinkButton from '@components/LinkButton/LinkButton';
import Dropdown from '@components/Dropdown/Dropdown';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import Input from '@components/Input/Input';
import StatusDot from '@components/StatusDot/StatusDot';
import Card from '@components/Card/Card';
import ListRow from '@components/ListRow/ListRow';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import { IconTuner } from '@assets';
import { useAccount } from '@context/AccountContext';
import { ActivityProvider, useActivity } from '@context/ActivityContext';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import usePagedList from '@hooks/usePagedList.ts';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import type { DropdownOption } from '@components/Dropdown/dropdownOption.ts';

/** Rendered rows per page. Grown by the "show more" button, reset whenever
 *  the filters narrowing `rawLog` change (see the effect below). */
const PAGE_SIZE = 40;

/** Translation keys for `availableTypeKeys`' chip keys. A key lookup rather
 *  than the translated text itself, so it can live at module scope without
 *  freezing in whatever language was active on first import — `t()` still
 *  runs at render time, in `typeOptions` below. Kept out of the domain module
 *  because that layer stays i18n-free (see docs/component-standards.md §6,
 *  `permissionRules.ts`). */
const TYPE_LABEL_KEYS: Record<string, string> = {
  signEvent: 'approval.signEvent',
  getPublicKey: 'perm.readProfile',
  encrypt: 'activity.sendMessage',
  decrypt: 'activity.readMessage',
  nip04Encrypt: 'activity.sendNip04',
  nip44Encrypt: 'activity.sendNip44',
  nip04Decrypt: 'activity.readNip04',
  nip44Decrypt: 'activity.readNip44',
};

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
  const accountOptions = useMemo((): DropdownOption[] => [
    { value: '', label: t('activity.allAccounts') },
    ...activityAccountOptions(rawLog, accounts || [], profileCache || {})
      .map((o) => ({ value: o.pubkey, label: o.label })),
  ], [rawLog, accounts, profileCache]);

  // Which type-filter chips to offer — only the ones with a matching entry
  // for the currently selected domain/account.
  const typeKeys = useMemo(
    () => availableTypeKeys(rawLog, { domain: filter, account: accountFilter }, advancedTypes),
    [rawLog, filter, accountFilter, advancedTypes],
  );

  const typeOptions = useMemo((): DropdownOption[] => [
    { value: '', label: t('activity.allOps') },
    ...typeKeys.map((key) => ({ value: key, label: t(TYPE_LABEL_KEYS[key]) })),
  ], [typeKeys]);

  // Domain dropdown options
  const domainOptions = useMemo((): DropdownOption[] => [
    { value: '', label: t('activity.allSites') },
    ...activityDomains(rawLog).map((d) => ({ value: d, label: d })),
  ], [rawLog]);

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

  // Insert a day header before each day boundary in the currently rendered page.
  const dayItems = buildDayGroups(page.visible);
  const dayLabel = (day: string) => {
    const kind = classifyDay(day);
    if (kind === 'today') return t('activity.today');
    if (kind === 'yesterday') return t('activity.yesterday');
    return day;
  };

  const showDomain = !filter;

  return (
    <OverlayPanel title={t('activity.title')} onClose={onClose} animating={animating}>
      <div className="flex items-center gap-4 pb-4 border-b border-card-border">
        <div className="flex gap-3 flex-1 min-w-0">
          <Dropdown
            className="flex-1 min-w-0"
            options={domainOptions}
            value={filter}
            onChange={(v: string) => { setFilter(v); setTypeFilter(''); }}
            small
          />
          {accountOptions.length > 2 && (
            <Dropdown
              className="flex-1 min-w-0"
              options={accountOptions}
              value={accountFilter}
              onChange={setAccountFilter}
              small
            />
          )}
        </div>
        <Card
          as="button"
          variant="flat"
          className={`relative flex items-center justify-center w-16 h-16 p-0 mb-0 rounded-md shrink-0 transition-colors ${
            activeFilterCount > 0
              ? 'border-brand bg-brand-light text-brand'
              : 'border-card-active bg-brand-tint-hover text-secondary hover:bg-brand-tint-active hover:text-heading'
          }`}
          onClick={() => setFiltersOpen(true)}
          title={t('activity.filters')}
        >
          <IconTuner size={16} />
          {activeFilterCount > 0 && (
            <span className="absolute -top-2 -right-2 min-w-8 h-8 px-2 rounded-md bg-brand text-on-brand text-2xs font-bold flex items-center justify-center leading-none">
              {activeFilterCount}
            </span>
          )}
        </Card>
        {rawLog.length > 0 && (
          <Button variant="danger" small onClick={handleClear}>{t('activity.clearAll')}</Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-muted text-md text-center py-14">{t('common.loading')}</div>
        ) : loadFailed ? (
          <div className="text-muted text-md text-center py-14">
            <div role="alert">{t('activity.loadFailed')}</div>
            <Button small onClick={loadActivity}>{t('common.retry')}</Button>
          </div>
        ) : dayItems.length === 0 ? (
          <div className="text-muted text-md text-center py-14">
            {t('activity.noActivity')}
          </div>
        ) : (
          dayItems.map((item, i) =>
            item.type === 'header' ? (
              <div key={`h-${i}`} className="text-xs font-bold text-secondary pt-4 pb-2 uppercase tracking-[0.5px]">{dayLabel(item.day)}</div>
            ) : (
              <ListRow
                key={`e-${i}`}
                variant="grouped"
                leading={<StatusDot status={item.entry.decision} />}
                leadingChip={false}
                title={
                  <span className="flex items-center gap-4 min-w-0 w-full text-sm font-normal">
                    <span className="text-muted text-xs whitespace-nowrap shrink-0 min-w-18">{item.entry.timeKey}</span>
                    {showDomain && item.entry.domain && (
                      <span className="text-secondary font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px]">{item.entry.domain}</span>
                    )}
                    <span className="text-body flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {formatPermissionLabel(item.entry.methodKey, item.entry.entries?.[0]?.event ?? undefined)}
                    </span>
                  </span>
                }
                trailing={item.entry.count > 1 ? <span className="text-muted text-xs shrink-0">&times;{item.entry.count}</span> : null}
                onClick={() => setSelectedGroup(item.entry)}
              />
            )
          )
        )}
        {page.hasMore && (
          <div className="text-center py-4">
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
          <div className="flex flex-col gap-4 pb-6 mb-2 border-b border-card-border">
            <span className="text-xs font-semibold text-secondary uppercase tracking-[0.5px]">{t('activity.filterByType')}</span>
            <ChipGroup
              options={typeOptions}
              value={typeFilter}
              onChange={setTypeFilter}
            />
            <LinkButton tone="brand" onClick={handleToggleAdvanced}>
              {advancedTypes ? t('activity.hideProtocols') : t('activity.showProtocols')}
            </LinkButton>
          </div>

          {/* `.filterPanel:last-of-type` used to drop this border when this
              was the last <div> among its siblings — true only when
              `activeFilterCount` is 0 and the actions row below does not
              render. That is state the component already computes, so the
              condition is explicit here instead of implicit in a selector. */}
          <div className={`flex flex-col gap-4 ${activeFilterCount > 0 ? 'pb-6 mb-2 border-b border-card-border' : ''}`}>
            <span className="text-xs font-semibold text-secondary uppercase tracking-[0.5px]">{t('activity.filterByPubkey')}</span>
            <Input
              mono
              placeholder={t('activity.pubkeyPlaceholder')}
              value={pubkeyFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPubkeyFilter(e.target.value)}
            />
          </div>

          {activeFilterCount > 0 && (
            <div className="pt-4 flex justify-end">
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
