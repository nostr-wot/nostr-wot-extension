import { ARCHIVE_WORK_SLICE_MS } from '@constants/archive.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { archiveRelayUrl } from '@domain/archive/settings.ts';
import type { ArchiveCopyResult } from '@domain/archive/types.ts';
import { canCopyRecord, readArchivePage } from './database.ts';
import { archiveAccount, saveArchiveProgress } from './state.ts';
import { archiveBusy, holdArchive, releaseArchive, pauseArchive } from './sync.ts';
import { archiveTransportOptions } from './authentication.ts';
import { queryArchiveRelay } from './query.ts';
import { publishRelay } from '../relays/transport.ts';

export const copyKey = (id: string) => `archiveCopy:${id}`;
interface CopyJob {
  relay: string;
  includeMessages: boolean;
  includeUnknown: boolean;
  after?: string;
  retrying?: boolean;
  result: ArchiveCopyResult;
  startedAt: number;
}
const running = new Map<string, { abort: AbortController; done: Promise<void> }>();
export async function verifyArchiveDestination(id: string, relay: unknown) {
  const destination = archiveRelayUrl(relay);
  const options = await archiveTransportOptions(id);
  // A normal bounded query verifies the protocol without publishing a test event.
  // Some relays never send EOSE for an artificial until: 0 filter.
  const result = await queryArchiveRelay(destination, { kinds: [0], limit: 1 }, { ...options, timeoutMs: 5000, limit: 1 });
  options.assertSession?.();
  if (result.status !== 'eose') throw new Error('Could not verify destination relay: ' + (result.message || result.status));
  return destination;
}
export async function previewArchiveCopy(id: string, includeMessages = false, includeUnknown = false, relay?: unknown) {
  if (relay !== undefined) await verifyArchiveDestination(id, relay);
  await archiveAccount(id);
  let after: string | undefined;
  let eligible = 0;
  let skipped = 0;
  do {
    const page = await readArchivePage(id, after);
    for (const record of page.records) {
      if (await canCopyRecord(id, record, includeMessages, includeUnknown)) eligible++;
      else skipped++;
    }
    after = page.next;
  } while (after);
  return { eligible, skipped };
}
export async function suspendArchiveCopy(id: string): Promise<void> {
  const active = running.get(id);
  active?.abort.abort();
  await active?.done;
}
export async function pauseArchiveCopy(id: string) {
  await suspendArchiveCopy(id);
  await browser.storage.local.remove(copyKey(id));
}
export function cancelArchiveCopies() {
  for (const active of running.values()) active.abort.abort();
}
export async function drainArchiveCopies(): Promise<void> {
  await Promise.allSettled([...running.values()].map((active) => active.done));
}
export async function startArchiveCopy(
  id: string,
  relay: unknown,
  includeMessages = false,
  includeUnknown = false,
) {
  await archiveAccount(id);
  const destination = archiveRelayUrl(relay);
  const revision = vault.getSessionRevision();
  const check = () => {
    if (vault.isLocked() || vault.getSessionRevision() !== revision)
      throw new Error('Archive session changed');
  };
  holdArchive(id);
  try {
    await verifyArchiveDestination(id, destination);
    await pauseArchive(id);
    check();
    const job: CopyJob = {
      relay: destination,
      includeMessages,
      includeUnknown,
      result: { accepted: 0, existing: 0, failed: 0, skipped: 0 },
      startedAt: Date.now(),
    };
    await browser.storage.local.set({ [copyKey(id)]: job });
    check();
    await saveArchiveProgress(id, { phase: 'copying', fetched: 0, startedAt: job.startedAt });
    check();
  } catch (error) {
    await browser.storage.local.remove(copyKey(id));
    throw error;
  } finally {
    releaseArchive(id);
  }
  void resumeArchiveCopy(id);
}
export async function resumeArchiveCopy(id: string) {
  if (running.has(id) || archiveBusy(id) || vault.isLocked()) return;
  holdArchive(id);
  const abort = new AbortController();
  const done = runSlice(id, abort.signal).finally(() => {
    running.delete(id);
    releaseArchive(id);
  });
  running.set(id, { abort, done });
  await done;
}
async function runSlice(id: string, signal: AbortSignal) {
  let job: CopyJob | undefined;
  try {
    await archiveAccount(id);
    job = (await browser.storage.local.get(copyKey(id)))[copyKey(id)] as CopyJob | undefined;
    if (!job) return;
    const options = await archiveTransportOptions(id, signal);
    const deadline = Date.now() + ARCHIVE_WORK_SLICE_MS;
    job.result.failures ??= [];
    let finished = false;
    while (!finished && Date.now() < deadline) {
      const page = await readArchivePage(id, job.after, 25);
      for (const record of page.records) {
        signal.throwIfAborted();
        options.assertSession?.();
        const failure = job.result.failures.find(item => item.id === record.event.id);
        if (job.retrying && !failure) {
          job.after = record.event.id;
          continue;
        }
        if (job.retrying && failure) {
          job.result.failed--;
          job.result.failures = job.result.failures.filter(item => item.id !== record.event.id);
        }
        if (!(await canCopyRecord(id, record, job.includeMessages, job.includeUnknown))) job.result.skipped++;
        else {
          const result = await publishRelay(job.relay, record.event, { ...options, timeoutMs: 10_000 });
          signal.throwIfAborted();
          options.assertSession?.();
          if (result.accepted) {
            if (result.message.startsWith('duplicate:')) job.result.existing++;
            else job.result.accepted++;
          } else {
            job.result.failed++;
            job.result.failures.push({ id: record.event.id, kind: record.event.kind, createdAt: record.event.created_at, message: result.message.slice(0, 512), attempts: job.retrying ? 2 : 1 });
          }
        }
        job.after = record.event.id;
        await browser.storage.local.set({ [copyKey(id)]: job });
        await saveArchiveProgress(id, { phase: 'copying', fetched: job.result.accepted + job.result.existing, startedAt: job.startedAt, relay: job.relay }, job.result);
        if (Date.now() >= deadline) break;
      }
      finished = !page.records.length || (!page.next && job.after === page.records.at(-1)?.event.id);
      if (finished && !job.retrying && job.result.failures.length) {
        job.retrying = true;
        job.after = undefined;
        finished = false;
        await browser.storage.local.set({ [copyKey(id)]: job });
      }
    }
    if (finished) await browser.storage.local.remove(copyKey(id));
    await saveArchiveProgress(
      id,
      {
        phase: finished ? (job.result.failed ? 'partial' : 'complete') : 'copying',
        fetched: job.result.accepted + job.result.existing,
        startedAt: job.startedAt,
        finishedAt: finished ? Date.now() : undefined,
        relay: job.relay,
      },
      job.result,
    );
  } catch (error) {
    job = (await browser.storage.local.get(copyKey(id)))[copyKey(id)] as CopyJob | undefined;
    if (!signal.aborted && !vault.isLocked()) await browser.storage.local.remove(copyKey(id));
    await saveArchiveProgress(
      id,
      {
        phase: signal.aborted || vault.isLocked() ? 'locked' : 'error',
        fetched: job?.result.accepted ?? 0,
        error: error instanceof Error ? error.message : 'Relay copy failed',
      },
      job?.result,
    );
  }
}
