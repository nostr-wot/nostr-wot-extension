import { useEffect, useState } from 'react';
import type { ArchiveRecord } from '@domain/archive/types';
import { rpcRead } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import Card from '@components/Card';
import Text from '@components/Text';
import Button from '@components/Button';
import FieldDisplay from '@components/FieldDisplay';
import ProfileSummary from '@components/ProfileSummary';
import FormError from '@components/FormError';
import Spinner from '@components/Spinner';
import browser from '@lib/browser';
import { ARCHIVE_EXPLORER_PAGE_SIZE } from '@constants/archive';
import { profileDisplayName, cachedPublicProfile } from '@domain/profile/publicProfile';
import { ArchivePerson } from './ArchiveEventDetail';

function ArchiveContacts({ contacts, query }: { contacts: string[]; query: string }) {
  const [matches, setMatches] = useState<string[]>(contacts);
  const [limit, setLimit] = useState(ARCHIVE_EXPLORER_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const keys = JSON.stringify(contacts);
  useEffect(() => {
    let live = true;
    setLimit(ARCHIVE_EXPLORER_PAGE_SIZE); setError('');
    const all = JSON.parse(keys) as string[];
    const text = query.trim().toLowerCase();
    if (!text) { setMatches(all); setLoading(false); return; }
    setMatches([]); setLoading(true);
    void (async () => {
      try {
        const cache = await browser.storage.local.get('profileCache');
        const found: string[] = [];
        for (let index = 0; index < all.length && live; index += ARCHIVE_EXPLORER_PAGE_SIZE) {
          const batch = all.slice(index, index + ARCHIVE_EXPLORER_PAGE_SIZE);
          const stored = await browser.storage.local.get(batch.map(key => `profile_${key}`));
          for (const key of batch) if ([key, profileDisplayName(cachedPublicProfile({ ...stored, ...cache }, key), '')].some(value => value.toLowerCase().includes(text))) found.push(key);
        }
        if (live) setMatches(found);
      } catch (error) { if (live) setError((error as Error).message); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [keys, query]);
  return <>
    {loading && <Spinner />}
    <FormError>{error}</FormError>
    <ul className="list-none p-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">{matches.slice(0, limit).map(pubkey => <li key={pubkey} className="p-5 border-b border-card-border"><ArchivePerson pubkey={pubkey} /></li>)}</ul>
    {!loading && !matches.length && <Text variant="muted">{t('archive.explorer.empty')}</Text>}
    {matches.length > limit && <Button small variant="secondary" onClick={() => setLimit(value => value + ARCHIVE_EXPLORER_PAGE_SIZE)}>{t('common.showMore')}</Button>}
  </>;
}

export default function ArchiveLatestEvent({ accountId, id, query, onDetails }: { accountId: string; id: string; query: string; onDetails: () => void }) {
  const [record, setRecord] = useState<ArchiveRecord | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void rpcRead<ArchiveRecord>('archive_event', { accountId, id }).then(value => { if (live) setRecord(value); }, error => { if (live) setError((error as Error).message); });
    return () => { live = false; };
  }, [accountId, id]);
  if (error) return <FormError>{error}</FormError>;
  if (!record) return <Spinner />;
  const { event } = record;
  const contacts = [...new Set(event.tags.filter(tag => tag[0] === 'p' && /^[a-f0-9]{64}$/.test(tag[1] || '')).map(tag => tag[1]))];
  let profile: Record<string, unknown> = {};
  if (event.kind === 0) {
    try { const value = JSON.parse(event.content); if (value && typeof value === 'object' && !Array.isArray(value)) profile = value; }
    catch { return <Card><FormError>{t('event.noEventData')}</FormError><Button small onClick={onDetails}>{t('archive.details')}</Button></Card>; }
  }
  return <Card className="mb-0">
    <div className="flex items-center justify-between gap-5 mb-6">
      <Text variant="muted">{t('archive.explorer.updated')}: {new Date(event.created_at * 1000).toLocaleString()}</Text>
      <Button small variant="secondary" onClick={onDetails}>{t('archive.details')}</Button>
    </div>
    {event.kind === 3 ? <>
      <Text>{t('event.nEntries', { count: contacts.length })}</Text>
      <ArchiveContacts contacts={contacts} query={query} />
    </> : event.kind === 10002 ? <ul className="list-none p-0 divide-y divide-card-border">{event.tags.filter(tag => tag[0] === 'r' && typeof tag[1] === 'string' && (!query || tag[1].toLowerCase().includes(query.toLowerCase()))).map((tag, index) => <li key={index} className="flex items-center justify-between gap-5 py-5"><Text className="text-brand break-all">{tag[1]}</Text><Text variant="muted">{t(tag[2] === 'read' ? 'archive.explorer.read' : tag[2] === 'write' ? 'archive.explorer.write' : 'archive.explorer.readWrite')}</Text></li>)}</ul> : <>
      <ProfileSummary meta={profile} />
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">{Object.entries(profile).filter(([key, value]) => !query || `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`.toLowerCase().includes(query.toLowerCase())).map(([key, value]) => <FieldDisplay key={key} label={key} value={typeof value === 'string' ? value : JSON.stringify(value)} />)}</div>
    </>}
  </Card>;
}
