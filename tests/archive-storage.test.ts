import { ARCHIVE_DATABASE } from '../src/constants/archive.ts';
import 'fake-indexeddb/auto';
import { beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { commitArchiveBatch, readArchivePage, archiveSummary, clearArchive, clearAllArchives, canCopyRecord } from '../src/services/archive/database.ts';
import type { ArchiveRecord } from '../src/domain/archive/types.ts';
const pubkey = 'a'.repeat(64);
const record = (id: string, kind = 1, tags: string[][] = [], created_at = 10): ArchiveRecord => ({ event: { id: id.repeat(64), pubkey, sig: 'a'.repeat(128), kind, tags, created_at, content: 'private test content' }, sources: ['wss://one.example'], savedAt: 1 });
beforeEach(async () => { vault.lock(); resetMockStorage(); await vault.create('password123', { accounts: [], activeAccountId: null } as never); await clearAllArchives(); });
after(() => vault.lock());
it('deduplicates sources, pages accounts and commits checkpoint with byte counts', async () => {
  const one = record('1');
  await commitArchiveBatch('a', [one, record('2')], { key: 'one', relay: 'wss://one.example', stream: 'authored', since: 0, until: 10, complete: true, checkedAt: 1 });
  await commitArchiveBatch('a', [{ ...one, sources: ['wss://two.example'] }]);
  await commitArchiveBatch('b', [record('3')]);
  const first = await readArchivePage('a', undefined, 1); assert.equal(first.records.length, 1); assert.equal(first.next, one.event.id);
  assert.deepEqual(first.records[0].sources, ['wss://one.example', 'wss://two.example']);
  assert.equal((await readArchivePage('a', first.next, 1)).next, undefined);
  const summary = await archiveSummary('a'); assert.equal(summary.count, 2); assert.ok(summary.bytes > 0); assert.equal(summary.checkpoints.length, 1);
  await clearArchive('a'); assert.equal((await archiveSummary('a')).count, 0); assert.equal((await archiveSummary('b')).count, 1);
});
it('stores encrypted events and refuses swapped authenticated account IDs', async () => {
  await commitArchiveBatch('a', [record('1')]);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(ARCHIVE_DATABASE); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const row = await new Promise<any>(resolve => { const r = db.transaction('records').objectStore('records').get(['a', '1'.repeat(64)]); r.onsuccess = () => resolve(r.result); });
  assert.equal(JSON.stringify(row).includes('private test content'), false);
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put({ ...row, accountId: 'b' }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
  await assert.rejects(readArchivePage('b'));
});
it('aborted and locked batches cannot advance records or checkpoints', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(commitArchiveBatch('a', [record('1')], undefined, controller.signal));
  assert.equal((await archiveSummary('a')).count, 0);
  vault.lock(); await assert.rejects(commitArchiveBatch('a', [record('2')])); await assert.rejects(readArchivePage('a'));
});
it('encrypted policy index filters replacements, legitimate deletions and account boundaries', async () => {
  const old = record('1', 30023, [['d', 'article']], 10); const newer = record('2', 30023, [['d', 'article']], 20);
  const unrelated = record('3', 30023, [['d', 'other']], 30);
  await commitArchiveBatch('a', [old, newer, unrelated]);
  assert.equal(await canCopyRecord('a', old), false); assert.equal(await canCopyRecord('a', newer), true); assert.equal(await canCopyRecord('a', unrelated), true);
  const forged = record('4', 5, [['e', newer.event.id]], 30); forged.event.pubkey = 'f'.repeat(64);
  await commitArchiveBatch('a', [forged]); assert.equal(await canCopyRecord('a', newer), true);
  await commitArchiveBatch('a', [record('5', 5, [['a', `30023:${pubkey}:article`]], 30)]);
  assert.equal(await canCopyRecord('a', newer), false); assert.equal(await canCopyRecord('b', newer), true);
  await commitArchiveBatch('a', [record('6', 30023, [['d', 'article']], 40)]); assert.equal(await canCopyRecord('a', record('6', 30023, [['d', 'article']], 40)), true);
});
it('a transaction failure rolls back events, indexes and checkpoint together', async () => {
  const { IDBObjectStore } = await import('fake-indexeddb');
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === 'metadata') throw new DOMException('simulated quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    await assert.rejects(commitArchiveBatch('a', [record('1', 0)], { key: 'x', relay: 'wss://one.example', stream: 'authored', since: 0, until: 1, complete: true, checkedAt: 1 }), /quota/);
  } finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await archiveSummary('a'), { count: 0, bytes: 0, checkpoints: [] });
  assert.deepEqual((await readArchivePage('a')).records, []);
  assert.equal(await canCopyRecord('a', record('2', 0)), true);
});
it('vault lock during transaction aborts durable writes', async () => {
  const { IDBObjectStore } = await import('fake-indexeddb');
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    const result = original.apply(this, args);
    if (this.name === 'metadata') vault.lock();
    return result;
  };
  try { await assert.rejects(commitArchiveBatch('a', [record('1')])); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal((await archiveSummary('a')).count, 0);
});

it('copy indexes retain deterministic ties and deletion cutoffs across batches', async () => {
  const first = record('2', 30023, [['d', 'article']], 20);
  const winner = record('1', 30023, [['d', 'article']], 20);
  await commitArchiveBatch('a', [first]);
  await commitArchiveBatch('a', [winner]);
  await commitArchiveBatch('a', [first]);
  assert.equal(await canCopyRecord('a', first), false);
  assert.equal(await canCopyRecord('a', winner), true);
  await commitArchiveBatch('a', [record('3', 5, [['a', `30023:${pubkey}:article`]], 19)]);
  assert.equal(await canCopyRecord('a', winner), true);
  await commitArchiveBatch('a', [record('4', 5, [['e', winner.event.id]], 19)]);
  assert.equal(await canCopyRecord('a', winner), false);
});

it('parallel relay commits share one record and report only their own additions', async () => {
  const event = record('1');
  const added: number[] = [];
  await Promise.all(['wss://a.test/', 'wss://b.test/'].map(source => commitArchiveBatch('a', [{ ...event, sources: [source] }], undefined, undefined, count => { added.push(count); })));
  assert.deepEqual(added.sort(), [0, 1]);
  assert.equal((await archiveSummary('a')).count, 1);
  assert.deepEqual((await readArchivePage('a')).records[0].sources, ['wss://a.test/', 'wss://b.test/']);
});
it('repeated events from the same relay do not rewrite encrypted records', async () => {
  const event = record('1');
  await commitArchiveBatch('a', [event]);
  const { IDBObjectStore } = await import('fake-indexeddb');
  const original = IDBObjectStore.prototype.put;
  let writes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (this.name === 'records') writes++; return original.apply(this, args); };
  try { await commitArchiveBatch('a', [{ ...event, savedAt: 2 }]); } finally { IDBObjectStore.prototype.put = original; }
  assert.equal(writes, 0);
  assert.equal((await readArchivePage('a')).records[0].savedAt, 1);
});

it('stores source IDs with an encrypted per-account dictionary and resolves duplicate sources', async () => {
  const { openPrivateValue } = await import('../src/services/storage/private-cache.ts');
  await commitArchiveBatch('a', [record('1'), record('2')]);
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(ARCHIVE_DATABASE); request.onsuccess = () => resolve(request.result); });
  const read = (store: string, key: IDBValidKey) => new Promise<any>(resolve => { const request = db.transaction(store).objectStore(store).get(key); request.onsuccess = () => resolve(request.result); });
  const row = await read('records', ['a', '1'.repeat(64)]);
  const dictionary = await read('relays', 'a');
  assert.equal(JSON.stringify(dictionary).includes('wss://'), false);
  assert.deepEqual(await openPrivateValue('archive:["a","relays"]', dictionary.value), ['wss://one.example']);
  const decoded = await openPrivateValue<any>(`archive:${JSON.stringify(['a', '1'.repeat(64)])}`, row.value);
  assert.deepEqual(decoded.sourceIds, [0]); assert.equal(decoded.sources, undefined);
  db.close();
});
it('selected local deletion is account-scoped, idempotent and retains migration safety indexes', async () => {
  const { deleteArchiveRecords, readArchiveRecord } = await import('../src/services/archive/database.ts');
  const old = record('1', 0, [], 10), latest = record('2', 0, [], 20);
  await commitArchiveBatch('a', [old, latest]); await commitArchiveBatch('b', [latest]);
  const before = await archiveSummary('a');
  assert.equal(await deleteArchiveRecords('a', [latest.event.id, latest.event.id]), 1);
  assert.equal((await archiveSummary('a')).count, 1); assert.ok((await archiveSummary('a')).bytes < before.bytes);
  assert.equal(await canCopyRecord('a', old), false);
  assert.equal((await readArchiveRecord('b', latest.event.id)).event.id, latest.event.id);
  await assert.rejects(readArchiveRecord('a', latest.event.id));
  assert.equal(await deleteArchiveRecords('a', [latest.event.id]), 0);
  await assert.rejects(deleteArchiveRecords('a', ['bad']));
  await assert.rejects(deleteArchiveRecords('a', Array(101).fill(old.event.id)));
  vault.lock(); await assert.rejects(deleteArchiveRecords('a', [old.event.id]));
});
it('legacy records retain provenance and compact on their next commit', async () => {
  const { sealPrivateValue } = await import('../src/services/storage/private-cache.ts');
  const event = record('1');
  await commitArchiveBatch('a', [event]);
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open(ARCHIVE_DATABASE); request.onsuccess = () => resolve(request.result); });
  const value = await sealPrivateValue(`archive:${JSON.stringify(['a', event.event.id])}`, event);
  await new Promise<void>(resolve => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put({ accountId: 'a', id: event.event.id, bytes: JSON.stringify(event).length, value }); tx.oncomplete = () => resolve(); });
  db.close();
  assert.deepEqual((await readArchivePage('a')).records[0], event);
  await commitArchiveBatch('a', [{ ...event, sources: ['wss://two.example'] }]);
  assert.deepEqual((await readArchivePage('a')).records[0].sources, ['wss://one.example', 'wss://two.example']);
});

it('storage excludes app data and auth even if a caller bypasses sync filtering', async () => {
  await commitArchiveBatch('a', [record('1', 30078), record('2', 22242), record('3', 27235), record('4')]);
  assert.equal((await archiveSummary('a')).count, 1);
  assert.deepEqual((await readArchivePage('a')).records.map(record => record.event.kind), [1]);
});
