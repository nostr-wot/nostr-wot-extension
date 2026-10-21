import browser from '@lib/browser.ts';
import { WizardStep, WIZARD_STORAGE_KEY } from '@constants/wizard.ts';
import type { PhysicalEntropyKind } from '@domain/accounts/physicalEntropy.ts';

/**
 * The pending recovery phrase of the Create step, kept in `storage.session` so it
 * survives the popup closing and so the dice/coin tab can hand its phrase back.
 */
export const CREATE_STORAGE_KEY = 'wizardCreateData';
export const CREATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CreatedPhrase {
  account: any;
  mnemonic: string;
  /** Set when the phrase was built from the person's own dice or coin. */
  physical: PhysicalEntropyKind | null;
  /** Not yet revealed or backed up: the dice tab hands over a phrase nobody has seen. */
  pendingBackup: boolean;
}

export function persistCreated(account: any, mnemonic: string, physical: PhysicalEntropyKind | null = null, pendingBackup = false): Promise<void> {
  return browser.storage.session.set({ [CREATE_STORAGE_KEY]: { account, mnemonic, physical, pendingBackup, ts: Date.now() } });
}

/** The saved phrase, or null when absent or older than the TTL. */
export async function readCreated(now = Date.now()): Promise<CreatedPhrase | null> {
  const data = (await browser.storage.session.get(CREATE_STORAGE_KEY) as Record<string, any>)[CREATE_STORAGE_KEY];
  if (!data?.account || !data?.mnemonic || !data?.ts || now - data.ts >= CREATE_TTL_MS) return null;
  return { account: data.account, mnemonic: data.mnemonic, physical: data.physical ?? null, pendingBackup: data.pendingBackup === true };
}

/**
 * Rolling a hundred dice outlasts the wizard's five-minute restore window. Once
 * the dice tab hands a phrase back, renew a wizard waiting on Create so reopening
 * the popup lands there instead of starting over.
 */
export async function keepWizardOnCreate(): Promise<void> {
  const saved = (await browser.storage.session.get(WIZARD_STORAGE_KEY) as Record<string, any>)[WIZARD_STORAGE_KEY];
  if (saved?.step === WizardStep.Create) await browser.storage.session.set({ [WIZARD_STORAGE_KEY]: { ...saved, ts: Date.now() } });
}
