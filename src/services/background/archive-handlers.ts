import { exploreArchive, revealArchivedMessage } from '../archive/explorer.ts';
import {
  MIN_ARCHIVE_PASSWORD_LENGTH,
  MAX_ARCHIVE_PASSWORD_LENGTH,
  ARCHIVE_FILE_SESSION_MS,
} from '@constants/archive.ts';
import { archiveControl } from '../archive/control.ts';
import * as vault from '../vault/vault.ts';
import type { ArchiveState } from '@domain/archive/types.ts';
import type { HandlerFn } from './state.ts';
import {
  archiveAccount,
  getArchiveState,
  archiveSources,
  saveArchiveSettings,
  saveArchiveProgress,
  notifyArchive,
} from '../archive/state.ts';
import { validateArchiveSettings, archiveRelayUrl } from '@domain/archive/settings.ts';
import {
  startArchiveSync,
  pauseArchive,
  suspendArchive,
  holdArchive,
  releaseArchive,
} from '../archive/sync.ts';
import {
  previewArchiveCopy,
  startArchiveCopy,
  pauseArchiveCopy,
  suspendArchiveCopy,
} from '../archive/copy.ts';
import { clearArchive, deleteArchiveRecords, readArchiveRecord } from '../archive/database.ts';
import * as files from '../archive/files.ts';

async function pause(id: string) {
  await finishFile(id);
  await pauseArchiveCopy(id);
  const previous = await getArchiveState(id);
  await pauseArchive(id);
  if (previous.copyResult) {
    await saveArchiveProgress(id, { ...previous.progress, phase: 'paused', error: undefined }, previous.copyResult);
  }
}
const filePrevious = new Map<
  string,
  Pick<ArchiveState, 'progress' | 'copyResult'> & { expires: number; sessionId?: string }
>();
vault.onSessionInvalidated(() => filePrevious.clear());
async function suspendForFile(id: string) {
  const previous = await getArchiveState(id);
  await suspendArchiveCopy(id);
  await suspendArchive(id);
  holdArchive(id);
  filePrevious.set(id, { ...previous, expires: Date.now() + ARCHIVE_FILE_SESSION_MS });
}
async function finishFile(id: string, sessionId?: string) {
  const previous = filePrevious.get(id);
  if (sessionId && previous?.sessionId !== sessionId) return;
  await files.cancelArchiveFiles(id);
  filePrevious.delete(id);
  releaseArchive(id);
  if (previous && previous.expires > Date.now() && !vault.isLocked())
    await saveArchiveProgress(id, previous.progress, previous.copyResult);
}
function password(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < MIN_ARCHIVE_PASSWORD_LENGTH ||
    value.length > MAX_ARCHIVE_PASSWORD_LENGTH
  )
    throw new Error('Use an export password with at least 8 characters');
  return value;
}
function session(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid archive file session');
  return value;
}
/** Registered only in the privileged background handler map, never the page bridge. */
export const handlers = new Map<string, HandlerFn>([
  ['archive_deleteEvents', async p => { const account = await archiveAccount(p.accountId); await pause(account.id); const deleted = await deleteArchiveRecords(account.id, p.ids); await notifyArchive(); return { deleted }; }],
  ['archive_event', async p => { const account = await archiveAccount(p.accountId); if (typeof p.id !== 'string') throw new Error('Invalid event ID'); return readArchiveRecord(account.id, p.id); }],
  ['archive_explore', async p => exploreArchive((await archiveAccount(p.accountId)).id, p.filter, p.after)],
  ['archive_reveal', async p => { const account = await archiveAccount(p.accountId); return revealArchivedMessage(account.id, account.pubkey, p.id); }],
  ['archive_getState', async (p) => getArchiveState(p.accountId)],
  ['archive_sources', async (p) => archiveSources((await archiveAccount(p.accountId)).id)],
  [
    'archive_configure',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      const settings = validateArchiveSettings(p.settings);
      await pause(account.id);
      await saveArchiveSettings(account.id, settings);
      await saveArchiveProgress(account.id, { phase: 'idle', fetched: 0 });
      return getArchiveState(account.id);
    },
  ],
  [
    'archive_sync',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      await pauseArchiveCopy(account.id);
      const relay = p.relay === undefined ? undefined : archiveRelayUrl(p.relay);
      await startArchiveSync(account.id, p.full === true, relay);
      return { started: true };
    },
  ],
  [
    'archive_pause',
    async (p) => {
      await pause((await archiveAccount(p.accountId)).id);
      return { ok: true };
    },
  ],
  [
    'archive_clear',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      await pause(account.id);
      await clearArchive(account.id);
      await notifyArchive();
      return { ok: true };
    },
  ],
  [
    'archive_copyPreview',
    async (p) =>
      previewArchiveCopy(
        (await archiveAccount(p.accountId)).id,
        p.includeMessages === true,
        p.includeUnknown === true,
        p.relay,
      ),
  ],
  [
    'archive_copy',
    async (p) => {
      await startArchiveCopy(
        (await archiveAccount(p.accountId)).id,
        p.relay,
        p.includeMessages === true,
        p.includeUnknown === true,
      );
      return { started: true };
    },
  ],
  [
    'archive_fileCancel',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      await finishFile(account.id, session(p.sessionId));
      return { ok: true };
    },
  ],
  [
    'archive_exportBegin',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      const pass = password(p.password);
      await suspendForFile(account.id);
      try {
        const result = await files.beginArchiveExport(account.id, account.pubkey, pass);
        filePrevious.get(account.id)!.sessionId = result.sessionId;
        return result;
      } catch (error) {
        await finishFile(account.id);
        throw error;
      }
    },
  ],
  [
    'archive_exportPage',
    async (p) => {
      const id = (await archiveAccount(p.accountId)).id;
      try {
        const result = await files.exportArchivePage(id, session(p.sessionId));
        if (result.done) await finishFile(id, session(p.sessionId));
        return result;
      } catch (error) {
        await finishFile(id, session(p.sessionId));
        throw error;
      }
    },
  ],
  [
    'archive_importBegin',
    async (p) => {
      const account = await archiveAccount(p.accountId);
      const pass = password(p.password);
      await suspendForFile(account.id);
      try {
        const result = await files.beginArchiveImport(account.id, account.pubkey, pass);
        filePrevious.get(account.id)!.sessionId = result.sessionId;
        return result;
      } catch (error) {
        await finishFile(account.id);
        throw error;
      }
    },
  ],
  [
    'archive_importChunk',
    async (p) => {
      const id = (await archiveAccount(p.accountId)).id;
      try {
        if (typeof p.line !== 'string') throw new Error('Invalid archive file chunk');
        return await files.importArchiveChunk(id, session(p.sessionId), p.line);
      } catch (error) {
        await finishFile(id, session(p.sessionId));
        throw error;
      }
    },
  ],
  [
    'archive_importFinish',
    async (p) => {
      const id = (await archiveAccount(p.accountId)).id;
      try {
        return await files.finishArchiveImport(id, session(p.sessionId));
      } finally {
        await finishFile(id, session(p.sessionId));
      }
    },
  ],
]);

const mutations = new Set([
  'archive_deleteEvents',
  'archive_configure',
  'archive_sync',
  'archive_pause',
  'archive_clear',
  'archive_copy',
  'archive_exportBegin',
  'archive_importBegin',
  'archive_exportPage',
  'archive_importChunk',
  'archive_importFinish',
  'archive_fileCancel',
]);
for (const [name, handler] of handlers)
  if (mutations.has(name)) handlers.set(name, (...args) => archiveControl.run(() => handler(...args)));
