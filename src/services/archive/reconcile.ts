import { matchesRelayFilter } from '@domain/relays/filter.ts';
import { MAX_RECONCILIATION_LOCAL_EVENTS, MAX_RECONCILIATION_MISSING_IDS } from '@constants/relays.ts';
import { ARCHIVE_RECONCILE_BUDGET_MS, MAX_ARCHIVE_BATCH } from '@constants/archive.ts';
import type { NostrFilter } from '../../domain/relays/types.ts';
import type { ArchiveRecord } from '../../domain/archive/types.ts';
import { eventBelongs, shouldArchive } from '../../domain/archive/policy.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import { reconcileRelay, type RelayTransportOptions } from '../relays/transport.ts';
import { queryArchiveRelay } from './query.ts';
import { readArchivePage, commitArchiveBatch } from './database.ts';

interface ReconciliationDependencies {
  read: typeof readArchivePage;
  reconcile: typeof reconcileRelay;
  query: typeof queryArchiveRelay;
  commit: typeof commitArchiveBatch;
}
const dependencies: ReconciliationDependencies = {
  read: readArchivePage,
  reconcile: reconcileRelay,
  query: queryArchiveRelay,
  commit: commitArchiveBatch,
};

/**
 * Optional NIP-77 acceleration for a fresh full range. False requires normal pagination.
 * Never advances a checkpoint: the caller may claim coverage only after true returns.
 */
export async function reconcileArchive(
  accountId: string,
  pubkey: string,
  relay: string,
  filter: NostrFilter,
  includeMessages: boolean,
  options: RelayTransportOptions & { onCount?: (count: number) => void; onAdded?: (count: number) => void },
  deadline = Date.now() + ARCHIVE_RECONCILE_BUDGET_MS,
  _dependencies: ReconciliationDependencies = dependencies,
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const budget = Math.min(ARCHIVE_RECONCILE_BUDGET_MS, Math.max(0, deadline - Date.now()));
  const end = Date.now() + budget;
  const timer = setTimeout(() => controller.abort(), budget);
  const check = () => {
    options.signal?.throwIfAborted();
    options.assertSession?.();
    return !controller.signal.aborted && Date.now() < end;
  };
  const transportOptions = (): RelayTransportOptions => ({
    ...options,
    signal: controller.signal,
    timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 5000, end - Date.now())),
  });
  try {
    if (!check() || filter.since !== 0 || filter.limit !== undefined) return false;
    const entries: Array<{ id: string; created_at: number }> = [];
    const localIds = new Set<string>();
    let after: string | undefined;
    let scanned = 0;
    do {
      if (!check()) return false;
      const page = await _dependencies.read(accountId, after, MAX_ARCHIVE_BATCH);
      if (!check()) return false;
      scanned += page.records.length;
      if (scanned > MAX_RECONCILIATION_LOCAL_EVENTS) return false;
      for (const { event } of page.records) {
        if (!check()) return false;
        if (
          !matchesRelayFilter(event, filter) ||
          !shouldArchive(event) ||
          !eventBelongs(event, pubkey, includeMessages)
        )
          continue;
        // Stored encrypted data is not a substitute for a valid signed inventory.
        if (!(await verifyEvent(event))) return false;
        if (!check()) return false;
        if (!localIds.has(event.id)) {
          localIds.add(event.id);
          entries.push({ id: event.id, created_at: event.created_at });
        }
      }
      if (page.next && (page.next === after || scanned >= MAX_RECONCILIATION_LOCAL_EVENTS)) return false;
      after = page.next;
    } while (after);
    if (!check()) return false;
    const reconciliation = await _dependencies.reconcile(relay, filter, entries, transportOptions());
    if (
      !check() ||
      reconciliation.status !== 'complete' ||
      reconciliation.missing.length > MAX_RECONCILIATION_MISSING_IDS
    )
      return false;
    if (reconciliation.missing.some((id) => !/^[0-9a-f]{64}$/.test(id))) return false;
    const missing = [...new Set(reconciliation.missing)].filter((id) => !localIds.has(id));
    for (let offset = 0; offset < missing.length; offset += MAX_ARCHIVE_BATCH) {
      if (!check()) return false;
      const ids = missing.slice(offset, offset + MAX_ARCHIVE_BATCH);
      const wanted = new Set(ids);
      const result = await _dependencies.query(
        relay,
        { ...filter, ids, limit: ids.length },
        { ...transportOptions(), limit: ids.length },
      );
      if (!check()) return false;
      const fetched = new Set<string>();
      const records: ArchiveRecord[] = [];
      let invalid = false;
      for (const event of result.events) {
        if (!check()) return false;
        if (!wanted.has(event.id) || !matchesRelayFilter(event, filter) || !(await verifyEvent(event))) {
          invalid = true;
          continue;
        }
        if (!check()) return false;
        if (fetched.has(event.id)) continue;
        fetched.add(event.id);
        if (shouldArchive(event) && eventBelongs(event, pubkey, includeMessages))
          records.push({ event, sources: [relay], savedAt: Date.now() });
      }
      // Preserve valid partial recovery, but never use it as complete range evidence.
      if (records.length) await _dependencies.commit(accountId, records, undefined, controller.signal, options.onAdded);
      if (!check() || invalid || result.status !== 'eose' || fetched.size !== wanted.size) return false;
    }
    if (!check()) return false;
    if (reconciliation.remoteCount !== undefined) options.onCount?.(reconciliation.remoteCount);
    return true;
  } catch (error) {
    options.signal?.throwIfAborted();
    options.assertSession?.();
    if (controller.signal.aborted || Date.now() >= end) return false;
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
