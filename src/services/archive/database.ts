import { isNewerReplaceable } from '@domain/nostr/eventOrdering.ts';
import * as kinds from 'nostr-tools/kinds';
import { bytesToHex } from '@lib/crypto/utils.ts';
import {
  ARCHIVE_DATABASE,
  MAX_ARCHIVE_BATCH,
  MAX_ARCHIVE_RECORD_BYTES,
  MAX_ARCHIVE_BYTES,
} from '@constants/archive.ts';
import type { ArchiveRecord, ArchiveCheckpoint } from '@domain/archive/types.ts';
import { canCopyEvent, replacementKey } from '@domain/archive/policy.ts';
import { sealPrivateValue, openPrivateValue } from '../storage/private-cache.ts';
import * as vault from '../vault/vault.ts';
import { AsyncLock } from '@utils/asyncLock.ts';

const mutex = new AsyncLock();
type Envelope = Awaited<ReturnType<typeof sealPrivateValue>>;
interface Row {
  accountId: string;
  id: string;
  bytes: number;
  value: Envelope;
}
interface Meta {
  accountId: string;
  count: number;
  bytes: number;
  checkpoints: ArchiveCheckpoint[];
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('records', { keyPath: ['accountId', 'id'] });
      request.result.createObjectStore('metadata', { keyPath: 'accountId' });
      request.result.createObjectStore('policy', { keyPath: ['accountId', 'id'] });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Archive transaction aborted'));
  });
}
function range(account: string, after?: string) {
  return IDBKeyRange.bound([account, after ?? ''], [account, '\uffff'], !!after, false);
}
function assertSession(revision: number, signal?: AbortSignal) {
  if (signal?.aborted || vault.isLocked() || revision !== vault.getSessionRevision())
    throw new Error('Archive operation cancelled or vault locked');
}
interface PolicyValue {
  id: string;
  created_at: number;
}
async function policyId(key: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))));
}
function policyKeys(record: ArchiveRecord): { key: string; value: PolicyValue }[] {
  const event = record.event;
  const value = { id: event.id, created_at: event.created_at };
  const replace = replacementKey(event);
  const result = replace ? [{ key: `replace:${replace}`, value }] : [];
  if (event.kind === kinds.EventDeletion)
    for (const tag of event.tags) {
      if (tag[0] === 'e' && /^[0-9a-f]{64}$/.test(tag[1] ?? ''))
        result.push({ key: `delete-e:${event.pubkey}:${tag[1]}`, value });
      if (tag[0] === 'a' && tag[1]?.split(':')[1] === event.pubkey)
        result.push({ key: `delete-a:${tag[1]}`, value });
    }
  return result;
}
const aad = (account: string, id: string) => `archive:${JSON.stringify([account, id])}`;
async function rows(account: string, after: string | undefined, limit: number): Promise<Row[]> {
  const db = await database();
  try {
    const tx = db.transaction('records');
    const done = completion(tx);
    const value = await request(tx.objectStore('records').getAll(range(account, after), limit));
    await done;
    return value;
  } finally {
    db.close();
  }
}
export async function archiveSummary(accountId: string): Promise<Omit<Meta, 'accountId'>> {
  const db = await database();
  try {
    const tx = db.transaction('metadata');
    const done = completion(tx);
    const result = (await request(tx.objectStore('metadata').get(accountId))) as Meta | undefined;
    await done;
    return { count: result?.count ?? 0, bytes: result?.bytes ?? 0, checkpoints: result?.checkpoints ?? [] };
  } finally {
    db.close();
  }
}
export async function readArchivePage(
  accountId: string,
  after?: string,
  limit = MAX_ARCHIVE_BATCH,
): Promise<{ records: ArchiveRecord[]; next?: string }> {
  const revision = vault.getSessionRevision();
  assertSession(revision);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ARCHIVE_BATCH)
    throw new Error('Invalid archive page size');
  const page = await rows(accountId, after, limit + 1);
  const selected = page.slice(0, limit);
  const records = await Promise.all(
    selected.map((row) => openPrivateValue<ArchiveRecord>(aad(accountId, row.id), row.value)),
  );
  assertSession(revision);
  return { records, ...(page.length > limit ? { next: selected.at(-1)!.id } : {}) };
}
export async function commitArchiveBatch(
  accountId: string,
  records: ArchiveRecord[],
  checkpoint?: ArchiveCheckpoint,
  signal?: AbortSignal,
  onAdded?: (count: number) => void,
): Promise<void> {
  const revision = vault.getSessionRevision();
  if (records.length > MAX_ARCHIVE_BATCH) throw new Error('Archive batch too large');
  await mutex.run(async () => {
    assertSession(revision, signal);
    const db = await database();
    try {
      const prepared: Row[] = [];
      const unique = new Map<string, ArchiveRecord>();
      for (const record of records) {
        if (!/^[0-9a-f]{64}$/.test(record.event.id)) throw new Error('Invalid archive event ID');
        const prior = unique.get(record.event.id);
        unique.set(record.event.id, {
          ...record,
          sources: [...new Set([...(prior?.sources ?? []), ...record.sources])],
        });
      }
      const updates = new Map<string, PolicyValue>();
      for (const record of unique.values())
        for (const { key, value } of policyKeys(record)) {
          const id = await policyId(key);
          const old = updates.get(id);
          if (!old || isNewerReplaceable(value, old)) updates.set(id, value);
        }
      const read = db.transaction(['records', 'metadata', 'policy']);
      const readDone = completion(read);
      const [oldRows, oldPolicies] = await Promise.all([
        Promise.all(
          [...unique.keys()].map(
            (id) => request(read.objectStore('records').get([accountId, id])) as Promise<Row | undefined>,
          ),
        ),
        Promise.all(
          [...updates.keys()].map(
            (id) => request(read.objectStore('policy').get([accountId, id])) as Promise<Row | undefined>,
          ),
        ),
      ]);
      await readDone;
      let addedBytes = 0,
        addedCount = 0;
      for (const [index, record] of [...unique.values()].entries()) {
        const oldRow = oldRows[index];
        const old = oldRow
          ? await openPrivateValue<ArchiveRecord>(aad(accountId, oldRow.id), oldRow.value)
          : undefined;
        const merged = {
          ...record,
          savedAt: old?.savedAt ?? record.savedAt,
          sources: [...new Set([...(old?.sources ?? []), ...record.sources])].sort(),
        };
        if (old && merged.sources.length === old.sources.length) continue;
        const bytes = new TextEncoder().encode(JSON.stringify(merged)).length;
        if (bytes > MAX_ARCHIVE_RECORD_BYTES) throw new Error('Archive event too large');
        prepared.push({
          accountId,
          id: record.event.id,
          bytes,
          value: await sealPrivateValue(aad(accountId, record.event.id), merged),
        });
        addedBytes += bytes - (oldRow?.bytes ?? 0);
        if (!oldRow) addedCount++;
      }
      const policyRows: { accountId: string; id: string; value: Envelope }[] = [];
      for (const [index, [id, candidate]] of [...updates.entries()].entries()) {
        const oldRow = oldPolicies[index];
        const old = oldRow
          ? await openPrivateValue<PolicyValue>(aad(accountId, `policy:${id}`), oldRow.value)
          : undefined;
        const value = old && isNewerReplaceable(old, candidate) ? old : candidate;
        policyRows.push({
          accountId,
          id,
          value: await sealPrivateValue(aad(accountId, `policy:${id}`), value),
        });
      }
      assertSession(revision, signal);
      const tx = db.transaction(['records', 'metadata', 'policy'], 'readwrite');
      const done = completion(tx);
      const abort = () => {
        try {
          tx.abort();
        } catch {
          /* already complete */
        }
      };
      const off = vault.onLock(abort);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const metaStore = tx.objectStore('metadata');
        const meta = ((await request(metaStore.get(accountId))) as Meta | undefined) ?? {
          accountId,
          count: 0,
          bytes: 0,
          checkpoints: [],
        };
        assertSession(revision, signal);
        if (meta.bytes + addedBytes > MAX_ARCHIVE_BYTES) throw new Error('Archive storage limit reached');
        for (const row of prepared) tx.objectStore('records').put(row);
        for (const row of policyRows) tx.objectStore('policy').put(row);
        const checkpoints = checkpoint
          ? [...meta.checkpoints.filter((c) => c.key !== checkpoint.key), checkpoint]
          : meta.checkpoints;
        metaStore.put({
          accountId,
          count: meta.count + addedCount,
          bytes: meta.bytes + addedBytes,
          checkpoints,
        });
        await done;
        onAdded?.(addedCount);
      } catch (error) {
        abort();
        await done.catch(() => {});
        throw error;
      } finally {
        off();
        signal?.removeEventListener('abort', abort);
      }
    } finally {
      db.close();
    }
  });
}
export async function clearArchive(accountId: string): Promise<void> {
  await mutex.run(async () => {
    const db = await database();
    try {
      const tx = db.transaction(['records', 'metadata', 'policy'], 'readwrite');
      const done = completion(tx);
      tx.objectStore('records').delete(range(accountId));
      tx.objectStore('policy').delete(range(accountId));
      tx.objectStore('metadata').delete(accountId);
      await done;
    } finally {
      db.close();
    }
  });
}
export async function clearAllArchives(): Promise<void> {
  await mutex.run(async () => {
    const db = await database();
    try {
      const tx = db.transaction(['records', 'metadata', 'policy'], 'readwrite');
      const done = completion(tx);
      tx.objectStore('records').clear();
      tx.objectStore('policy').clear();
      tx.objectStore('metadata').clear();
      await done;
    } finally {
      db.close();
    }
  });
}
/** Bounded encrypted index lookup; deletion coordinates include the signed author. */
export async function canCopyRecord(
  accountId: string,
  record: ArchiveRecord,
  includeMessages = false,
  includeUnknown = false,
): Promise<boolean> {
  if (!canCopyEvent(record.event, includeMessages, includeUnknown)) return false;
  const revision = vault.getSessionRevision();
  assertSession(revision);
  const event = record.event;
  const replace = replacementKey(event);
  const keys = [
    `delete-e:${event.pubkey}:${event.id}`,
    ...(replace ? [`delete-a:${replace}`, `replace:${replace}`] : []),
  ];
  const ids = await Promise.all(keys.map(policyId));
  const db = await database();
  try {
    const tx = db.transaction('policy');
    const done = completion(tx);
    const values = await Promise.all(
      ids.map((id) => request(tx.objectStore('policy').get([accountId, id])) as Promise<Row | undefined>),
    );
    await done;
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (!row) continue;
      const value = await openPrivateValue<PolicyValue>(aad(accountId, `policy:${row.id}`), row.value);
      if (keys[i].startsWith('replace:')) {
        if (value.id !== event.id) return false;
      } else if (keys[i].startsWith('delete-e:') || value.created_at >= event.created_at) return false;
    }
    assertSession(revision);
    return true;
  } finally {
    db.close();
  }
}
