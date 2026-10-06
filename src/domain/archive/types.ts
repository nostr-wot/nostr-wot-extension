import type { SignedEvent } from '@domain/nostr/types.ts';

export interface ArchiveRelayGroup {
  id: string;
  name: string;
  relays: string[];
}
export interface ArchiveSettings {
  automatic: boolean;
  intervalMinutes: number;
  includeMessages: boolean;
  groups: ArchiveRelayGroup[];
  selectedGroupId: string;
}
export type ArchivePhase =
  | 'idle'
  | 'syncing'
  | 'paused'
  | 'locked'
  | 'complete'
  | 'partial'
  | 'error'
  | 'copying';
export interface ArchiveRelayResult {
  fetched?: number;
  attempted?: boolean;
  added?: number;
  relay: string;
  success: boolean;
  errors: string[];
}
export interface ArchiveProgress {
  activeRelays?: string[];
  relayResults?: ArchiveRelayResult[];
  phase: ArchivePhase;
  fetched: number;
  relay?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}
export interface ArchiveCheckpoint {
  key: string;
  relay: string;
  stream: 'authored' | 'messages' | 'legacyMessages';
  since: number;
  until: number;
  nextUntil?: number;
  complete: boolean;
  checkedAt: number;
  fullCheckedAt?: number;
  error?: string;
}
export interface ArchiveRecord {
  event: SignedEvent;
  sources: string[];
  savedAt: number;
}
export interface ArchiveState {
  pendingRelays?: string[];
  accountId: string;
  pubkey: string;
  settings: ArchiveSettings;
  progress: ArchiveProgress;
  count: number;
  bytes: number;
  checkpoints: ArchiveCheckpoint[];
  copyResult?: ArchiveCopyResult;
}
export interface ArchiveCopyFailure {
  id: string;
  kind: number;
  createdAt: number;
  message: string;
  attempts: number;
}
export interface ArchiveCopyResult {
  failures?: ArchiveCopyFailure[];
  accepted: number;
  existing: number;
  failed: number;
  skipped: number;
}

/** Durable worker state shared by the runner and its read-only status projection. */
export interface ArchiveSyncJob {
  completedTasks?: number[];
  initializedTasks?: number[];
  tasks: Array<{ relay: string; stream: ArchiveCheckpoint['stream'] }>;
  cursor: number;
  initialized: boolean;
  full: boolean;
  startedAt: number;
  fetched: number;
  errors: string[];
  relayAdded?: Record<string, number>;
  relayFetched?: Record<string, number>;
}
