import browser from '@lib/browser.ts';
import { restoreEntropyProgress, type PhysicalEntropyKind, type PhysicalEntropyProgress } from '@domain/accounts/physicalEntropy.ts';

/** In-progress results survive the tab closing, like the generated phrase does. */
const ENTROPY_GAME_STORAGE_KEY = 'wizardEntropyGame';

export async function loadEntropyProgress(): Promise<PhysicalEntropyProgress | null> {
  return restoreEntropyProgress((await browser.storage.session.get(ENTROPY_GAME_STORAGE_KEY))[ENTROPY_GAME_STORAGE_KEY]);
}

export function saveEntropyProgress(kind: PhysicalEntropyKind, results: number[]): void {
  browser.storage.session.set({ [ENTROPY_GAME_STORAGE_KEY]: { kind, results, ts: Date.now() } }).catch(() => {});
}

/** Drop saved progress once it has been used or the wizard moves on. */
export function clearEntropyProgress(): void {
  browser.storage.session.remove(ENTROPY_GAME_STORAGE_KEY).catch(() => {});
}
