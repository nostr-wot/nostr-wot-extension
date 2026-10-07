import type { ArchiveSettings } from '@domain/archive/types.ts';

export enum ArchiveInterval {
  Hourly = 60,
  Daily = 1440,
  Weekly = 10080,
}
export const ARCHIVE_INTERVAL_OPTIONS = [
  { minutes: ArchiveInterval.Hourly, label: 'archive.hourly' },
  { minutes: ArchiveInterval.Daily, label: 'archive.daily' },
  { minutes: ArchiveInterval.Weekly, label: 'archive.weekly' },
] as const;

export const ARCHIVE_CHANGED_KEY = 'archiveChanged';
export const ARCHIVE_SETTINGS_PREFIX = 'archiveSettings:';
export const ARCHIVE_ALARM = 'archive-sync';
export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  automatic: false,
  intervalMinutes: ArchiveInterval.Hourly,
  includeMessages: true,
  groups: [],
  selectedGroupId: '',
};

export const ARCHIVE_DATABASE = 'nostr-wot-archive';
export const ARCHIVE_IMPORT_DATABASE = 'nostr-wot-archive-import';
export const MAX_ARCHIVE_BATCH = 100;
export const MAX_ARCHIVE_RECORD_BYTES = 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_LINE_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_FILE_BYTES = 512 * 1024 * 1024;
export const ARCHIVE_FILE_SESSION_MS = 10 * 60_000;
// Leave time for finalization after a file session expires.
export const ARCHIVE_OPERATION_HOLD_MS = ARCHIVE_FILE_SESSION_MS + 60_000;
export const ARCHIVE_WORK_SLICE_MS = 20_000;
export const ARCHIVE_OVERLAP_SECONDS = 7 * 86400;
export const ARCHIVE_RECONCILE_MS = ARCHIVE_OVERLAP_SECONDS * 1000;
export const ARCHIVE_RECONCILE_BUDGET_MS = 15_000;
export const ARCHIVE_PAGE_SIZE = 500;
export const MAX_ARCHIVE_PAGE_SIZE = 4000;
export const MAX_ARCHIVE_GROUPS = 12;
export const MAX_ARCHIVE_GROUP_NAME_LENGTH = 80;
export const MAX_ARCHIVE_RELAYS_PER_GROUP = 32;
export const MAX_ARCHIVE_RELAY_URL_LENGTH = 2048;
export const MIN_ARCHIVE_PASSWORD_LENGTH = 8;
export const MAX_ARCHIVE_PASSWORD_LENGTH = 1024;
export const MAX_ARCHIVE_FILE_SESSIONS = 4;
export const ARCHIVE_EXPORT_CHUNK_RECORDS = 64;
export const MAX_ARCHIVE_RECORD_SOURCES = 100;
export const ARCHIVE_PROGRESS_POLL_MS = 1500;

export const MAX_ARCHIVE_AUTH_ATTEMPTS = 3;

export const ARCHIVE_EXPLORER_PAGE_SIZE = 40;
export const ARCHIVE_EXPLORER_QUERY_LENGTH = 200;
export const ARCHIVE_EXPLORER_PEOPLE_LIMIT = 12;
export const ARCHIVE_EXPLORER_SUMMARY_LENGTH = 1024;
