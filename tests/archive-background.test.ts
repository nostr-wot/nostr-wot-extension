import { DEFAULT_ARCHIVE_SETTINGS, ARCHIVE_ALARM, ARCHIVE_SETTINGS_PREFIX } from '../src/constants/archive.ts';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage, hasAlarm } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { importNsec } from '../src/domain/accounts/creation.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';
import { handlers } from '../src/services/background/archive-handlers.ts';
import { buildPrivilegedMethods } from '../src/services/background/state.ts';

import { archiveBusy, resumeArchiveSync, resumeArchiveRetries, cancelArchiveOperations } from '../src/services/archive/sync.ts';
import { copyKey, cancelArchiveCopies, resumeArchiveCopy, suspendArchiveCopy } from '../src/services/archive/copy.ts';
import { installArchiveAutoSync } from '../src/services/archive/automatic.ts';
import { clearAllArchives, archiveSummary, commitArchiveBatch, readArchivePage } from '../src/services/archive/database.ts';
import { cancelArchiveFiles } from '../src/services/archive/files.ts';
import { progressKey, retryQueueKey, jobKey } from '../src/services/archive/state.ts';

const originalWebSocket = globalThis.WebSocket;
let requests: unknown[][] = [], published: SignedEvent[] = [], events: SignedEvent[] = [];
let queriedRelays: string[] = [];
let rejectPublish: (event: SignedEvent, attempt: number) => string | undefined = () => undefined;
let mode: 'eose' | 'closed' | 'silent' | 'auth' = 'eose';
const sockets = new Set<Socket>();
let heldRelay: string | undefined;
let releaseQueries: Array<() => void> = [];
class Socket {
  readyState = 0;
  authenticated = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(readonly url: string) { sockets.add(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); }); }
  emit(value: unknown[]) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(raw: string) {
    const frame = JSON.parse(raw); requests.push(frame); if (frame[0] === 'REQ') queriedRelays.push(this.url);
    if (frame[0] === 'NEG-OPEN') queueMicrotask(() => this.emit(mode === 'auth' ? ['AUTH', 'archive-challenge'] : ['NEG-ERR', frame[1], 'unsupported']));
    if (frame[0] === 'REQ') { const respond = () => {
      if (mode === 'silent') return;
      if (mode === 'auth' && !this.authenticated) { this.emit(['AUTH', 'archive-challenge']); this.emit(['EOSE', frame[1]]); return; }
      for (const event of (frame[2].until === 0 ? [] : events)) this.emit(['EVENT', frame[1], event]);
      this.emit(mode === 'eose' || mode === 'auth' ? ['EOSE', frame[1]] : ['CLOSED', frame[1], 'restricted: unavailable']);
    }; if (this.url === heldRelay) releaseQueries.push(respond); else queueMicrotask(respond); }
    if (frame[0] === 'AUTH') { this.authenticated = true; queueMicrotask(() => this.emit(['OK', frame[1].id, true, ''])); }
    if (frame[0] === 'EVENT') { published.push(frame[1]); const reason = rejectPublish(frame[1], published.filter(event => event.id === frame[1].id).length); if (mode !== 'silent') queueMicrotask(() => this.emit(['OK', frame[1].id, !reason, reason || 'saved'])); }
  }
  close() { this.readyState = 3; sockets.delete(this); this.onclose?.({ reason: 'test close' }); }
}
let accountId: string, pubkey: string, relay: string;
let scheduler: ReturnType<typeof installArchiveAutoSync> | undefined;
async function call(method: string, params: Record<string, unknown> = {}) { const fn = handlers.get(method); assert.ok(fn); return fn({ accountId, ...params }) as Promise<any>; }
async function until(predicate: () => boolean | Promise<boolean>) { for (let i = 0; i < 4000; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Archive integration operation did not settle'); }
const settings = (automatic = false) => ({ ...DEFAULT_ARCHIVE_SETTINGS, automatic, includeMessages: false, groups: [{ id: 'test', name: 'Test', relays: [relay] }], selectedGroupId: 'test' });
beforeEach(async () => {
  scheduler?.stop(); scheduler = undefined; cancelArchiveOperations(); cancelArchiveCopies(); await cancelArchiveFiles();
  vault.lock(); resetMockStorage(); await clearAllArchives(); requests = []; queriedRelays = []; published = []; events = []; mode = 'eose'; rejectPublish = () => undefined; heldRelay = undefined; releaseQueries = [];
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const account = await importNsec('09'.repeat(32), 'Archive integration'); accountId = account.id; pubkey = account.pubkey; relay = `wss://archive-${crypto.randomUUID()}.test/`;
  await vault.create('integration-password', { accounts: [account], activeAccountId: account.id });
  await browser.storage.local.set({ accounts: [{ id: account.id, pubkey: account.pubkey, name: account.name, type: account.type, readOnly: account.readOnly }], activeAccountId: account.id, [ARCHIVE_SETTINGS_PREFIX + accountId]: settings() });
});
afterEach(async () => { scheduler?.stop(); scheduler = undefined; cancelArchiveOperations(); cancelArchiveCopies(); await cancelArchiveFiles(); vault.lock(); for (const socket of [...sockets]) socket.close(); globalThis.WebSocket = originalWebSocket; });
async function signed(kind = 1, content = 'archived') { return signEvent({ kind, content, created_at: 10, tags: [] }, new Uint8Array(32).fill(9)); }
function savedJob() { return { tasks: [{ relay, stream: 'authored' }], cursor: 0, initialized: false, full: false, startedAt: Date.now(), fetched: 0, errors: [] }; }

it('archive RPCs are privileged; lock permits metadata but prevents decrypted export', async () => {
  const privileged = buildPrivilegedMethods(handlers);
  for (const method of ['archive_getState', 'archive_sync', 'archive_clear', 'archive_copy', 'archive_exportBegin', 'archive_importChunk']) assert.ok(privileged.has(method));
  assert.equal((await call('archive_getState')).pubkey, pubkey);
  vault.lock(); const locked = await call('archive_getState'); assert.equal(locked.progress.phase, 'locked'); assert.equal('records' in locked, false); await assert.rejects(call('archive_exportBegin', { password: 'valid-password' }), /locked/);
  assert.equal(requests.length, 0);
});
it('a durable sync job resumes signed events and completes its checkpoint', async () => {
  events = [await signed()]; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  await resumeArchiveSync(accountId);
  const summary = await archiveSummary(accountId); assert.equal(summary.count, 1); assert.equal(summary.checkpoints[0].complete, true);
  assert.equal((await browser.storage.local.get(jobKey(accountId)))[jobKey(accountId)], undefined);
  assert.equal((await call('archive_getState')).progress.phase, 'complete');
});
it('closed relay retains useful signed events but never advances completed coverage', async () => {
  events = [await signed()]; mode = 'closed'; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  await resumeArchiveSync(accountId);
  const summary = await archiveSummary(accountId); assert.equal(summary.count, 1); assert.equal(summary.checkpoints[0].complete, false); assert.equal(summary.checkpoints[0].checkedAt, 0);
  assert.equal((await call('archive_getState')).progress.phase, 'partial');
});
it('a failed event transaction leaves resumable coverage incomplete', async () => {
  const { IDBObjectStore } = await import('fake-indexeddb'); const original = IDBObjectStore.prototype.put;
  events = [await signed()]; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (this.name === 'records') throw new DOMException('Quota exhausted', 'QuotaExceededError'); return original.apply(this, args); };
  try { await resumeArchiveSync(accountId); } finally { IDBObjectStore.prototype.put = original; }
  const summary = await archiveSummary(accountId); assert.equal(summary.count, 0); assert.equal(summary.checkpoints[0].complete, false);
  assert.equal((await call('archive_getState')).progress.phase, 'error');
});
it('scheduler leaves locked vaults offline and resumes persisted jobs after unlock', async () => {
  events = [await signed()]; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() }); vault.lock();
  scheduler = installArchiveAutoSync(); assert.ok(hasAlarm(ARCHIVE_ALARM)); await scheduler.tick(); assert.equal(requests.length, 0);
  await vault.unlock('integration-password'); await until(async () => (await archiveSummary(accountId)).count === 1 && !archiveBusy(accountId));
  assert.equal((await call('archive_getState')).progress.phase, 'complete');
});
it('scheduler respects explicit pause and interval instead of silently restarting', async () => {
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: settings(true), [progressKey(accountId)]: { progress: { phase: 'paused', fetched: 0 } } });
  scheduler = installArchiveAutoSync(); await scheduler.tick(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(requests.length, 0);
  await browser.storage.local.set({ [progressKey(accountId)]: { progress: { phase: 'complete', fetched: 0, finishedAt: Date.now() } } });
  await scheduler.tick(); assert.equal(requests.length, 0);
});
it('copy resumes its durable cursor and excludes private/unknown records by default', async () => {
  const publicEvent = await signed(); const privateEvent = await signed(4, 'ciphertext'); const unknown = await signed(9999);
  await commitArchiveBatch(accountId, [publicEvent, privateEvent, unknown].map(event => ({ event, sources: [relay], savedAt: 1 })));
  const preview = await call('archive_copyPreview'); assert.deepEqual(preview, { eligible: 1, skipped: 2 });
  await browser.storage.local.set({ [copyKey(accountId)]: { relay, includeMessages: false, includeUnknown: false, result: { accepted: 0, existing: 0, failed: 0, skipped: 0 }, startedAt: Date.now() } });
  await resumeArchiveCopy(accountId); assert.deepEqual(published.map(event => event.id), [publicEvent.id]);
  const state = await call('archive_getState'); assert.equal(state.copyResult.accepted, 1); assert.equal(state.copyResult.skipped, 2);
});
it('lock interrupts an active network sync without claiming checkpoint success', async () => {
  mode = 'silent'; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  scheduler = installArchiveAutoSync(); await until(() => requests.some(frame => frame[0] === 'REQ'));
  vault.lock(); await until(() => !archiveBusy(accountId));
  assert.equal((await archiveSummary(accountId)).checkpoints[0].complete, false);
  assert.equal((await browser.storage.local.get(progressKey(accountId)))[progressKey(accountId)].progress.phase, 'locked');
});
it('stopping scheduler during a storage read cannot start a later automatic network job', async () => {
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: settings(true) });
  const original = browser.storage.local.get;
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  browser.storage.local.get = async (...args) => {
    const result = await original(...args);
    if (Array.isArray(args[0]) && args[0].includes(jobKey(accountId))) { entered(); await gate; }
    return result;
  };
  try {
    scheduler = installArchiveAutoSync(); await reading; scheduler.stop(); release();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(requests.length, 0); assert.equal((await original(jobKey(accountId)))[jobKey(accountId)], undefined);
  } finally { release(); browser.storage.local.get = original; }
});
it('automatic sync includes watch-only identities stored outside the encrypted vault', async () => {
  const watchId = 'watch-only-local'; events = [await signed()];
  await browser.storage.local.set({ accounts: [{ id: watchId, pubkey, name: 'Watch', type: 'npub', readOnly: true }], [ARCHIVE_SETTINGS_PREFIX + watchId]: settings(true) });
  scheduler = installArchiveAutoSync();
  await until(async () => (await archiveSummary(watchId)).count === 1 && !archiveBusy(watchId));
  assert.equal((await call('archive_getState', { accountId: watchId })).progress.phase, 'complete');
  assert.ok(requests.some(frame => frame[0] === 'REQ'));
});
it('vault destruction drains cancelled jobs before purging archive metadata and records', async () => {
  mode = 'silent'; await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  scheduler = installArchiveAutoSync(); await until(() => requests.some(frame => frame[0] === 'REQ'));
  await vault.destroy(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await archiveSummary(accountId)).count, 0);
  assert.deepEqual(Object.keys(await browser.storage.local.get(null)).filter(key => key.startsWith('archive')), []);
  assert.equal(archiveBusy(accountId), false);
});
it('file suspension preserves the durable copy cursor for later retry', async () => {
  const event = await signed(); await commitArchiveBatch(accountId, [{ event, sources: [relay], savedAt: 1 }]);
  await browser.storage.local.set({ [copyKey(accountId)]: { relay, includeMessages: false, includeUnknown: false, result: { accepted: 0, existing: 0, failed: 0, skipped: 0 }, startedAt: Date.now() } });
  mode = 'silent'; const running = resumeArchiveCopy(accountId); await until(() => published.length === 1);
  await suspendArchiveCopy(accountId); await running;
  const saved = (await browser.storage.local.get(copyKey(accountId)))[copyKey(accountId)]; assert.ok(saved); assert.equal(saved.after, undefined);
  mode = 'eose'; await resumeArchiveCopy(accountId);
  assert.equal(published.length, 2); assert.equal((await call('archive_getState')).copyResult.accepted, 1);
});

async function finishExport(sessionId: string): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 0; i < 100; i++) {
    const page = await call('archive_exportPage', { sessionId }); lines.push(page.line);
    if (page.done) return lines;
  }
  throw new Error('Test export did not finish');
}
it('successful export restores automatic state and preserves the durable job for resumption', async () => {
  const prior = { phase: 'syncing', fetched: 7, startedAt: Date.now() - 1000 };
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: settings(true), [progressKey(accountId)]: { progress: prior }, [jobKey(accountId)]: savedJob() });
  const transfer = await call('archive_exportBegin', { password: 'file-test-password' });
  assert.equal(archiveBusy(accountId), true); await finishExport(transfer.sessionId);
  assert.deepEqual(Object.fromEntries(Object.entries((await call('archive_getState')).progress).filter(([key]) => key !== 'relayResults')), prior);
  assert.equal((await call('archive_getState')).settings.automatic, true);
  assert.ok((await browser.storage.local.get(jobKey(accountId)))[jobKey(accountId)]);
  assert.equal(archiveBusy(accountId), false);
  events = [await signed()]; scheduler = installArchiveAutoSync();
  await until(async () => (await archiveSummary(accountId)).count === 1 && !archiveBusy(accountId));
  assert.equal((await call('archive_getState')).progress.phase, 'complete');
});
it('failed import restores prior automatic state and leaves an explicit pause intact', async () => {
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: settings(true) });
  for (const phase of ['complete', 'paused']) {
    const prior = { phase, fetched: 12, finishedAt: Date.now() };
    await browser.storage.local.set({ [progressKey(accountId)]: { progress: prior } });
    const transfer = await call('archive_importBegin', { password: 'file-test-password' });
    await assert.rejects(call('archive_importChunk', { sessionId: transfer.sessionId, line: 'not an archive' }), /Invalid archive/);
    assert.deepEqual(Object.fromEntries(Object.entries((await call('archive_getState')).progress).filter(([key]) => key !== 'relayResults')), prior);
    assert.equal(archiveBusy(accountId), false);
    const exported = await call('archive_exportBegin', { password: 'file-test-password' });
    await finishExport(exported.sessionId);
    assert.deepEqual(Object.fromEntries(Object.entries((await call('archive_getState')).progress).filter(([key]) => key !== 'relayResults')), prior);
  }
});
it('successful import restores prior progress instead of permanently pausing automatic sync', async () => {
  const prior = { phase: 'complete', fetched: 3, finishedAt: Date.now() };
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: settings(true), [progressKey(accountId)]: { progress: prior } });
  const exported = await call('archive_exportBegin', { password: 'file-test-password' });
  const lines = await finishExport(exported.sessionId);
  const imported = await call('archive_importBegin', { password: 'file-test-password' });
  for (const line of lines) await call('archive_importChunk', { sessionId: imported.sessionId, line });
  assert.deepEqual(await call('archive_importFinish', { sessionId: imported.sessionId }), { count: 0 });
  assert.deepEqual(Object.fromEntries(Object.entries((await call('archive_getState')).progress).filter(([key]) => key !== 'relayResults')), prior);
  assert.equal((await call('archive_getState')).settings.automatic, true); assert.equal(archiveBusy(accountId), false);
});
it('explicit pause invalidates an export and late pages cannot undo the pause', async () => {
  await browser.storage.local.set({ [progressKey(accountId)]: { progress: { phase: 'complete', fetched: 3, finishedAt: Date.now() } } });
  const transfer = await call('archive_exportBegin', { password: 'file-test-password' });
  await call('archive_pause');
  await assert.rejects(call('archive_exportPage', { sessionId: transfer.sessionId }), /expired|locked/);
  await call('archive_fileCancel', { sessionId: transfer.sessionId });
  assert.equal((await call('archive_getState')).progress.phase, 'paused'); assert.equal(archiveBusy(accountId), false);
});
it('late pages and cancellation from an old transfer cannot cancel a newer transfer', async () => {
  const first = await call('archive_exportBegin', { password: 'file-test-password' });
  await call('archive_fileCancel', { sessionId: first.sessionId });
  const second = await call('archive_exportBegin', { password: 'file-test-password' });
  await assert.rejects(call('archive_exportPage', { sessionId: first.sessionId }), /expired|locked/);
  assert.equal(archiveBusy(accountId), true);
  await call('archive_fileCancel', { sessionId: first.sessionId });
  assert.equal(archiveBusy(accountId), true);
  const lines = await finishExport(second.sessionId);
  assert.equal(lines.length, 2); assert.equal(archiveBusy(accountId), false);
});

it('manual sync uses configured relays without an enabled flag and preserves an intentionally empty list', async () => {
  await browser.storage.local.remove(ARCHIVE_SETTINGS_PREFIX + accountId);
  await browser.storage.sync.set({ relays: relay });
  const state = await call('archive_getState');
  assert.deepEqual(state.settings.groups[0].relays, [relay]);
  assert.equal(state.settings.automatic, false);
  assert.equal('enabled' in state.settings, false);
  await call('archive_sync');
  await until(() => !archiveBusy(accountId));
  assert.ok(requests.some(request => request[0] === 'REQ'));
  await call('archive_configure', { settings: { ...state.settings, groups: [{ ...state.settings.groups[0], relays: [] }] } });
  assert.deepEqual((await call('archive_getState')).settings.groups[0].relays, []);
  await assert.rejects(call('archive_sync'), /at least one relay/);
});

it('legacy disabled archives remain manual and empty legacy groups use configured relays', async () => {
  await browser.storage.sync.set({ relays: relay });
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: { ...DEFAULT_ARCHIVE_SETTINGS, enabled: false, automatic: true, groups: [], selectedGroupId: '' } });
  const state = await call('archive_getState');
  assert.equal(state.settings.automatic, false);
  assert.equal('enabled' in state.settings, false);
  assert.deepEqual(state.settings.groups[0].relays, [relay]);
});


it('retrying one relay preserves stored events and other relay checkpoints, adding only missing IDs', async () => {
  const other = 'wss://other.test/';
  const configured = settings(); configured.groups[0].relays.push(other);
  await call('archive_configure', { settings: configured });
  const existing = await signed(1, 'already stored');
  const added = await signed(1, 'new event');
  const retained = await signed(1, 'not returned on retry');
  const checkpoint = { key: `${other}|authored`, relay: other, stream: 'authored' as const, since: 0, until: 20, checkedAt: 20000, complete: true };
  await commitArchiveBatch(accountId, [existing, retained].map(event => ({ event, sources: [other], savedAt: 1 })), checkpoint);
  await browser.storage.local.set({ [progressKey(accountId)]: { progress: { phase: 'complete', fetched: 5, relayResults: [{ relay: other, success: true, errors: [], fetched: 5 }] } } });
  events = [existing]; mode = 'closed';
  await call('archive_sync', { relay }); await until(() => !archiveBusy(accountId));
  const failed = (await archiveSummary(accountId)).checkpoints.find(cp => cp.relay === relay)!;
  events = [existing, added]; mode = 'eose'; queriedRelays = [];
  await call('archive_sync', { relay }); await until(() => !archiveBusy(accountId));
  assert.ok(queriedRelays.length > 0); assert.ok(queriedRelays.every(url => url === relay));
  const summary = await archiveSummary(accountId);
  assert.equal(summary.count, 3);
  assert.equal((await call('archive_getState')).progress.relayResults.find((result: any) => result.relay === other).fetched, 5);
  assert.equal((await call('archive_getState')).progress.relayResults.find((result: any) => result.relay === relay).added, 1);
  assert.deepEqual(summary.checkpoints.find(cp => cp.relay === other), checkpoint);
  assert.equal(summary.checkpoints.find(cp => cp.relay === relay)!.until, failed.until);
  const records = (await readArchivePage(accountId)).records;
  assert.deepEqual(new Set(records.map(record => record.event.id)), new Set([existing.id, added.id, retained.id]));
  assert.deepEqual(records.find(record => record.event.id === retained.id)!.event, retained);
  await call('archive_sync', { relay }); await until(() => !archiveBusy(accountId));
  assert.equal((await archiveSummary(accountId)).count, 3, 'repeated retry deduplicates existing events');
  await assert.rejects(call('archive_sync', { relay: 'wss://unselected.test' }), /retry relay/);
  await assert.rejects(call('archive_sync', { relay, full: true }), /retry relay/);
  await assert.rejects(call('archive_sync', { relay: 'https://invalid.test' }), /relay URL/);
});

it('silent Archive relays do not hold vault startup or local popup reads', { timeout: 5000 }, async () => {
  mode = 'silent';
  await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  vault.lock();
  scheduler = installArchiveAutoSync();
  await vault.beginStartupUnlock(async () => { assert.equal(await vault.unlock('integration-password'), true); });
  await until(() => requests.some(frame => frame[0] === 'REQ'));
  assert.equal(archiveBusy(accountId), true);
  await vault.whenStartupUnlockSettled();
  const state = await call('archive_getState');
  assert.equal(state.accountId, accountId);
  assert.equal(vault.isLocked(), false);
  assert.equal(archiveBusy(accountId), true, 'local reads finish while the relay is still unanswered');
});

it('Archive answers a relay challenge using its account before completing the read', async () => {
  mode = 'auth'; events = [await signed()];
  await call('archive_sync', { relay });
  await until(async () => !archiveBusy(accountId) && (await archiveSummary(accountId)).count === 1);
  const authentication = requests.find(frame => frame[0] === 'AUTH')?.[1] as SignedEvent;
  assert.equal(authentication.kind, 22242);
  assert.equal(authentication.pubkey, pubkey);
  assert.deepEqual(authentication.tags, [['relay', relay], ['challenge', 'archive-challenge']]);
  const result = (await call('archive_getState')).progress.relayResults[0];
  assert.equal(result.success, true); assert.equal(result.fetched, 1);
});

it('individual relay retries remain available, deduplicate their queue, and preserve data', async () => {
  const other = 'wss://second-retry.test/';
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: { ...settings(), groups: [{ id: 'test', name: 'Test', relays: [relay, other] }] } });
  const retained = await signed(1, 'retained');
  await commitArchiveBatch(accountId, [{ event: retained, sources: [relay], savedAt: 1 }]);
  mode = 'silent';
  await call('archive_sync', { relay });
  await until(() => requests.some(frame => frame[0] === 'REQ'));
  await call('archive_sync', { relay: other });
  await call('archive_sync', { relay: other });
  assert.deepEqual((await call('archive_getState')).pendingRelays, [relay, other]);
  mode = 'eose';
  for (const socket of sockets) if (socket.url === relay) {
    const request = requests.filter(frame => frame[0] === 'REQ').at(-1)!;
    socket.emit(['EOSE', request[1]]);
  }
  await until(async () => queriedRelays.includes(other) && !archiveBusy(accountId) && !(await call('archive_getState')).pendingRelays.length);
  assert.equal(queriedRelays.filter(url => url === other).length, 1);
  assert.equal((await archiveSummary(accountId)).count, 1);
});

it('pause clears queued relay retries and startup resumes queued work without deleting events', async () => {
  mode = 'silent';
  await call('archive_sync', { relay });
  await until(() => requests.some(frame => frame[0] === 'REQ'));
  await browser.storage.local.set({ [retryQueueKey(accountId)]: [relay] });
  await call('archive_pause');
  assert.deepEqual((await call('archive_getState')).pendingRelays, []);
  assert.equal((await browser.storage.local.get(retryQueueKey(accountId)))[retryQueueKey(accountId)], undefined);
  mode = 'eose'; events = [await signed()];
  await browser.storage.local.set({ [retryQueueKey(accountId)]: [relay] });
  scheduler = installArchiveAutoSync();
  await until(async () => !archiveBusy(accountId) && (await archiveSummary(accountId)).count === 1);
  assert.deepEqual((await call('archive_getState')).pendingRelays, []);
});

it('migration rejects a destination that does not complete a Nostr query before publishing', async () => {
  mode = 'closed';
  await assert.rejects(call('archive_copyPreview', { relay }), /Could not verify destination relay/);
  await assert.rejects(call('archive_copy', { relay }), /Could not verify destination relay/);
  assert.equal(published.length, 0);
  mode = 'eose';
  assert.ok(await call('archive_copyPreview', { relay }));
});

 it('migration verification uses an ordinary bounded query without an artificial epoch cutoff', async () => {
  await call('archive_copyPreview', { relay });
  const probe = requests.find(frame => frame[0] === 'REQ');
  assert.ok(probe);
  assert.deepEqual(probe[2], { kinds: [0], limit: 1 });
  assert.equal(published.length, 0);
});

it('pausing migration retains its counters for the migration section', async () => {
  const copyResult = { accepted: 2, existing: 1, failed: 0, skipped: 1 };
  await browser.storage.local.set({ [progressKey(accountId)]: { progress: { phase: 'copying', fetched: 3 }, copyResult } });
  await call('archive_pause');
  const state = await call('archive_getState');
  assert.equal(state.progress.phase, 'paused');
  assert.deepEqual(state.copyResult, copyResult);
});

it('migration retries only failures after the entire first pass and preserves final rejection details', async () => {
  const records = await Promise.all(['first', 'second', 'third'].map(content => signed(1, content)));
  records.sort((a, b) => a.id.localeCompare(b.id));
  await commitArchiveBatch(accountId, records.map(event => ({ event, sources: [relay], savedAt: 1 })));
  rejectPublish = (event, attempt) => event.id === records[0].id && attempt === 1 ? 'error: temporary' : event.id === records[2].id ? 'blocked: policy' : undefined;
  await browser.storage.local.set({ [copyKey(accountId)]: { relay, includeMessages: false, includeUnknown: false, startedAt: Date.now(), result: { accepted: 0, existing: 0, failed: 0, skipped: 0 } } });
  await resumeArchiveCopy(accountId);
  assert.deepEqual(published.map(event => event.id), [...records.map(event => event.id), records[0].id, records[2].id]);
  const state = await call('archive_getState');
  assert.equal(state.copyResult.accepted, 2);
  assert.equal(state.copyResult.failed, 1);
  assert.deepEqual(state.copyResult.failures, [{ id: records[2].id, kind: 1, createdAt: 10, message: 'blocked: policy', attempts: 2 }]);
  assert.equal(state.progress.phase, 'partial');
  assert.equal((await archiveSummary(accountId)).count, 3);
  await resumeArchiveCopy(accountId);
  assert.equal(published.length, 5);
});

it('migration resumes within the retry pass without resending completed attempts', async () => {
  const records = await Promise.all(['a', 'b', 'c'].map(content => signed(1, content)));
  records.sort((a, b) => a.id.localeCompare(b.id));
  await commitArchiveBatch(accountId, records.map(event => ({ event, sources: [relay], savedAt: 1 })));
  const failures = records.filter((_, index) => index !== 1).map((event, index) => ({ id: event.id, kind: event.kind, createdAt: event.created_at, message: 'blocked: policy', attempts: index === 0 ? 2 : 1 }));
  await browser.storage.local.set({ [copyKey(accountId)]: { relay, includeMessages: false, includeUnknown: false, retrying: true, after: records[0].id, startedAt: Date.now(), result: { accepted: 1, existing: 0, failed: 2, skipped: 0, failures } } });
  await resumeArchiveCopy(accountId);
  assert.deepEqual(published.map(event => event.id), [records[2].id]);
  const state = await call('archive_getState');
  assert.equal(state.copyResult.accepted, 2);
  assert.equal(state.copyResult.failed, 1);
  assert.deepEqual(state.copyResult.failures, [failures[0]]);
});

it('sync queries other relays while the first is waiting and merges their duplicate events', async () => {
  events = [await signed()];
  const relays = [relay, ...Array.from({ length: 4 }, (_, index) => `wss://parallel-${index}.test/`)];
  heldRelay = relay;
  await browser.storage.local.set({ [ARCHIVE_SETTINGS_PREFIX + accountId]: { ...settings(), groups: [{ id: 'test', name: 'Test', relays }] } });
  await call('archive_sync');
  try {
    await until(() => relays.every(url => queriedRelays.includes(url)));
    assert.ok(releaseQueries.length, 'first relay still has an unanswered query');
    await until(async () => (await archiveSummary(accountId)).count === 1);
    heldRelay = undefined;
    releaseQueries.splice(0).forEach(respond => respond());
    await until(async () => (await call('archive_getState')).progress.phase === 'complete');
    const state = await call('archive_getState');
    assert.equal(state.count, 1);
    assert.equal(state.checkpoints.length, relays.length);
    assert.ok(state.checkpoints.every((cp: any) => cp.complete));
    assert.deepEqual((await readArchivePage(accountId)).records[0].sources, [...relays].sort());
    assert.equal(state.progress.relayResults.reduce((sum: number, row: any) => sum + row.added, 0), 1);
    assert.ok(state.progress.relayResults.every((row: any) => row.fetched === 1));
  } finally { heldRelay = undefined; releaseQueries.splice(0).forEach(respond => respond()); await cancelArchiveOperations(); }
});

it('unfinished sync slices continue without waiting for an alarm', async () => {
  events = [await signed()];
  await browser.storage.local.set({ [jobKey(accountId)]: savedJob() });
  await resumeArchiveRetries(accountId);
  await until(async () => (await call('archive_getState')).progress.phase === 'complete');
  assert.equal((await archiveSummary(accountId)).count, 1);
});
