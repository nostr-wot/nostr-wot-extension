import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Dropdown from '@components/Dropdown';
import Button from '@components/Button';
import Text from '@components/Text';
import FormError from '@components/FormError';

export interface DeclinedSite { domain: string; until: number | 'session' | 'never' }
export function describeDeclinedSite(until: DeclinedSite['until']): string {
  const expiry = until === 'never' ? t('perm.declinedNever')
    : until === 'session' ? t('perm.declinedSession')
    : t('perm.declinedUntil', { date: new Date(until).toLocaleString() });
  return `${t('perm.declined')} · ${expiry}`;
}
export function dismissalDurationOptions() {
  return [
    { value: '604800000', label: t('perm.duration.week') },
    { value: '2592000000', label: t('perm.duration.month') },
    { value: '31536000000', label: t('perm.duration.year') },
    { value: 'never', label: t('perm.duration.forever') },
  ];
}

/** Per-site dismissal editor; changing it never connects or approves the site. */
export default function DeclinedSites({ site, onChange, onClose }: {
  site: DeclinedSite; onChange: () => Promise<void>; onClose: () => void;
}) {
  const [selected, setSelected] = useState(site.until === 'never' ? 'never' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeDuration = async (value: string) => {
    setBusy(true); setError('');
    try {
      const updated = await rpc<boolean>('updateDismissedDomain', { domain: site.domain, duration: value === 'never' ? 'never' : Number(value) });
      if (!updated) throw new Error('Dismissal ended');
      setSelected(value);
      await onChange();
    } catch { setError(t('approval.actionFailed')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try {
      await rpc('removeDismissedDomain', { domain: site.domain });
      await onChange(); onClose();
    } catch { setError(t('approval.actionFailed')); }
    finally { setBusy(false); }
  };
  return <>
    <Text>{describeDeclinedSite(site.until)}</Text>
    <Text variant="hint">{t('perm.declinedDesc')}</Text>
    <Dropdown aria-label={t('perm.changeDuration')} placeholder={t('perm.changeDuration')}
      options={dismissalDurationOptions()} value={selected} disabled={busy} onChange={value => void changeDuration(value)} />
    <FormError>{error}</FormError>
    <Button disabled={busy} onClick={() => void remove()}>{t('perm.declinedRemove')}</Button>
  </>;
}
