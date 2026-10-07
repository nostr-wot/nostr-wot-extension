import { KIND_LABELS } from '@constants/nostr';
import { ARCHIVE_EXPLORER_PAGE_SIZE, ARCHIVE_EXPLORER_QUERY_LENGTH } from '@constants/archive';
import { createPortal } from 'react-dom';
import { useVault } from '@context/VaultContext';
import { useState } from 'react';
import { ARCHIVE_EXPLORER_TABS, ARCHIVE_MESSAGE_KINDS, archiveMessage, archiveKindLabel, type ArchiveExplorerTab } from '@domain/archive/explorer';
import type { ArchiveRecord } from '@domain/archive/types';
import useArchiveExplorer from '@hooks/useArchiveExplorer';
import Container from '@components/Container';
import Text from '@components/Text';
import Heading from '@components/Heading';
import Input from '@components/Input';
import Tabs from '@components/Tabs';
import Dropdown from '@components/Dropdown';
import Card from '@components/Card';
import Button from '@components/Button';
import Checkbox from '@components/Checkbox';
import Spinner from '@components/Spinner';
import IconButton from '@components/IconButton';
import IconSync from '@assets/IconSync';
import ConfirmDialog from '@components/ConfirmDialog';
import FormError from '@components/FormError';
import ArchiveEventDetail, { ArchivePerson } from './ArchiveEventDetail';
import { rpc, rpcRead } from '@services/rpc';
import { t } from '@services/i18n/i18n';

interface Props { accountId: string; total: number; onChanged: () => Promise<void> }
export default function ArchiveExplorerScreen(props: Props) {
  const { locked } = useVault();
  return locked ? null : <ArchiveExplorerContent {...props} />;
}
export function ArchiveExplorerContent({ accountId, total, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ArchiveExplorerTab>('all');
  const [kind, setKind] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [revealOnOpen, setRevealOnOpen] = useState(false);
  const [detail, setDetail] = useState<ArchiveRecord | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = useArchiveExplorer(accountId, { tab, query, ...(kind !== '' ? { kind: Number(kind) } : {}) }, revision, total);
  async function openDetail(id: string, reveal = false) {
    setRevealOnOpen(reveal);
    setError(''); setBusy(true);
    try { setDetail(await rpcRead<ArchiveRecord>('archive_event', { accountId, id })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setSelected([]); setRevision(value => value + 1); await onChanged();
  }
  async function remove() {
    setBusy(true); setError('');
    try { await rpc('archive_deleteEvents', { accountId, ids: selected }); setConfirm(false); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const messageView = tab === 'messages' || (kind !== '' && archiveMessage(Number(kind)));
  const genericView = tab === 'other' || (tab === 'all' && kind === '');
  const kindTabs = Object.entries(KIND_LABELS).filter(([value]) => Number(value) !== 1).map(([value, label]) => ({ value: `kind-${value}`, label: value === '7' ? t('archive.explorer.likes') : value === '6' ? t('archive.explorer.reposts') : label }));
  const activeTab = tab === 'all' && kind !== '' ? `kind-${kind}` : tab;
  const offset = result.page * ARCHIVE_EXPLORER_PAGE_SIZE;
  const allSelected = result.records.length > 0 && selected.length === result.records.length;
  return <main className="w-full min-w-0 max-w-[1400px] mx-auto p-8 md:p-12 box-border">
    <header className="flex items-center justify-between gap-6 mb-10">
      <Container gap={2}>
        <Heading as="h1">{t('archive.explorer.title')}</Heading>
        <Text variant="muted">{t('archive.explorer.total', { count: total.toLocaleString() })}</Text>
      </Container>
      <IconButton tone="brand" title={t('common.refresh')} aria-label={t('common.refresh')} disabled={busy || result.loading} onClick={() => void refresh().catch(e => setError((e as Error).message))}><IconSync /></IconButton>
    </header>
    <div className="flex flex-col gap-6">
      <aside className="w-full min-w-0 flex flex-col gap-5">
        <Input label={t('archive.explorer.search')} value={query} maxLength={ARCHIVE_EXPLORER_QUERY_LENGTH} onChange={e => { setQuery(e.target.value); setSelected([]); }} />
        <Tabs className="overflow-x-auto [&>button]:flex-none [&>button]:px-5 [&>button]:whitespace-nowrap" variant="segmented" label={t('archive.explorer.types')} value={activeTab} onChange={value => { if (value.startsWith('kind-')) { setTab('all'); setKind(value.slice(5)); } else { setTab(value as ArchiveExplorerTab); setKind(''); } setSelected([]); }} options={[...ARCHIVE_EXPLORER_TABS.filter(value => value !== 'other').map(value => ({ value, label: t(`archive.explorer.${value}`) })), ...kindTabs, { value: 'other', label: t('archive.explorer.other') }]} />
        {tab === 'messages' ? <Dropdown aria-label={t('archive.explorer.types')} value={kind} onChange={value => { setKind(value); setSelected([]); }} options={[{ value: '', label: t('archive.explorer.all') }, ...ARCHIVE_MESSAGE_KINDS.map(value => ({ value: String(value), label: archiveKindLabel(value) }))]} /> : tab === 'other' ? <Input label={t('event.kind')} type="number" min={0} max={65535} placeholder={t('archive.explorer.all')} value={kind} onChange={e => { setKind(e.target.value); setSelected([]); }} /> : null}
        <Text variant="muted" className="text-sm">{t('archive.explorer.searchHelp')}</Text>
      </aside>
      <section className="w-full min-w-0 flex flex-col gap-5" aria-label={t('archive.explorer.results')}>
        <div className="flex items-center justify-between flex-wrap gap-4 min-h-16">
          <div aria-live="polite">
            <Text>{t(result.loading || result.error ? 'archive.explorer.matchesSoFar' : 'archive.explorer.matches', { count: result.matching.toLocaleString() })}</Text>
            {result.loading ? <Text variant="muted" className="text-sm">{t('archive.explorer.searchProgress', { count: result.scanned.toLocaleString(), total: total.toLocaleString() })}</Text> : result.records.length > 0 && <Text variant="muted" className="text-sm">{t('archive.explorer.showing', { from: offset + 1, to: offset + result.records.length })}</Text>}
          </div>
          {result.loading && <Spinner />}
          {!result.loading && result.records.length > 0 && <label className="flex items-center gap-3 text-sm text-secondary cursor-pointer"><Checkbox checked={allSelected} onChange={e => setSelected(e.target.checked ? result.records.map(record => record.event.id) : [])} />{t('archive.explorer.selectPage')}</label>}
          {!!selected.length && <Button variant="danger" small disabled={busy || result.loading} onClick={() => setConfirm(true)}>{t('archive.explorer.delete', { count: selected.length })}</Button>}
        </div>
        <FormError>{result.error || (!confirm && error)}</FormError>
        <div className="relative w-full min-w-0 overflow-x-auto border border-card-border rounded-panel">
          <table className="w-full text-left text-sm min-w-[760px]">
            <thead className="bg-card text-secondary"><tr>
              <th scope="col" className="p-4"><span className="sr-only">{t('archive.explorer.selectPage')}</span></th>
              <th scope="col" className="p-4">{t('archive.explorer.date')}</th>
              {genericView && <th scope="col" className="p-4">{t('event.kind')}</th>}
              <th scope="col" className="p-4">{t('archive.explorer.from')}</th>
              {messageView && <th scope="col" className="p-4">{t('archive.explorer.to')}</th>}
              <th scope="col" className="p-4">{t(genericView ? 'archive.explorer.eventId' : 'archive.explorer.content')}</th>
              <th scope="col" className="p-4"><span className="sr-only">{t('archive.details')}</span></th>
            </tr></thead>
            <tbody>{result.records.map(record => <tr key={record.event.id} className="border-t border-card-border hover:bg-hover">
              <td className="p-4"><Checkbox aria-label={t('archive.explorer.select', { id: record.event.id })} checked={selected.includes(record.event.id)} disabled={busy || result.loading} onChange={e => setSelected(previous => e.target.checked ? [...previous, record.event.id] : previous.filter(id => id !== record.event.id))} /></td>
              <td className="p-4 whitespace-nowrap text-secondary">{new Date(record.event.created_at * 1000).toLocaleString()}</td>
              {genericView && <td className="p-4 text-brand">{archiveKindLabel(record.event.kind)} <span className="text-muted">({record.event.kind})</span></td>}
              <td className="p-4 min-w-48">{archiveMessage(record.event.kind) && record.event.kind !== 4 ? <Text variant="muted">{t('archive.explorer.hiddenSender')}</Text> : <ArchivePerson pubkey={record.event.pubkey} />}</td>
              {messageView && <td className="p-4 min-w-48">{record.recipients?.length ? record.recipients.map(pubkey => <ArchivePerson key={pubkey} pubkey={pubkey} />) : '—'}</td>}
              <td className="p-4 max-w-lg">{genericView ? <span className="font-mono text-muted" title={record.event.id}>{record.event.id.slice(0, 12)}…{record.event.id.slice(-8)}</span> : <Text className="line-clamp-3 break-words">{archiveMessage(record.event.kind) ? t('archive.explorer.encrypted') : record.excerpt.slice(0, 240) || t('archive.explorer.metadata')}</Text>}</td>
              <td className="p-4"><Container gap={3}>{messageView && <Button small disabled={busy} onClick={() => void openDetail(record.event.id, true)}>{t('archive.explorer.reveal')}</Button>}<Button variant="secondary" small disabled={busy} onClick={() => void openDetail(record.event.id)}>{t('archive.details')}</Button></Container></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!result.loading && !result.records.length && !result.error && <Card><Text>{t('archive.explorer.empty')}</Text></Card>}
        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" small disabled={result.loading || !!result.error || result.page === 0} onClick={() => { setSelected([]); result.previousPage(); }}>{t('archive.explorer.previous')}</Button>
          {result.error && <Button small onClick={() => void refresh().catch(e => setError((e as Error).message))}>{t('common.retry')}</Button>}
          <Button variant="secondary" small disabled={result.loading || !!result.error || !result.more} onClick={() => { setSelected([]); result.nextPage(); }}>{t('archive.explorer.next')}</Button>
        </div>
      </section>
    </div>
    {detail && <ArchiveEventDetail key={detail.event.id} record={detail} revealOnOpen={revealOnOpen} accountId={accountId} onClose={() => setDetail(null)} />}
    {confirm && createPortal(<ConfirmDialog title={t('archive.explorer.delete', { count: selected.length })} message={t('archive.explorer.deleteWarning')} danger busy={busy} error={error} onCancel={() => setConfirm(false)} onConfirm={() => void remove()} />, document.body)}
  </main>;
}
