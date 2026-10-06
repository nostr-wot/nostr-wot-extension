import { MAX_ARCHIVE_LINE_BYTES } from '../src/constants/archive.ts';
import 'fake-indexeddb/auto';
import { beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { commitArchiveBatch, archiveSummary, clearAllArchives, readArchivePage } from '../src/services/archive/database.ts';
import { beginArchiveExport, exportArchivePage, beginArchiveImport, importArchiveChunk, finishArchiveImport, cancelArchiveFiles } from '../src/services/archive/files.ts';
const key = new Uint8Array(32).fill(1);
const signed = await signEvent({ kind: 1, created_at: 1, content: 'secret message', tags: [] }, key);
const pubkey = signed.pubkey;
const password = 'archive-password';
beforeEach(async () => { await cancelArchiveFiles(); vault.lock(); resetMockStorage(); await vault.create('password123', { accounts: [], activeAccountId: null } as never); await clearAllArchives(); });
after(async () => { await cancelArchiveFiles(); vault.lock(); });
async function exported(): Promise<string[]> {
  await commitArchiveBatch('a', [{ event: signed, sources: ['wss://one.example'], savedAt: 1 }]);
  const { sessionId } = await beginArchiveExport('a', pubkey, password); const lines: string[] = [];
  while (true) { const page = await exportArchivePage('a', sessionId); lines.push(page.line); if (page.done) break; }
  return lines;
}
it('encrypted chunk format round trips only after its authenticated footer', async () => {
  const lines = await exported(); assert.equal(lines.length, 3); assert.equal(lines.join('').includes('secret message'), false);
  const { sessionId } = await beginArchiveImport('b', pubkey, password);
  for (const line of lines) await importArchiveChunk('b', sessionId, line);
  assert.equal((await archiveSummary('b')).count, 0);
  assert.deepEqual(await finishArchiveImport('b', sessionId), { count: 1 });
  assert.equal((await readArchivePage('b')).records[0].event.id, signed.id);
});
it('truncated and reordered archives do not commit records', async () => {
  const lines = await exported(); const { sessionId } = await beginArchiveImport('b', pubkey, password);
  await importArchiveChunk('b', sessionId, lines[0]); await importArchiveChunk('b', sessionId, lines[1]);
  await assert.rejects(finishArchiveImport('b', sessionId), /footer/); assert.equal((await archiveSummary('b')).count, 0);
  await cancelArchiveFiles('b'); const other = await beginArchiveImport('b', pubkey, password);
  await importArchiveChunk('b', other.sessionId, lines[0]); await assert.rejects(importArchiveChunk('b', other.sessionId, lines[2]), /missing|order/);
  assert.equal((await archiveSummary('b')).count, 0);
});
it('wrong password, account mismatch, ciphertext tampering and bounds fail closed', async () => {
  const lines = await exported();
  const wrong = await beginArchiveImport('b', pubkey, 'wrong-password'); await assert.rejects(importArchiveChunk('b', wrong.sessionId, lines[0]), /Wrong password/); await cancelArchiveFiles('b');
  const mismatch = await beginArchiveImport('b', 'f'.repeat(64), password); await assert.rejects(importArchiveChunk('b', mismatch.sessionId, lines[0]), /different account/); await cancelArchiveFiles('b');
  const target = await beginArchiveImport('b', pubkey, password); await importArchiveChunk('b', target.sessionId, lines[0]);
  const altered = JSON.parse(lines[1]); altered.ct = (altered.ct[0] === 'A' ? 'B' : 'A') + altered.ct.slice(1);
  await assert.rejects(importArchiveChunk('b', target.sessionId, JSON.stringify(altered)), /damaged/);
  await assert.rejects(importArchiveChunk('b', target.sessionId, 'x'.repeat(MAX_ARCHIVE_LINE_BYTES + 1)), /large/);
  assert.equal((await archiveSummary('b')).count, 0);
});
it('file sessions bind account and invalidate immediately on vault lock', async () => {
  const { sessionId } = await beginArchiveExport('a', pubkey, password);
  await assert.rejects(exportArchivePage('b', sessionId)); vault.lock(); await assert.rejects(exportArchivePage('a', sessionId));
});
it('empty archive has an authenticated completion marker', async () => {
  const { sessionId } = await beginArchiveExport('a', pubkey, password);
  const first = await exportArchivePage('a', sessionId); const last = await exportArchivePage('a', sessionId); assert.equal(first.done, false); assert.equal(last.done, true);
  const incoming = await beginArchiveImport('b', pubkey, password);
  await importArchiveChunk('b', incoming.sessionId, first.line); await importArchiveChunk('b', incoming.sessionId, last.line);
  assert.deepEqual(await finishArchiveImport('b', incoming.sessionId), { count: 0 });
});
it('rejects an authenticated file chunk containing a forged event signature', async () => {
  const lines = await exported();
  const header = JSON.parse(lines[0]); const data = JSON.parse(lines[1]);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const decode64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const fileKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: decode64(header.salt), iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const params = { name: 'AES-GCM', iv: decode64(data.iv), additionalData: new TextEncoder().encode('nostr-wot-account-archive/1/data') };
  const plaintext = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(params, fileKey, decode64(data.ct))));
  plaintext.records[0].event.content = 'forged';
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, fileKey, new TextEncoder().encode(JSON.stringify(plaintext))));
  data.ct = btoa(String.fromCharCode(...ciphertext));
  const { sessionId } = await beginArchiveImport('b', pubkey, password);
  await importArchiveChunk('b', sessionId, lines[0]);
  await assert.rejects(importArchiveChunk('b', sessionId, JSON.stringify(data)), /signature/);
  assert.equal((await archiveSummary('b')).count, 0);
});
it('file session expiry is fixed even while pages are actively requested', async () => {
  const now = Date.now; let time = now(); Date.now = () => time;
  try {
    const { sessionId } = await beginArchiveExport('a', pubkey, password);
    time += 9 * 60 * 1000; assert.equal((await exportArchivePage('a', sessionId)).done, false);
    time += 61 * 1000; await assert.rejects(exportArchivePage('a', sessionId), /expired/);
  } finally { Date.now = now; }
});
it('password-free exports contain only signed events and imports merge them after validation', async () => {
  await commitArchiveBatch('a', [{ event: signed, sources: ['wss://one.example'], savedAt: 1 }]);
  const outgoing = await beginArchiveExport('a', pubkey);
  const page = await exportArchivePage('a', outgoing.sessionId);
  assert.deepEqual(JSON.parse(page.line), signed);
  assert.equal(page.done, true);
  const incoming = await beginArchiveImport('b', pubkey);
  await importArchiveChunk('b', incoming.sessionId, page.line);
  await importArchiveChunk('b', incoming.sessionId, page.line);
  assert.equal((await archiveSummary('b')).count, 0);
  await finishArchiveImport('b', incoming.sessionId);
  assert.equal((await archiveSummary('b')).count, 1);
});
it('plain imports reject forged and unrelated events before any merge', async () => {
  const incoming = await beginArchiveImport('b', pubkey);
  await importArchiveChunk('b', incoming.sessionId, JSON.stringify(signed));
  await assert.rejects(importArchiveChunk('b', incoming.sessionId, JSON.stringify({ ...signed, content: 'forged' })), /signature/);
  assert.equal((await archiveSummary('b')).count, 0);
  await cancelArchiveFiles('b');
  const unrelated = await signEvent({ kind: 1, created_at: 1, content: 'other', tags: [] }, new Uint8Array(32).fill(2));
  const other = await beginArchiveImport('b', pubkey);
  await assert.rejects(importArchiveChunk('b', other.sessionId, JSON.stringify(unrelated)), /unrelated/);
});
