import { ARCHIVE_EXPLORER_PEOPLE_LIMIT } from '@constants/archive';
import { createPortal } from 'react-dom';
import { useState, useEffect, useRef } from 'react';
import type { ArchiveRecord } from '@domain/archive/types';
import { archiveMessage, archiveKindLabel } from '@domain/archive/explorer';
import usePublicProfile from '@hooks/usePublicProfile';
import ProfileSummary from '@components/ProfileSummary';
import Modal from '@components/Modal';
import Tabs from '@components/Tabs';
import Container from '@components/Container';
import Text from '@components/Text';
import TextBlock from '@components/TextBlock';
import Button from '@components/Button';
import FormError from '@components/FormError';
import EventPreview from '@components/EventPreview';
import CopyButton from '@components/CopyButton';
import FieldDisplay from '@components/FieldDisplay';
import { rpc } from '@services/rpc';
import { t } from '@services/i18n/i18n';

export function ArchivePerson({ pubkey, label }: { pubkey: string; label?: string }) {
  const { profile } = usePublicProfile(pubkey, { lookup: false, allowStale: true });
  return <Container gap={2} className="min-w-0">
    {label && <Text variant="muted">{label}</Text>}
    <Container variant="row" className="justify-between">
      <ProfileSummary meta={profile} compact fallback={`${pubkey.slice(0, 10)}…${pubkey.slice(-8)}`} />
      <CopyButton value={pubkey} label={t('common.copy')} iconOnly />
    </Container>
  </Container>;
}
interface Revealed { plaintext: string; senderPubkey?: string; decryptedEvent?: Record<string, unknown> }
export default function ArchiveEventDetail({ record, accountId, onClose, revealOnOpen = false }: { revealOnOpen?: boolean; record: ArchiveRecord; accountId: string; onClose: () => void }) {
  const [tab, setTab] = useState('simple');
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const event = record.event;
  const message = archiveMessage(event.kind);
  const wrapped = message && event.kind !== 4;
  const sender = wrapped ? revealed?.senderPubkey : event.pubkey;
  const tags = Array.isArray(revealed?.decryptedEvent?.tags) ? revealed.decryptedEvent.tags.filter((tag): tag is string[] => Array.isArray(tag) && tag.every(part => typeof part === 'string')) : event.tags;
  const sentAt = typeof revealed?.decryptedEvent?.created_at === 'number' && Number.isFinite(revealed.decryptedEvent.created_at) ? revealed.decryptedEvent.created_at : event.created_at;
  const recipients = [...new Set(tags.filter(tag => tag[0] === 'p' && /^[a-f0-9]{64}$/.test(tag[1] || '')).map(tag => tag[1]))];
  async function reveal() {
    setBusy(true); setError('');
    try { const result = await rpc<Revealed>('archive_reveal', { accountId, id: event.id }); if (live.current) setRevealed(result); }
    catch (e) { if (live.current) setError((e as Error).message); }
    finally { if (live.current) setBusy(false); }
  }
  const didReveal = useRef(false);
  useEffect(() => {
    if (revealOnOpen && message && !didReveal.current) {
      didReveal.current = true;
      void reveal();
    }
    // This detail component is keyed by event ID; revealing requires an explicit row action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealOnOpen]);
  return createPortal(<Modal maxWidth={840} title={archiveKindLabel(event.kind)} onClose={onClose}>
    <Container gap={5}>
      <Tabs variant="segmented" value={tab} onChange={setTab} options={['simple', 'advanced'].map(value => ({ value, label: t(`archive.explorer.${value}`) }))} />
      {tab === 'simple' ? <>
        <Text variant="muted">{new Date(sentAt * 1000).toLocaleString()}</Text>
        {sender ? <ArchivePerson pubkey={sender} label={t('archive.explorer.from')} /> : <Text variant="muted">{t('archive.explorer.hiddenSender')}</Text>}
        {message && recipients.slice(0, ARCHIVE_EXPLORER_PEOPLE_LIMIT).map(pubkey => <ArchivePerson key={pubkey} pubkey={pubkey} label={t('archive.explorer.to')} />)}
        {message ? revealed ? <TextBlock>{revealed.plaintext}</TextBlock> : <><Text variant="muted">{t('archive.explorer.encrypted')}</Text><Button small disabled={busy} onClick={() => void reveal()}>{t(busy ? 'common.loading' : 'archive.explorer.reveal')}</Button></> : <EventPreview type="signEvent" event={{ ...event }} compact technical={false} />}
        <FormError>{error}</FormError>
      </> : <>
        <FieldDisplay label={t('archive.explorer.saved')} value={new Date(record.savedAt).toLocaleString()} />
        <Text>{t('archive.explorer.sources')}</Text>
        {record.sources.length ? record.sources.map(source => <Text key={source} className="break-all text-brand text-sm">{source}</Text>) : <Text variant="muted">{t('archive.explorer.unknownSource')}</Text>}
        <CopyButton value={JSON.stringify(event)} label={t('common.copy')} />
        <TextBlock mono>{JSON.stringify(event, null, 2)}</TextBlock>
      </>}
    </Container>
  </Modal>, document.body);
}
