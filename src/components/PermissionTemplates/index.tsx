import { useEffect, useState } from 'react';
import { t } from '@services/i18n/i18n';
import { rpc, rpcRead } from '@services/rpc';
import { TEMPLATE_PRESETS, WOT_TEMPLATE_KEYS, type PermissionTemplate } from '@domain/permissions/templates';
import type { PermissionBucket } from '@domain/permissions/types';
import { COMMON_PERM_KEYS } from '@constants/permissions';
import { createPortal } from 'react-dom';
import AddRuleModal from '@screens/Settings/AddRuleModal';
import { validateTemplateRules } from '@domain/permissions/templates';
import PermissionRulesList from '@screens/Settings/PermissionRulesList';
import Container from '@components/Container';
import Button from '@components/Button';
import Input from '@components/Input';
import Text from '@components/Text';
import InfoTooltip from '@components/InfoTooltip';
import FormError from '@components/FormError';

export default function TemplateEditor({ rules, onChange }: { rules: PermissionBucket; onChange: (rules: PermissionBucket) => void }) {
  const [custom, setCustom] = useState<PermissionTemplate[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void rpcRead<PermissionTemplate[]>('templates_list').then(value => { if (live) setCustom(value); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const save = async (copy = false) => {
    setBusy(true); setError('');
    try {
      const template = await rpc<PermissionTemplate>('templates_save', { template: { id: !copy && selected.startsWith('custom-') ? selected : `custom-${crypto.randomUUID()}`, name, rules } });
      setCustom(previous => [...previous.filter(item => item.id !== template.id), template]); setSelected(template.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const keys = Object.keys(rules);
  return <Container gap={4}>
    <Container variant="row" gap={2} className="flex-wrap">
      {[...TEMPLATE_PRESETS, ...custom].map(item => <Button key={item.id} small variant="secondary" aria-pressed={selected === item.id} disabled={busy} onClick={() => { setSelected(item.id); setName(item.id.startsWith('custom-') ? item.name : t(item.name)); onChange({ ...item.rules }); }}>{item.id.startsWith('custom-') ? item.name : t(item.name)}</Button>)}
      <Button small variant="secondary" disabled={busy} onClick={() => { setSelected(''); setName(''); onChange({}); }}>{t('templates.create')}</Button>
    </Container>
    <Text variant="hint">{t('templates.automaticHint')}<InfoTooltip text={t('templates.scopeNotice')} /></Text>
    <PermissionRulesList keys={keys} permissions={rules} allowRemove onChange={async (key, decision) => { const next = { ...rules }; if (decision === 'remove') delete next[key]; else next[key] = decision as PermissionBucket[string]; onChange(next); }} />
    <Button small variant="secondary" onClick={() => setAdding(true)}>{t('perms.addRule')}</Button>
    {adding && createPortal(<AddRuleModal availableKeys={[...COMMON_PERM_KEYS.filter(key => key !== 'getPublicKey'), ...WOT_TEMPLATE_KEYS, 'signEvent:30078'].filter(key => !(key in rules))} onClose={() => setAdding(false)} onAdd={(key, decision) => {
      try { onChange(validateTemplateRules({ ...rules, [key]: decision })); setError(''); } catch (e) { setError((e as Error).message); }
    }} />, document.body)}
    <Input small label={t('templates.name')} maxLength={80} value={name} onChange={event => setName(event.target.value)} />
    <Text variant="hint">{t('templates.snapshot')}</Text>
    <Container variant="row" gap={2} className="flex-wrap">
      <Button small disabled={busy || !name.trim()} onClick={() => void save()}>{t('common.save')}</Button>
      {selected.startsWith('custom-') && <>
        <Button small variant="secondary" disabled={busy || !name.trim()} onClick={() => void save(true)}>{t('templates.duplicate')}</Button>
        <Button small variant="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await rpc('templates_delete', { id: selected }); setCustom(items => items.filter(item => item.id !== selected)); setSelected(''); setName(''); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{t('common.delete')}</Button>
      </>}
    </Container>
    <FormError>{error}</FormError>
  </Container>;
}
