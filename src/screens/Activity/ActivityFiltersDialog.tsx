import { t } from '@services/i18n/i18n.ts';
import Modal from '@components/Modal/Modal';
import Button from '@components/Button/Button';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import Input from '@components/Input/Input';
import type { Option } from '@components/option.ts';

/** Filters apply immediately; closing the dialog returns to the filtered log. */
export default function ActivityFiltersDialog({ typeOptions, typeFilter, pubkeyFilter, activeFilterCount,
  onTypeChange, onPubkeyChange, onClear, onClose }: {
  typeOptions: Option[]; typeFilter: string; pubkeyFilter: string; activeFilterCount: number;
  onTypeChange: (value: string) => void; onPubkeyChange: (value: string) => void;
  onClear: () => void; onClose: () => void;
}) {
  return <Modal title={t('activity.filters')} onClose={onClose} maxWidth={360} footerRow footer={<>
    {activeFilterCount > 0 && <Button variant="secondary" onClick={onClear}>{t('activity.clearFilters')}</Button>}
    <Button onClick={onClose}>{t('common.close')}</Button>
  </>}>
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-4">
        <span className="text-xs font-semibold text-secondary uppercase tracking-[0.5px]">{t('activity.filterByType')}</span>
        <ChipGroup options={typeOptions} value={typeFilter} onChange={onTypeChange} />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center"><label htmlFor="activity-peer-filter" className="text-sm font-semibold text-secondary">{t('activity.filterByPubkey')}</label><InfoTooltip text={t('activity.pubkeyFilterHint')} /></div>
        <Input id="activity-peer-filter" mono placeholder={t('activity.pubkeyPlaceholder')}
          value={pubkeyFilter} onChange={e => onPubkeyChange(e.target.value)} />
      </div>
    </div>
  </Modal>;
}
