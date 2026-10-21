import browser from '@lib/browser.ts';
import { rpcRead } from '@services/rpc.ts';
import { WizardStep, WIZARD_STORAGE_KEY } from '@constants/wizard.ts';
import { isPhysicalEntropyKind, type PhysicalEntropyKind } from '@domain/accounts/physicalEntropy.ts';

/**
 * Which pending account the Create step is showing, kept in `storage.session` so
 * it survives the popup closing and so the dice/coin tab can hand its phrase
 * back. Only the public key is stored here: on Safari session storage lives on
 * disk, so the words stay in the background's split pending-onboarding record
 * and are fetched with `onboarding_getPendingPhrase`.
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

export function persistCreated(pubkey: string, physical: PhysicalEntropyKind | null = null, pendingBackup = false): Promise<void> {
  return browser.storage.session.set({ [CREATE_STORAGE_KEY]: { pubkey, physical, pendingBackup, ts: Date.now() } });
}

/** The pending phrase the Create step was showing, or null when absent, stale or replaced. */
export async function restoreCreated(now = Date.now()): Promise<CreatedPhrase | null> {
  const data = (await browser.storage.session.get(CREATE_STORAGE_KEY) as Record<string, any>)[CREATE_STORAGE_KEY];
  if (typeof data?.pubkey !== 'string' || typeof data.ts !== 'number' || now - data.ts >= CREATE_TTL_MS) return null;
  const pending = await rpcRead<{ account: any; mnemonic: string } | null>('onboarding_getPendingPhrase', { pubkey: data.pubkey });
  if (!pending) return null;
  return {
    ...pending,
    physical: isPhysicalEntropyKind(data.physical) ? data.physical : null,
    pendingBackup: data.pendingBackup === true,
  };
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
