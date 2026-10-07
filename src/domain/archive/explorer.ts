import type { SignedEvent } from '@domain/nostr/types';
import type { ArchiveRecord } from './types';
import { KIND_LABELS } from '@constants/nostr';

export const ARCHIVE_EXPLORER_TABS = ['all', 'notes', 'messages', 'other'] as const;
export type ArchiveExplorerTab = typeof ARCHIVE_EXPLORER_TABS[number];
export const ARCHIVE_MESSAGE_KINDS = [4, 1059, 21059] as const;
export function archiveMessage(kind: number): boolean { return (ARCHIVE_MESSAGE_KINDS as readonly number[]).includes(kind); }
export function archiveKindLabel(kind: number): string { return KIND_LABELS[kind] || `Kind ${kind}`; }
export interface ArchiveExplorerFilter { tab: ArchiveExplorerTab; query: string; kind?: number }
export function matchesArchivedEvent(record: ArchiveRecord, filter: ArchiveExplorerFilter): boolean {
  const event = record.event;
  if (filter.kind !== undefined && event.kind !== filter.kind) return false;
  if (filter.tab === 'notes' && event.kind !== 1 && event.kind !== 30023) return false;
  if (filter.tab === 'messages' && !archiveMessage(event.kind)) return false;
  if (filter.tab === 'other' && (archiveMessage(event.kind) || event.kind === 1 || event.kind === 30023)) return false;
  const query = filter.query.trim().toLowerCase();
  return !query || [event.id, event.pubkey, String(event.kind), archiveKindLabel(event.kind), ...record.sources,
    ...event.tags.flat(), ...(archiveMessage(event.kind) ? [] : [event.content])].some(value => value.toLowerCase().includes(query));
}

/** Search results carry display excerpts, never a modified object presented as a signed event. */
export interface ArchiveExplorerItem {
  event: Pick<SignedEvent, 'id' | 'pubkey' | 'kind' | 'created_at'>;
  excerpt: string;
}
