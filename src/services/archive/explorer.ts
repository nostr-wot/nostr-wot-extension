import { ARCHIVE_EXPLORER_PAGE_SIZE, ARCHIVE_EXPLORER_QUERY_LENGTH, ARCHIVE_EXPLORER_PEOPLE_LIMIT, ARCHIVE_EXPLORER_SUMMARY_LENGTH } from '@constants/archive';
import browser from '@lib/browser';
import { cachedPublicProfile, profileDisplayName } from '@domain/profile/publicProfile';
import { readArchivePage, readArchiveRecord } from './database';
import { matchesArchivedEvent, ARCHIVE_EXPLORER_TABS, archiveMessage, type ArchiveExplorerFilter } from '@domain/archive/explorer';
import { decryptForAccount, reviewDecryptedMessage } from '../signing/localDecryption';
import * as vault from '../vault/vault';

/** One bounded scan per RPC. The UI can cancel between batches without retaining a plaintext index. */
export async function exploreArchive(accountId: string, input: unknown, cursor?: unknown) {
  const filter = input as ArchiveExplorerFilter;
  const after = cursor as string | undefined;
  if (!filter || !ARCHIVE_EXPLORER_TABS.includes(filter.tab) || typeof filter.query !== 'string' || filter.query.length > ARCHIVE_EXPLORER_QUERY_LENGTH ||
      (filter.kind !== undefined && (!Number.isInteger(filter.kind) || filter.kind < 0 || filter.kind > 65535)) ||
      (after !== undefined && (typeof after !== 'string' || !/^[0-9a-f]{64}$/.test(after)))) throw new Error('Invalid archive search');
  const revision = vault.getSessionRevision();
  const page = await readArchivePage(accountId, after, ARCHIVE_EXPLORER_PAGE_SIZE);
  const keys = [...new Set(page.records.flatMap(({ event }) => [event.pubkey, ...event.tags.filter(tag => tag[0] === 'p' && /^[a-f0-9]{64}$/.test(tag[1] ?? '')).slice(0, ARCHIVE_EXPLORER_PEOPLE_LIMIT).map(tag => tag[1])]))];
  const profiles = await browser.storage.local.get(['profileCache', ...keys.map(key => `profile_${key}`)]);
  if (vault.isLocked() || vault.getSessionRevision() !== revision) throw new Error('Vault is locked');
  const query = filter.query.trim().toLowerCase();
  return { records: page.records.filter(record => matchesArchivedEvent(record, filter) || (query && matchesArchivedEvent(record, { ...filter, query: '' }) && [record.event.pubkey, ...record.event.tags.filter(tag => tag[0] === 'p').slice(0, ARCHIVE_EXPLORER_PEOPLE_LIMIT).map(tag => tag[1])].some(key => {
    const profile = cachedPublicProfile(profiles, key);
    return profileDisplayName(profile, '').toLowerCase().includes(query);
  }))).map(({ event }) => ({ event: { id: event.id, pubkey: event.pubkey, kind: event.kind, created_at: event.created_at }, excerpt: archiveMessage(event.kind) ? '' : event.content.slice(0, ARCHIVE_EXPLORER_SUMMARY_LENGTH) })), next: page.next, scanned: page.records.length };
}
export async function revealArchivedMessage(accountId: string, pubkey: string, id: unknown) {
  if (typeof id !== 'string') throw new Error('Invalid event ID');
  const revision = vault.getSessionRevision();
  const { event } = await readArchiveRecord(accountId, id);
  if (!archiveMessage(event.kind)) throw new Error('This event is not an encrypted message');
  const peer = event.pubkey === pubkey && event.kind === 4 ? event.tags.find(tag => tag[0] === 'p')?.[1] : event.pubkey;
  if (!peer) throw new Error('Message recipient is missing');
  const plaintext = await decryptForAccount(accountId, event.kind === 4 ? 'nip04' : 'nip44', peer, event.content);
  const result = event.kind === 4 ? { plaintext, senderPubkey: event.pubkey } : await reviewDecryptedMessage(accountId, peer, plaintext);
  if (vault.isLocked() || vault.getSessionRevision() !== revision) throw new Error('Vault is locked');
  return result;
}
