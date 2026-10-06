import {
  ARCHIVE_FILE_FORMAT,
  ARCHIVE_PBKDF2_ITERATIONS,
  ARCHIVE_SALT_BYTES,
  ARCHIVE_IV_BYTES,
  ARCHIVE_TAG_BYTES,
} from '@constants/crypto/archive.ts';
import {
  ARCHIVE_FILE_SESSION_MS,
  MIN_ARCHIVE_PASSWORD_LENGTH,
  MAX_ARCHIVE_PASSWORD_LENGTH,
  MAX_ARCHIVE_FILE_SESSIONS,
  ARCHIVE_EXPORT_CHUNK_RECORDS,
  MAX_ARCHIVE_BATCH,
  MAX_ARCHIVE_RECORD_SOURCES,
  MAX_ARCHIVE_RELAY_URL_LENGTH,
  ARCHIVE_IMPORT_DATABASE,
  MAX_ARCHIVE_LINE_BYTES,
  MAX_ARCHIVE_FILE_BYTES,
  MAX_ARCHIVE_RECORD_BYTES,
} from '@constants/archive.ts';
import type { ArchiveRecord } from '@domain/archive/types.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import { eventBelongs } from '@domain/archive/policy.ts';
import { verifyEvent } from '@lib/crypto/nip01.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import * as vault from '../vault/vault.ts';
import { readArchivePage, commitArchiveBatch } from './database.ts';

interface Session {
  accountId: string;
  pubkey: string;
  revision: number;
  expires: number;
  mode: 'export' | 'import';
  plain: boolean;
  key?: CryptoKey;
  password?: string;
  salt?: string;
  header?: string;
  index: number;
  count: number;
  bytes: number;
  previous: string;
  after?: string;
  exhausted?: boolean;
  ended?: boolean;
  firstPrevious?: string;
  footerPrevious?: string;
  busy: AsyncLock;
}
const sessions = new Map<string, Session>();
interface Envelope {
  v: 1;
  type: 'header' | 'data' | 'end';
  salt?: string;
  iv: string;
  ct: string;
}
const encoder = new TextEncoder();
const decode = new TextDecoder();
const encode = (bytes: Uint8Array) => arrayToBase64(bytes);
const bytes = (text: string) => base64ToArray(text);
function random(size: number) {
  return crypto.getRandomValues(new Uint8Array(size));
}
async function hash(text: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
async function keyFor(password: string, salt: string): Promise<CryptoKey> {
  const raw = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: bytes(salt) as BufferSource,
        iterations: ARCHIVE_PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    raw.fill(0);
  }
}
async function seal(session: Session, type: Envelope['type'], value: unknown): Promise<string> {
  const iv = random(ARCHIVE_IV_BYTES);
  const plaintext = encoder.encode(JSON.stringify(value));
  try {
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(`${ARCHIVE_FILE_FORMAT}/1/${type}`) },
      session.key!,
      plaintext,
    );
    return JSON.stringify({
      v: 1,
      type,
      ...(type === 'header' ? { salt: session.salt } : {}),
      iv: encode(iv),
      ct: encode(new Uint8Array(ct)),
    });
  } finally {
    plaintext.fill(0);
  }
}
function envelope(line: string): Envelope {
  if (typeof line !== 'string' || encoder.encode(line).length > MAX_ARCHIVE_LINE_BYTES)
    throw new Error('Archive chunk too large');
  let value: Envelope;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Invalid archive file');
  }
  if (
    !value ||
    value.v !== 1 ||
    !['header', 'data', 'end'].includes(value.type) ||
    typeof value.iv !== 'string' ||
    typeof value.ct !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.iv) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ct) ||
    bytes(value.iv).length !== ARCHIVE_IV_BYTES ||
    bytes(value.ct).length < ARCHIVE_TAG_BYTES ||
    (value.type === 'header' &&
      (typeof value.salt !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value.salt) ||
        bytes(value.salt).length !== ARCHIVE_SALT_BYTES))
  )
    throw new Error('Invalid archive envelope');
  return value;
}
async function open(session: Session, value: Envelope): Promise<Record<string, unknown>> {
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes(value.iv) as BufferSource,
          additionalData: encoder.encode(`${ARCHIVE_FILE_FORMAT}/1/${value.type}`),
        },
        session.key!,
        bytes(value.ct) as BufferSource,
      ),
    );
  } catch {
    throw new Error('Wrong password, or the archive is damaged');
  }
  try {
    const parsed = JSON.parse(decode.decode(plaintext));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid archive contents');
    return parsed;
  } finally {
    plaintext.fill(0);
  }
}
function checked(accountId: string, id: string, mode: Session['mode']): Session {
  const session = sessions.get(id);
  if (
    !session ||
    session.accountId !== accountId ||
    session.mode !== mode ||
    session.expires < Date.now() ||
    session.revision !== vault.getSessionRevision() ||
    vault.isLocked()
  )
    throw new Error('Archive session expired or vault locked');
  return session;
}
function begin(
  accountId: string,
  pubkey: string,
  password: string | undefined,
  mode: Session['mode'],
): { sessionId: string; session: Session } {
  if (vault.isLocked()) throw new Error('Vault is locked');
  if (
    !/^[0-9a-f]{64}$/.test(pubkey) ||
    (password !== undefined && (typeof password !== 'string' ||
    password.length < MIN_ARCHIVE_PASSWORD_LENGTH ||
    password.length > MAX_ARCHIVE_PASSWORD_LENGTH))
  )
    throw new Error('Use an archive password of at least 8 characters');
  for (const [id, session] of sessions)
    if (session.expires < Date.now()) {
      sessions.delete(id);
      void clearStaging(id).catch(() => {});
    }
  if (sessions.size >= MAX_ARCHIVE_FILE_SESSIONS) throw new Error('Too many archive file operations');
  const sessionId = crypto.randomUUID();
  const session: Session = {
    accountId,
    pubkey,
    revision: vault.getSessionRevision(),
    expires: Date.now() + ARCHIVE_FILE_SESSION_MS,
    mode,
    plain: password === undefined,
    index: 0,
    count: 0,
    bytes: 0,
    previous: '',
    busy: new AsyncLock(),
  };
  sessions.set(sessionId, session);
  return { sessionId, session };
}
/** Export sessions require the caller to suspend archive writes until the footer is emitted. */
export async function beginArchiveExport(
  accountId: string,
  pubkey: string,
  password?: string,
): Promise<{ sessionId: string }> {
  const { sessionId, session } = begin(accountId, pubkey, password, 'export');
  if (session.plain) return { sessionId };
  try {
    session.salt = encode(random(ARCHIVE_SALT_BYTES));
    session.key = await keyFor(password!, session.salt);
    checked(accountId, sessionId, 'export');
    session.header = await seal(session, 'header', {
      format: ARCHIVE_FILE_FORMAT,
      pubkey,
      exportId: crypto.randomUUID(),
    });
    return { sessionId };
  } catch (error) {
    sessions.delete(sessionId);
    throw error;
  }
}
async function readExportRecords(session: Session): Promise<ArchiveRecord[]> {
  const records: ArchiveRecord[] = [];
  let chunkBytes = 0;
  while (records.length < ARCHIVE_EXPORT_CHUNK_RECORDS && !session.exhausted) {
    const page = await readArchivePage(session.accountId, session.after, 1);
    if (!page.records.length) {
      session.exhausted = true;
      break;
    }
    const stored = page.records[0];
    const record = {
      event: sanitizeEvent(stored.event),
      sources: stored.sources,
      savedAt: stored.savedAt,
    };
    const size = encoder.encode(JSON.stringify(record)).length;
    if (records.length && chunkBytes + size > MAX_ARCHIVE_RECORD_BYTES) break;
    records.push(record);
    chunkBytes += size;
    session.after = record.event.id;
    session.exhausted = !page.next;
  }
  return records;
}
export async function exportArchivePage(
  accountId: string,
  sessionId: string,
): Promise<{ line: string; done: boolean }> {
  const session = checked(accountId, sessionId, 'export');
  return session.busy.run(async () => {
    checked(accountId, sessionId, 'export');
    if (session.plain) {
      const records = await readExportRecords(session);
      const line = records.map(record => JSON.stringify(record.event)).join('\n');
      session.bytes += encoder.encode(line).length + 1;
      if (session.bytes > MAX_ARCHIVE_FILE_BYTES) throw new Error('Archive file exceeds size limit');
      checked(accountId, sessionId, 'export');
      const done = !!session.exhausted;
      if (done) sessions.delete(sessionId);
      return { line, done };
    }
    let line: string;
    let done = false;
    if (session.header) {
      line = session.header;
      session.header = undefined;
    } else if (!session.exhausted) {
      const records = await readExportRecords(session);
      if (records.length) {
        line = await seal(session, 'data', { index: session.index++, previous: session.previous, records });
        session.count += records.length;
      } else {
        session.exhausted = true;
        line = await seal(session, 'end', {
          index: session.index,
          previous: session.previous,
          count: session.count,
        });
        done = true;
      }
    } else {
      line = await seal(session, 'end', {
        index: session.index,
        previous: session.previous,
        count: session.count,
      });
      done = true;
    }
    checked(accountId, sessionId, 'export');
    session.previous = await hash(line);
    session.bytes += encoder.encode(line).length;
    if (session.bytes > MAX_ARCHIVE_FILE_BYTES) throw new Error('Archive file exceeds size limit');
    if (done) sessions.delete(sessionId);
    return { line, done };
  });
}
export async function beginArchiveImport(
  accountId: string,
  pubkey: string,
  password?: string,
): Promise<{ sessionId: string }> {
  const { sessionId, session } = begin(accountId, pubkey, password, 'import');
  session.password = password;
  if (session.plain) {
    // Plain input is sealed before staging; its temporary key never leaves this session.
    session.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    checked(accountId, sessionId, 'import');
    session.firstPrevious = '';
    session.footerPrevious = '';
  }
  return { sessionId };
}
function sanitizeEvent(value: unknown): SignedEvent {
  const event = value as SignedEvent;
  if (
    !event ||
    typeof event !== 'object' ||
    !/^[0-9a-f]{64}$/.test(event.id) ||
    !/^[0-9a-f]{64}$/.test(event.pubkey) ||
    !/^[0-9a-f]{128}$/.test(event.sig) ||
    !Number.isSafeInteger(event.kind) ||
    event.kind < 0 ||
    event.kind > 65535 ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    typeof event.content !== 'string' ||
    !Array.isArray(event.tags) ||
    !event.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  )
    throw new Error('Invalid archive event');
  return {
    id: event.id,
    pubkey: event.pubkey,
    sig: event.sig,
    kind: event.kind,
    created_at: event.created_at,
    content: event.content,
    tags: event.tags,
  };
}
async function validateRecords(value: unknown, pubkey: string): Promise<ArchiveRecord[]> {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ARCHIVE_BATCH)
    throw new Error('Invalid archive records');
  const result: ArchiveRecord[] = [];
  for (const item of value) {
    const event = sanitizeEvent(item?.event);
    if (!eventBelongs(event, pubkey, true) || !(await verifyEvent(event)))
      throw new Error('Archive contains an invalid signature or unrelated event');
    if (
      !Array.isArray(item.sources) ||
      item.sources.length > MAX_ARCHIVE_RECORD_SOURCES ||
      !item.sources.every(
        (s: unknown) => typeof s === 'string' && s.length <= MAX_ARCHIVE_RELAY_URL_LENGTH,
      ) ||
      !Number.isSafeInteger(item.savedAt) ||
      item.savedAt < 0
    )
      throw new Error('Invalid archive record metadata');
    const record = { event, sources: item.sources as string[], savedAt: item.savedAt as number };
    if (encoder.encode(JSON.stringify(record)).length > MAX_ARCHIVE_RECORD_BYTES)
      throw new Error('Archive event too large');
    result.push(record);
  }
  return result;
}
export async function importArchiveChunk(
  accountId: string,
  sessionId: string,
  line: string,
): Promise<{ count: number }> {
  const session = checked(accountId, sessionId, 'import');
  return session.busy.run(async () => {
    checked(accountId, sessionId, 'import');
    if (session.ended) throw new Error('Unexpected data after archive footer');
    if (session.plain) {
      if (typeof line !== 'string' || encoder.encode(line).length > MAX_ARCHIVE_LINE_BYTES) throw new Error('Archive chunk too large');
      session.bytes += encoder.encode(line).length + 1;
      if (session.bytes > MAX_ARCHIVE_FILE_BYTES) throw new Error('Archive file exceeds size limit');
      let event: unknown;
      try { event = JSON.parse(line); } catch { throw new Error('Invalid archive file'); }
      const records = await validateRecords([{ event, sources: [], savedAt: Date.now() }], session.pubkey);
      const sealed = await seal(session, 'data', { index: session.index, previous: session.previous, records });
      checked(accountId, sessionId, 'import');
      await stage(sessionId, session.index, sealed);
      session.index++;
      session.count += records.length;
      session.previous = await hash(sealed);
      session.footerPrevious = session.previous;
      return { count: session.count };
    }
    const value = envelope(line);
    if (session.bytes + encoder.encode(line).length > MAX_ARCHIVE_FILE_BYTES)
      throw new Error('Archive file exceeds size limit');
    if (!session.key) {
      if (value.type !== 'header') throw new Error('Missing archive header');
      session.key = await keyFor(session.password!, value.salt!);
      session.password = undefined;
      const header = await open(session, value);
      if (
        header.format !== ARCHIVE_FILE_FORMAT ||
        header.pubkey !== session.pubkey ||
        typeof header.exportId !== 'string'
      )
        throw new Error('Archive belongs to a different account');
      session.firstPrevious = await hash(line);
    } else {
      if (value.type === 'header') throw new Error('Unexpected archive header');
      const data = await open(session, value);
      if (data.index !== session.index || data.previous !== session.previous)
        throw new Error('Archive chunks are missing or out of order');
      if (value.type === 'end') {
        if (data.count !== session.count) throw new Error('Archive record count mismatch');
        session.ended = true;
        session.footerPrevious = session.previous;
      } else {
        const records = await validateRecords(data.records, session.pubkey);
        checked(accountId, sessionId, 'import');
        await stage(sessionId, session.index, line);
        session.index++;
        session.count += records.length;
      }
    }
    checked(accountId, sessionId, 'import');
    session.previous = await hash(line);
    session.bytes += encoder.encode(line).length;
    return { count: session.count };
  });
}
export async function finishArchiveImport(accountId: string, sessionId: string): Promise<{ count: number }> {
  const session = checked(accountId, sessionId, 'import');
  return session.busy.run(async () => {
    checked(accountId, sessionId, 'import');
    if (!session.plain && !session.ended) throw new Error('Incomplete archive: authenticated footer is missing');
    try {
      let previous = session.firstPrevious;
      // Recheck the authenticated chain from staging before writing any archive data.
      for (let index = 0; index < session.index; index++) {
        const line = await staged(sessionId, index);
        if (!line) throw new Error('Archive staging data missing');
        const data = await open(session, envelope(line));
        if (data.index !== index || data.previous !== previous)
          throw new Error('Archive staging data changed');
        previous = await hash(line);
      }
      if (previous !== session.footerPrevious) throw new Error('Archive staging data changed');
      for (let index = 0; index < session.index; index++) {
        checked(accountId, sessionId, 'import');
        const line = await staged(sessionId, index);
        if (!line) throw new Error('Archive staging data missing');
        const data = await open(session, envelope(line));
        const records = await validateRecords(data.records, session.pubkey);
        await commitArchiveBatch(accountId, records);
      }
      checked(accountId, sessionId, 'import');
      return { count: session.count };
    } finally {
      sessions.delete(sessionId);
      await clearStaging(sessionId);
    }
  });
}
export async function cancelArchiveFiles(accountId?: string): Promise<void> {
  const ids = [...sessions]
    .filter(([, session]) => !accountId || session.accountId === accountId)
    .map(([id]) => id);
  for (const id of ids) {
    sessions.delete(id);
    await clearStaging(id);
  }
}
// Staging contains only authenticated ciphertext, never plaintext events or keys.
let stagingInitialized: Promise<void> | undefined;
function stagingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ARCHIVE_IMPORT_DATABASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('chunks', { keyPath: ['sessionId', 'index'] });
    req.onsuccess = () => {
      const db = req.result;
      // A worker restart discards every session key, so old ciphertext is unreachable.
      stagingInitialized ??= new Promise<void>((ready, failed) => {
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').clear();
        tx.oncomplete = () => ready();
        tx.onabort = tx.onerror = () => failed(tx.error);
      });
      stagingInitialized.then(
        () => resolve(db),
        (error) => {
          db.close();
          reject(error);
        },
      );
    };
    req.onerror = () => reject(req.error);
  });
}
async function stage(sessionId: string, index: number, line: string): Promise<void> {
  await stagingTransaction('readwrite', (store) => store.put({ sessionId, index, line }));
}
async function staged(sessionId: string, index: number): Promise<string | undefined> {
  const value = await stagingTransaction('readonly', (store) => store.get([sessionId, index]));
  return (value as { line?: string } | undefined)?.line;
}
async function clearStaging(sessionId: string): Promise<void> {
  await stagingTransaction('readwrite', (store) =>
    store.delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])),
  );
}
async function stagingTransaction(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const db = await stagingDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('chunks', mode);
      const req = operation(tx.objectStore('chunks'));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Archive staging transaction failed'));
    });
  } finally {
    db.close();
  }
}
vault.onLock(() => {
  void cancelArchiveFiles().catch(() => {});
});
vault.onDestroy(() => cancelArchiveFiles());
