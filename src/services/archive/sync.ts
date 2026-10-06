import { AsyncLock } from '@utils/asyncLock.ts';
import { archiveControl } from './control.ts';
import { jobKey, retryQueueKey, notifyArchive } from './state.ts';
import { archiveRelayResults } from '@domain/archive/results';
import * as kinds from 'nostr-tools/kinds';
import { ARCHIVE_OPERATION_HOLD_MS, ARCHIVE_WORK_SLICE_MS, MAX_ARCHIVE_BATCH } from '@constants/archive.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { archiveRelays } from '@domain/archive/settings.ts';
import { nextArchiveRange } from '@domain/archive/checkpoint.ts';
import { eventBelongs, shouldArchive } from '@domain/archive/policy.ts';
import type { ArchiveCheckpoint, ArchiveProgress, ArchiveSyncJob } from '@domain/archive/types.ts';
import type { NostrFilter } from '@domain/relays/types.ts';
import { queryArchiveRelay } from './query.ts';
import { archiveSummary, commitArchiveBatch } from './database.ts';
import { archiveAccount, getArchiveSettings, saveArchiveProgress, progressKey } from './state.ts';
import { reconcileArchive } from './reconcile.ts';
import { syncArchivePage } from './pagination.ts';
import { archiveTransportOptions } from './authentication.ts';

const running = new Map<string, { abort: AbortController; done: Promise<void> }>();
class ArchiveWriteError extends Error {}
const held = new Map<string, number>();
export const archiveBusy = (id: string) => running.has(id) || (held.get(id) ?? 0) > Date.now();
export function holdArchive(id: string) {
  if (archiveBusy(id)) throw new Error('Pause the current archive operation first');
  held.set(id, Date.now() + ARCHIVE_OPERATION_HOLD_MS);
}
export function releaseArchive(id: string) {
  held.delete(id);
}
export async function suspendArchive(id: string) {
  const active = running.get(id);
  active?.abort.abort();
  await active?.done;
}
export async function pauseArchive(id: string) {
  await suspendArchive(id);
  await browser.storage.local.remove([jobKey(id), retryQueueKey(id)]);
  await saveArchiveProgress(id, { phase: 'paused', fetched: 0 });
}
export function cancelArchiveOperations() {
  for (const job of running.values()) job.abort.abort();
  held.clear();
}
export async function drainArchiveOperations(): Promise<void> {
  await Promise.allSettled([...running.values()].map((job) => job.done));
}
export function streamFilter(pubkey: string, stream: ArchiveCheckpoint['stream']): NostrFilter {
  return stream === 'authored'
    ? { authors: [pubkey] }
    : { kinds: [stream === 'messages' ? kinds.GiftWrap : kinds.EncryptedDirectMessage], '#p': [pubkey] };
}
export async function startArchiveSync(id: string, full = false, relay?: string) {
  // Control handlers serialize queue edits; the worker never holds this lock over network work.
  if (relay !== undefined) {
    await archiveAccount(id);
    const selected = archiveRelays(await getArchiveSettings(id));
    if (!selected.includes(relay) || full) throw new Error('Invalid archive retry relay');
    if (running.has(id)) {
      const stored = await browser.storage.local.get([jobKey(id), retryQueueKey(id)]);
      const current = stored[jobKey(id)] as ArchiveSyncJob | undefined;
      if (!current?.tasks.some((task, index) => index >= current.cursor && !current.completedTasks?.includes(index) && task.relay === relay)) {
        const queue = (stored[retryQueueKey(id)] as string[] | undefined) ?? [];
        await browser.storage.local.set({ [retryQueueKey(id)]: [...new Set([...queue, relay])] });
        await notifyArchive();
      }
      return;
    }
  }
  holdArchive(id);
  try {
    await archiveAccount(id);
    const revision = vault.getSessionRevision();
    const settings = await getArchiveSettings(id);
    if (vault.isLocked() || revision !== vault.getSessionRevision())
      throw new Error('Archive session changed');
    const selected = archiveRelays(settings);
    if (!selected.length) throw new Error('Select at least one relay');
    if (relay !== undefined && (!selected.includes(relay) || full))
      throw new Error('Invalid archive retry relay');
    const streams: ArchiveCheckpoint['stream'][] = settings.includeMessages
      ? ['authored', 'messages', 'legacyMessages']
      : ['authored'];
    const tasks = (relay ? [relay] : selected).flatMap((relay) =>
      streams.map((stream) => ({ relay, stream })),
    );
    const prior = relay
      ? ((await browser.storage.local.get(progressKey(id)))[progressKey(id)] as
          | { progress?: ArchiveProgress }
          | undefined)
      : undefined;
    const relayAdded = Object.fromEntries(
      (prior?.progress?.relayResults ?? []).flatMap((result) =>
        result.added === undefined ? [] : [[result.relay, result.added]],
      ),
    );
    const relayFetched = Object.fromEntries((prior?.progress?.relayResults ?? []).flatMap(result => result.fetched === undefined ? [] : [[result.relay, result.fetched]]));
    for (const task of tasks) { relayAdded[task.relay] = 0; relayFetched[task.relay] = 0; }
    const job: ArchiveSyncJob = {
      relayAdded,
      relayFetched,
      tasks,
      cursor: 0,
      initialized: false,
      full,
      startedAt: Date.now(),
      fetched: 0,
      errors: [],
    };
    await browser.storage.local.set({ [jobKey(id)]: job });
    await saveArchiveProgress(id, { phase: 'syncing', fetched: 0, startedAt: job.startedAt, relayResults: prior?.progress?.relayResults });
  } finally {
    releaseArchive(id);
  }
  void resumeArchiveSync(id);
}
/** One bounded worker slice; durable checkpoints and task cursor survive MV3 suspension. */
export async function resumeArchiveSync(id: string): Promise<void> {
  if (archiveBusy(id) || vault.isLocked()) return;
  const abort = new AbortController();
  const done = runSlice(id, abort.signal).finally(() => {
    running.delete(id);
    if (!abort.signal.aborted) void archiveControl.run(() => resumeArchiveRetries(id)).catch(() => {});
  });
  running.set(id, { abort, done });
  await done;
}
async function runSlice(id: string, signal: AbortSignal) {
  let progress: ArchiveProgress = { phase: 'syncing', fetched: 0 };
  try {
    const account = await archiveAccount(id);
    const settings = await getArchiveSettings(id);
    const saved = await browser.storage.local.get(jobKey(id));
    const job = saved[jobKey(id)] as ArchiveSyncJob | undefined;
    if (!job) return;
    const relayAdded = job.relayAdded ??= {};
    const relayFetched = job.relayFetched ??= {};
    const options = await archiveTransportOptions(id, signal);
    const deadline = Date.now() + ARCHIVE_WORK_SLICE_MS;
    const completed = new Set(job.completedTasks ?? Array.from({ length: job.cursor }, (_, index) => index));
    const initialized = new Set(job.initializedTasks ?? (job.initialized ? [job.cursor] : []));
    const active = new Set<string>();
    const writes = new AsyncLock();
    const persist = () => writes.run(async () => {
      job.cursor = job.tasks.findIndex((_, index) => !completed.has(index));
      if (job.cursor < 0) job.cursor = job.tasks.length;
      job.completedTasks = [...completed];
      job.initializedTasks = [...initialized];
      job.initialized = initialized.has(job.cursor);
      progress = { phase: 'syncing', fetched: job.fetched, startedAt: job.startedAt, activeRelays: [...active], relay: [...active][0] };
      await browser.storage.local.set({ [jobKey(id)]: job });
      await saveArchiveProgress(id, progress);
    });
    const runTask = async (index: number) => {
      signal.throwIfAborted();
      const task = job!.tasks[index];
      if (!archiveRelays(settings).includes(task.relay)) throw new Error('Archive relay selection changed');
      const previous = (await archiveSummary(id)).checkpoints.find(
        (cp) => cp.key === `${task.relay}|${task.stream}`,
      );
      let checkpoint = previous;
      const freshTask = !initialized.has(index);
      if (freshTask) {
        checkpoint = nextArchiveRange(previous, task.relay, task.stream, job.startedAt, job.full);
        await commitArchiveBatch(id, [], checkpoint, signal);
        initialized.add(index);
        await persist();
      }
      if (!checkpoint) throw new Error('Archive checkpoint is unavailable');
      await persist();
      if (freshTask && checkpoint.since === 0 && !checkpoint.complete) {
        let added = 0;
        let confirmedCount: number | undefined;
        const reconciled = await reconcileArchive(
          id,
          account.pubkey,
          task.relay,
          { ...streamFilter(account.pubkey, task.stream), since: checkpoint.since, until: checkpoint.until },
          settings.includeMessages,
          { ...options, onCount: count => { confirmedCount = count; }, onAdded: count => { added += count; } },
          Math.min(deadline, Date.now() + 8000),
        );
        const fetched = confirmedCount ?? added;
        job.fetched += fetched;
        relayFetched[task.relay] = (relayFetched[task.relay] ?? 0) + fetched;
        relayAdded[task.relay] = (relayAdded[task.relay] ?? 0) + added;
        if (reconciled) {
          checkpoint = {
            ...checkpoint,
            complete: true,
            nextUntil: undefined,
            checkedAt: checkpoint.until * 1000,
            fullCheckedAt: checkpoint.until * 1000,
            error: undefined,
          };
          await commitArchiveBatch(id, [], checkpoint, signal);
        }
        await persist();
        if (Date.now() >= deadline && !checkpoint.complete) return;
      }
      try {
        if (!checkpoint.complete)
          checkpoint = await syncArchivePage(
            checkpoint,
            streamFilter(account.pubkey, task.stream),
            {
              query: (filter) =>
                queryArchiveRelay(task.relay, filter, {
                  ...options,
                  timeoutMs: Math.max(100, Math.min(12_000, deadline - Date.now())),
                }),
              commit: async (events, next) => {
                try {
                  const records = events
                    .filter(
                      (event) =>
                        shouldArchive(event) && eventBelongs(event, account.pubkey, settings.includeMessages),
                    )
                    .map((event) => ({ event, sources: [task.relay], savedAt: Date.now() }));
                  // Only the final committed batch advances coverage. Earlier batches safely deduplicate after interruption.
                  for (let offset = 0; offset < records.length; offset += MAX_ARCHIVE_BATCH) {
                    const batch = records.slice(offset, offset + MAX_ARCHIVE_BATCH);
                    let added = 0;
                    await commitArchiveBatch(
                      id,
                      batch,
                      undefined,
                      signal,
                      count => { added = count; },
                    );
                    relayAdded[task.relay] =
                      (relayAdded[task.relay] ?? 0) +
                      added;
                    job.fetched += batch.length;
                    relayFetched[task.relay] = (relayFetched[task.relay] ?? 0) + batch.length;
                    await persist();
                  }
                  await commitArchiveBatch(id, [], next, signal);
                } catch (error) {
                  throw new ArchiveWriteError(
                    error instanceof Error ? error.message : 'Could not store archive events',
                  );
                }
              },
            },
            signal,
          );
        if (checkpoint.complete) {
          completed.add(index);
          initialized.delete(index);
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ArchiveWriteError) throw error;
        if (error instanceof DOMException && ['QuotaExceededError', 'AbortError'].includes(error.name))
          throw error;
        const message = error instanceof Error ? error.message : 'Relay sync failed';
        job.errors.push(`${task.relay}: ${message}`);
        await commitArchiveBatch(id, [], { ...checkpoint, error: message }, signal);
        completed.add(index);
        initialized.delete(index);
      }
      await persist();
    }
    const relays = [...new Set(job.tasks.filter((_, index) => !completed.has(index)).map(task => task.relay))];
    const outcomes = await Promise.allSettled(relays.map(async relay => {
      active.add(relay);
      try {
        for (let index = 0; index < job.tasks.length && Date.now() < deadline; index++) {
          if (job.tasks[index].relay !== relay) continue;
          while (!completed.has(index) && Date.now() < deadline) await runTask(index);
        }
      } finally {
        active.delete(relay);
        await persist();
      }
    }));
    const failure = outcomes.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    progress.fetched = job.fetched;
    if (job.cursor >= job.tasks.length) {
      await browser.storage.local.remove(jobKey(id));
      const relayResults = archiveRelayResults(
        archiveRelays(settings),
        settings.includeMessages,
        (await archiveSummary(id)).checkpoints,
      ).map((result) => ({ ...result, added: job.relayAdded?.[result.relay], fetched: job.relayFetched?.[result.relay] }));
      progress = {
        ...progress,
        phase: relayResults.some((result) => !result.success) ? 'partial' : 'complete',
        relayResults,
        error: undefined,
        finishedAt: Date.now(),
      };
    }
    await saveArchiveProgress(id, progress);
  } catch (error) {
    const cancelled = signal.aborted || vault.isLocked();
    if (!cancelled) await browser.storage.local.remove(jobKey(id));
    await saveArchiveProgress(id, {
      ...progress,
      phase: cancelled ? 'locked' : 'error',
      error: cancelled ? undefined : error instanceof Error ? error.message : 'Archive sync failed',
      finishedAt: Date.now(),
    });
  }
}

/** Continue unfinished work immediately; alarms recover after actual worker suspension. */
export async function resumeArchiveRetries(id: string): Promise<void> {
  if (archiveBusy(id) || vault.isLocked()) return;
  const stored = await browser.storage.local.get([jobKey(id), retryQueueKey(id)]);
  if (stored[jobKey(id)]) {
    void resumeArchiveSync(id);
    return;
  }
  const queue = (stored[retryQueueKey(id)] as string[] | undefined) ?? [];
  if (!queue.length) return;
  const selected = archiveRelays(await getArchiveSettings(id));
  const valid = queue.filter(relay => selected.includes(relay));
  if (valid.length) await startArchiveSync(id, false, valid[0]);
  await browser.storage.local.set({ [retryQueueKey(id)]: valid.slice(1) });
  await notifyArchive();
}
