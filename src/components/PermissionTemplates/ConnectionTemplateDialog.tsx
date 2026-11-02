import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@context/AccountContext';
import { rpc, rpcRead } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import { combineTemplateRules, TEMPLATE_PRESETS, siteTemplate, type PermissionTemplate } from '@domain/permissions/templates';
import type { PermissionBucket } from '@domain/permissions/types';
import Modal from '@components/Modal';
import IconChevronRight from '@assets/IconChevronRight';
import Container from '@components/Container';
import Text from '@components/Text';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import Checkbox from '@components/Checkbox';
import InfoTooltip from '@components/InfoTooltip';
import FormError from '@components/FormError';
import PermissionRulesList from '@screens/Settings/PermissionRulesList';
import TemplateEditor from './index';

export default function ConnectionTemplateDialog({ domain, accountId, onClose, onConnected }: { domain: string; accountId: string; onClose: () => void; onConnected: () => void }) {
  const { active } = useAccount();
  const site = siteTemplate(domain);
  const [selected, setSelected] = useState<string[]>(() => site?.presets ?? []);
  const [custom, setCustom] = useState<PermissionTemplate[]>([]);
  const [draft, setDraft] = useState<PermissionBucket>({});
  const [editorRules, setEditorRules] = useState<PermissionBucket>({});
  const [hasDraft, setHasDraft] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<{ id?: string; title: string; rules: PermissionBucket } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void rpcRead<PermissionTemplate[]>('templates_list').then(items => { if (live && Array.isArray(items)) setCustom(items); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [editing]);
  const templates = [...TEMPLATE_PRESETS, ...custom, ...(hasDraft ? [{ id: 'draft', name: 'templates.customSelection', rules: draft }] : [])];
  const rules = combineTemplateRules(templates.filter(item => selected.includes(item.id)));
  const stale = active?.id !== accountId;
  const connect = async (skip: boolean) => {
    if (busy || stale) return;
    setBusy(true); setError('');
    try { await rpc('templates_connect', { domain, accountId, rules: skip || active?.readOnly ? {} : rules }); onConnected(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const customize = () => { setEditorRules({ ...rules }); setEditing(true); };
  const usePreview = () => {
    if (!preview) return;
    const original = templates.find(item => item.id === preview.id);
    if (original && JSON.stringify(original.rules) === JSON.stringify(preview.rules)) {
      setSelected(previous => [...new Set([...previous, original.id])]);
    } else {
      setDraft(preview.id ? combineTemplateRules([...templates.filter(item => selected.includes(item.id) && item.id !== preview.id), { rules: preview.rules }]) : preview.rules);
      setHasDraft(true); setSelected(['draft']);
    }
    setPreview(null);
  };
  return createPortal(<><Modal title={t('templates.givePermissions')} onClose={() => { if (!busy) onClose(); }} footer={<Container gap={3}>
    <Button disabled={busy || stale} onClick={() => void connect(false)}>{t('templates.apply')}</Button>
    <Container variant="row" gap={1}><LinkButton disabled={busy || stale} onClick={() => void connect(true)}>{t('templates.skip')}</LinkButton><InfoTooltip text={t('templates.skipNotice')} /></Container>
  </Container>}>
    <Container gap={4}>
      <Container gap={1}>
        <Text>{site?.name || domain}</Text>
        <Text variant="hint">{site ? `${domain} · ` : ''}{active?.name}</Text>
      </Container>
      {!active?.readOnly && <>
        <Text variant="hint">{t('templates.automaticHint')}<InfoTooltip text={`${t('templates.scopeNotice')} ${active?.type === 'nip46' ? t('templates.remote') : ''}`} /></Text>
        <div className="overflow-hidden rounded-panel border border-card-border">
          <table className="w-full border-collapse text-left" aria-label={t('templates.title')}>
            <tbody>{templates.map(item => {
              const name = item.id.startsWith('custom-') ? item.name : t(item.name);
              const chosen = selected.includes(item.id);
              const inspect = () => { if (!busy) setPreview({ id: item.id, title: name, rules: { ...item.rules } }); };
              return <tr key={item.id} className={`border-b border-card-border last:border-b-0 transition-colors cursor-pointer ${chosen ? 'bg-brand text-on-brand' : 'bg-card hover:bg-brand-light'}`} onClick={inspect}>
                <td className="pl-3 py-2 w-16 align-middle" onClick={event => event.stopPropagation()}>
                  <Checkbox inverse={chosen} aria-label={name} checked={chosen} disabled={busy} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />
                </td>
                <td className="px-4 py-4"><LinkButton className="w-full text-sm font-medium text-inherit hover:text-inherit focus-visible:outline focus-visible:outline-current rounded-sm" disabled={busy} onClick={event => { event.stopPropagation(); inspect(); }}>{name}</LinkButton></td>
                <td className="py-4 text-right text-xs whitespace-nowrap">{site?.presets.includes(item.id) ? t('templates.suggested') : ''}</td>
                <td className="px-4 py-4 w-4 align-middle"><IconChevronRight size={14} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <Container variant="row" gap={4} className="flex-wrap">
          {!!Object.keys(rules).length && <LinkButton tone="brand" className="underline underline-offset-4" disabled={busy} onClick={() => setPreview({ title: t('templates.viewPermissions'), rules: { ...rules } })}>{t('templates.viewPermissions')}</LinkButton>}
          <LinkButton tone="brand" className="underline underline-offset-4" disabled={busy} onClick={customize}>{t('templates.create')}</LinkButton>
        </Container>
      </>}
      <FormError>{stale ? t('templates.accountChanged') : error}</FormError>
    </Container>
  </Modal>
    {preview && <Modal title={preview.title} onClose={() => setPreview(null)} footer={<Button onClick={usePreview}>{t('common.confirm')}</Button>}>
      <PermissionRulesList keys={Object.keys(preview.rules)} permissions={preview.rules} onChange={async (key, decision) => setPreview(previous => previous && ({ ...previous, rules: { ...previous.rules, [key]: decision as PermissionBucket[string] } }))} />
    </Modal>}
    {editing && <Modal title={t('templates.create')} onClose={() => setEditing(false)} footer={<Button onClick={() => { setDraft(editorRules); setHasDraft(true); setSelected(['draft']); setEditing(false); }}>{t('common.confirm')}</Button>}>
      <TemplateEditor rules={editorRules} onChange={setEditorRules} />
    </Modal>}
  </>, document.body);
}
