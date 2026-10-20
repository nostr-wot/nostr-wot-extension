import ChipGroup from '@components/ChipGroup';
import { SectionLabel, SectionHint } from '@components/SectionLabel';
import { AUTO_LOCK_OPTIONS } from '@constants/vault';
import { t } from '@services/i18n/i18n';

/** One timer list and presentation for onboarding and Security. */
export default function AutoLockOptions({ value, onChange, disabled = false }: { value: number; onChange: (ms: number) => void; disabled?: boolean }) {
  return <>
    <SectionLabel>{t('security.autoLock')}</SectionLabel>
    <SectionHint>{t('security.autoLockDesc')}</SectionHint>
    <ChipGroup options={AUTO_LOCK_OPTIONS.map(opt => ({ value: opt.ms, label: t(opt.ms === 0 ? 'common.none' : opt.labelKey) }))} value={value} onChange={onChange} disabled={disabled} />
  </>;
}
