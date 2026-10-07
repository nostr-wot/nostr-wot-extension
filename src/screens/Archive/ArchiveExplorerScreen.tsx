import { MAX_ARCHIVE_BATCH, ARCHIVE_EXPLORER_QUERY_LENGTH } from '@constants/archive';
import InfoTooltip from '@components/InfoTooltip';
import { createPortal } from 'react-dom';
import { useVault } from '@context/VaultContext';
import { useState } from 'react';
import { ARCHIVE_EXPLORER_TABS, ARCHIVE_MESSAGE_KINDS, archiveMessage, archiveKindLabel, type ArchiveExplorerTab } from '@domain/archive/explorer';
import type { ArchiveRecord } from '@domain/archive/types';
import useArchiveExplorer from '@hooks/useArchiveExplorer';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import Text from '@components/Text';
import Input from '@components/Input';
import Tabs from '@components/Tabs';
import Dropdown from '@components/Dropdown';
import Card from '@components/Card';
import Button from '@components/Button';
import Checkbox from '@components/Checkbox';
import Spinner from '@components/Spinner';
import ConfirmDialog from '@components/ConfirmDialog';
import FormError from '@components/FormError';
import ArchiveEventDetail, { ArchivePerson } from './ArchiveEventDetail';
import { rpc } from '@services/rpc';
import { t } from '@services/i18n/i18n';

interface Props { accountId: string; onBack: () => void; onChanged: () => Promise<void> }
export default function ArchiveExplorerScreen(props: Props) {
  const { locked } = useVault();
  return locked ? null : <ArchiveExplorerContent {...props} />;
}
export function ArchiveExplorerContent({ accountId, onBack, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ArchiveExplorerTab>('all');
  const [kind, setKind] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<ArchiveRecord | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = useArchiveExplorer(accountId, { tab, query, ...(kind !== '' ? { kind: Number(kind) } : {}) }, revision);
  async function openDetail(id: string) {
    setError(''); setBusy(true);
    try { setDetail(await rpc<ArchiveRecord>('archive_event', { accountId, id })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { await rpc('archive_deleteEvents', { accountId, ids: selected }); setSelected([]); setConfirm(false); setRevision(value => value + 1); await onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return createPortal(<OverlayPanel className="fixed inset-2 rounded-xl overflow-hidden" title={t('archive.explorer.title')} headerRight={<InfoTooltip text={t('archive.explorer.searchHelp')} />} onBack={busy ? null : onBack} zIndex={400}>
    <Container gap={4} className="min-h-0 overflow-y-auto pb-6">
      <Input label={t('archive.explorer.search')} value={query} maxLength={ARCHIVE_EXPLORER_QUERY_LENGTH} onChange={e => { setQuery(e.target.value); setSelected([]); }} />
      <Tabs variant="segmented" label={t('archive.explorer.types')} value={tab} onChange={value => { setTab(value); setKind(''); setSelected([]); }} options={ARCHIVE_EXPLORER_TABS.map(value => ({ value, label: t(`archive.explorer.${value}`) }))} />
      {tab === 'messages' ? <Dropdown value={kind} onChange={value => { setKind(value); setSelected([]); }} options={[{ value: '', label: t('archive.explorer.all') }, ...ARCHIVE_MESSAGE_KINDS.map(value => ({ value: String(value), label: archiveKindLabel(value) }))]} /> : tab === 'other' ? <Input label={t('event.kind')} type="number" min={0} max={65535} placeholder={t('archive.explorer.all')} value={kind} onChange={e => { setKind(e.target.value); setSelected([]); }} /> : null}
      {!!selected.length && <Button variant="danger" small onClick={() => setConfirm(true)}>{t('archive.explorer.delete', { count: selected.length })}</Button>}
      <Text variant="muted" className="text-xs" role="status">{t('archive.explorer.scanned', { count: result.scanned })}</Text>
      {result.records.map(record => <Card key={record.event.id} className="mb-0 flex flex-col gap-3">
        <Container variant="row" className="justify-between">
          <Text className="text-brand font-semibold">{archiveKindLabel(record.event.kind)}</Text>
          <Checkbox aria-label={t('archive.explorer.select', { id: record.event.id })} checked={selected.includes(record.event.id)} disabled={selected.length >= MAX_ARCHIVE_BATCH && !selected.includes(record.event.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, record.event.id] : previous.filter(id => id !== record.event.id))} />
        </Container>
        <Text variant="muted" className="text-xs">{new Date(record.event.created_at * 1000).toLocaleString()}</Text>
        {record.event.kind !== 1059 && record.event.kind !== 21059 && <ArchivePerson pubkey={record.event.pubkey} />}
        <Text className="line-clamp-3 break-words text-sm">{archiveMessage(record.event.kind) ? t('archive.explorer.encrypted') : record.excerpt.slice(0, 240) || t('archive.explorer.metadata')}</Text>
        <Button variant="secondary" small disabled={busy} onClick={() => void openDetail(record.event.id)}>{t('archive.details')}</Button>
      </Card>)}
      {result.loading && <Spinner />}
      {!result.loading && !result.records.length && !result.error && <Text>{t('archive.explorer.empty')}</Text>}
      <FormError>{result.error || (!confirm && error)}</FormError>
      {(result.more || result.error) && <Button small disabled={result.loading} onClick={result.loadMore}>{t(result.error ? 'common.retry' : 'archive.explorer.more')}</Button>}
      {detail && <ArchiveEventDetail key={detail.event.id} record={detail} accountId={accountId} onClose={() => setDetail(null)} />}
      {confirm && createPortal(<ConfirmDialog title={t('archive.explorer.delete', { count: selected.length })} message={t('archive.explorer.deleteWarning')} danger busy={busy} error={error} onCancel={() => setConfirm(false)} onConfirm={() => void remove()} />, document.body)}
    </Container>
  </OverlayPanel>, document.body);
}
