import { archiveRelayResults } from '@domain/archive/results.ts';
import { archiveRelays } from '@domain/archive/settings.ts';
import { configuredRelayUrls } from '@domain/relays/relayList.ts';
import * as kinds from 'nostr-tools/kinds';
import { ARCHIVE_CHANGED_KEY, ARCHIVE_SETTINGS_PREFIX } from '@constants/archive.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import {
  initialArchiveSettings,
  validateArchiveSettings,
  archiveRelayUrl,
} from '@domain/archive/settings.ts';
import {
  type ArchiveProgress,
  type ArchiveSyncJob,
  type ArchiveSettings,
  type ArchiveState,
  type ArchiveCopyResult,
} from '@domain/archive/types.ts';
import { archiveSummary } from './database.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';
import { queryRelay } from '../relays/transport.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';

export const retryQueueKey = (id: string) => `archiveRetryQueue:${id}`;
export const jobKey = (id: string) => `archiveJob:${id}`;
export const progressKey = (id: string) => `archiveProgress:${id}`;
export async function archiveAccount(id?: unknown) {
  await vault.whenStartupUnlockSettled();
  await vault.requireUnlocked();
  const accountId = typeof id === 'string' ? id : vault.getActiveAccountId();
  let account = accountId ? vault.getAccountById(accountId) : null;
  if (!account && accountId) {
    const local = await browser.storage.local.get('accounts');
    account =
      (local.accounts as SafeAccount[] | undefined)?.find(
        (a) => a.id === accountId && a.type === 'npub' && a.readOnly && /^[0-9a-f]{64}$/.test(a.pubkey),
      ) ?? null;
    await vault.requireUnlocked();
  }
  if (!account) throw new Error('Account is unavailable');
  return account;
}
export async function getArchiveSettings(id: string): Promise<ArchiveSettings> {
  const key = ARCHIVE_SETTINGS_PREFIX + id;
  const stored = await browser.storage.local.get(key);
  const relays = await browser.storage.sync.get('relays');
  const defaults = initialArchiveSettings(configuredRelayUrls(relays.relays));
  if (!stored[key]) return defaults;
  const legacy = stored[key] as ArchiveSettings & { enabled?: boolean };
  return validateArchiveSettings({
    ...legacy,
    automatic: legacy.enabled === false ? false : legacy.automatic,
    ...(Array.isArray(legacy.groups) && legacy.groups.length === 0
      ? { groups: defaults.groups, selectedGroupId: defaults.selectedGroupId }
      : {}),
  });
}
export async function notifyArchive() {
  await browser.storage.local.set({ [ARCHIVE_CHANGED_KEY]: crypto.randomUUID() });
}
export async function saveArchiveSettings(id: string, settings: ArchiveSettings) {
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + id]: validateArchiveSettings(settings) });
  await notifyArchive();
}
export async function saveArchiveProgress(
  id: string,
  progress: ArchiveProgress,
  copyResult?: ArchiveCopyResult,
) {
  await browser.storage.local.set({ [progressKey(id)]: { progress, copyResult } });
  await notifyArchive();
}
export async function getArchiveState(requestedId?: unknown): Promise<ArchiveState> {
  await vault.whenStartupUnlockSettled();
  const local = await browser.storage.local.get(['accounts', 'activeAccountId']);
  const id = typeof requestedId === 'string' ? requestedId : (local.activeAccountId as string);
  const account =
    (local.accounts as SafeAccount[] | undefined)?.find((a) => a.id === id) ?? vault.getAccountById(id);
  if (!account) throw new Error('Account is unavailable');
  const [settings, summary, stored] = await Promise.all([
    getArchiveSettings(id),
    archiveSummary(id),
    browser.storage.local.get([progressKey(id), retryQueueKey(id), jobKey(id)]),
  ]);
  const value = stored[progressKey(id)] as
    | { progress?: ArchiveProgress; copyResult?: ArchiveCopyResult }
    | undefined;
  const job = stored[jobKey(id)] as ArchiveSyncJob | undefined;
  const relayResults = archiveRelayResults(archiveRelays(settings), settings.includeMessages, summary.checkpoints).map(result => {
    const previous = value?.progress?.relayResults?.find(old => old.relay === result.relay);
    return { ...result, added: job?.relayAdded?.[result.relay] ?? previous?.added, fetched: job?.relayFetched?.[result.relay] ?? previous?.fetched };
  });
  const progress = vault.isLocked()
    ? { phase: 'locked' as const, fetched: 0 }
    : { ...(value?.progress ?? { phase: 'idle' as const, fetched: 0 }), relayResults };
  return {
    accountId: id,
    pubkey: account.pubkey,
    settings,
    ...summary,
    progress,
    pendingRelays: vault.isLocked() ? [] : [...new Set([
      ...(job?.tasks?.filter((_, index) => index >= (job.cursor ?? 0) && !job.completedTasks?.includes(index)).map(task => task.relay) ?? []),
      ...((stored[retryQueueKey(id)] as string[] | undefined) ?? []),
    ])],
    copyResult: value?.copyResult,
  };
}
export async function archiveSources(id: string) {
  const account = await archiveAccount(id);
  const configured = await getArchiveSettings(id);
  const discovery = [
    ...new Set([...configured.groups.flatMap((group) => group.relays), ...DEFAULT_RELAYS]),
  ].slice(0, 8);
  const abort = new AbortController();
  const revision = vault.getSessionRevision();
  const stop = vault.onSessionInvalidated(() => abort.abort());
  let events;
  try {
    const results = await Promise.all(
      discovery.map((relay) =>
        queryRelay(
          relay,
          { authors: [account.pubkey], kinds: [kinds.RelayList, kinds.DirectMessageRelaysList], limit: 4 },
          { signal: abort.signal, timeoutMs: 6000 },
        ),
      ),
    );
    abort.signal.throwIfAborted();
    if (vault.getSessionRevision() !== revision) throw new Error('Account session changed');
    events = results
      .flatMap((result) => result.events)
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  } finally {
    stop();
  }
  const publicList = events.find((event) => event.kind === kinds.RelayList);
  const privateList = events.find((event) => event.kind === kinds.DirectMessageRelaysList);
  const urls = (tags: string[][] | undefined, tag: string) =>
    [
      ...new Set(
        (tags ?? [])
          .filter((t) => t[0] === tag)
          .flatMap((t) => {
            try {
              return [archiveRelayUrl(t[1])];
            } catch {
              return [];
            }
          }),
      ),
    ].slice(0, 32);
  const relays = urls(publicList?.tags, 'r');
  return { relays: relays.length ? relays : discovery, messageRelays: urls(privateList?.tags, 'relay') };
}
