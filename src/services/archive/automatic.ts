import { ARCHIVE_ALARM, ARCHIVE_SETTINGS_PREFIX } from '@constants/archive.ts';
import { archiveControl } from './control.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';

import { getArchiveSettings, getArchiveState, jobKey } from './state.ts';
import {
  archiveBusy,
  resumeArchiveSync,
  resumeArchiveRetries,
  startArchiveSync,
  cancelArchiveOperations,
  drainArchiveOperations,
} from './sync.ts';
import { copyKey, resumeArchiveCopy, cancelArchiveCopies, drainArchiveCopies } from './copy.ts';
import { clearAllArchives } from './database.ts';
import { cancelArchiveFiles } from './files.ts';

/** Alarms resume bounded work after worker suspension; locked vaults never fetch archive data. */
export function installArchiveAutoSync() {
  let busy = false;
  let stopped = false;
  async function tick() {
    if (busy || stopped || vault.isLocked()) return;
    busy = true;
    const revision = vault.getSessionRevision();
    const current = () => !stopped && !vault.isLocked() && vault.getSessionRevision() === revision;
    try {
      const stored = await browser.storage.local.get('accounts');
      if (!current()) return;
      const accounts = new Map(vault.listAccounts().map((account) => [account.id, { id: account.id }]));
      for (const account of Array.isArray(stored.accounts) ? stored.accounts : []) {
        if (
          account &&
          account.type === 'npub' &&
          account.readOnly === true &&
          typeof account.id === 'string' &&
          account.id.length > 0 &&
          account.id.length <= 100 &&
          typeof account.pubkey === 'string' &&
          /^[0-9a-f]{64}$/.test(account.pubkey)
        )
          accounts.set(account.id, { id: account.id });
      }
      for (const account of accounts.values()) {
        if (!current()) break;
        if (archiveBusy(account.id)) continue;
        const jobs = await browser.storage.local.get([jobKey(account.id), copyKey(account.id)]);
        if (!current()) break;
        if (jobs[copyKey(account.id)]) {
          await resumeArchiveCopy(account.id);
          continue;
        }
        if (jobs[jobKey(account.id)]) {
          await resumeArchiveSync(account.id);
          continue;
        }
        await archiveControl.run(() => resumeArchiveRetries(account.id));
        if (archiveBusy(account.id)) continue;
        const settings = await getArchiveSettings(account.id);
        if (!current()) break;
        if (!settings.automatic) continue;
        const state = await getArchiveState(account.id);
        if (!current()) break;
        if (state.progress.phase === 'paused') continue;
        const last = state.progress.finishedAt ?? state.progress.startedAt ?? 0;
        if (Date.now() - last >= settings.intervalMinutes * 60_000)
          await archiveControl.run(async () => {
            if (!current()) return;
            const latest = await getArchiveState(account.id);
            if (
              current() &&
              latest.settings.automatic &&
              latest.progress.phase !== 'paused' &&
              Date.now() - (latest.progress.finishedAt ?? latest.progress.startedAt ?? 0) >=
                latest.settings.intervalMinutes * 60_000
            )
              await startArchiveSync(account.id);
          });
      }
    } finally {
      busy = false;
    }
  }
  const safeTick = () => {
    void tick().catch(() => {
      /* Account removal/lock is handled on the next alarm. */
    });
  };
  const onAlarm = (alarm: { name: string }) => {
    if (alarm.name === ARCHIVE_ALARM) safeTick();
  };
  const cancel = () => {
    cancelArchiveOperations();
    cancelArchiveCopies();
    void cancelArchiveFiles().catch(() => {
      /* Session keys are already discarded. */
    });
  };
  const removeLock = vault.onSessionInvalidated(cancel);
  const removeUnlock = vault.onUnlock(async () => {
    safeTick();
  });
  const removeDestroy = vault.onDestroy(async () => {
    cancel();
    await archiveControl.run(async () => {
      await Promise.all([drainArchiveOperations(), drainArchiveCopies(), cancelArchiveFiles()]);
      await clearAllArchives();
      const data = await browser.storage.local.get(null);
      await browser.storage.local.remove(Object.keys(data).filter((key) => key.startsWith('archive')));
    });
  });
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(ARCHIVE_SETTINGS_PREFIX)))
      queueMicrotask(safeTick);
  };
  browser.storage.onChanged.addListener(onChanged);
  browser.alarms.onAlarm.addListener(onAlarm);
  void browser.alarms.create(ARCHIVE_ALARM, { periodInMinutes: 1 });
  safeTick();
  return {
    tick,
    stop() {
      stopped = true;
      cancel();
      removeLock();
      removeUnlock();
      removeDestroy();
      browser.storage.onChanged.removeListener(onChanged);
      browser.alarms.onAlarm.removeListener(onAlarm);
    },
  };
}
