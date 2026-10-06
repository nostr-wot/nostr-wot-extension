import { AsyncLock } from '@utils/asyncLock.ts';
// Serialize short control transitions, never long-running relay work. This keeps a
// start/configure/pause/file-open race from replacing another operation's state.
export const archiveControl = new AsyncLock();
