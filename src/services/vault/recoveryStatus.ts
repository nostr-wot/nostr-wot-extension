import browser from '@lib/browser.ts';
import * as vault from './vault.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';
import { PASSKEY_RECOVERY_STATUS_PREFIX, PASSKEY_RECOVERY_MAX_RELAYS } from '@constants/passkey.ts';
import { archiveRelayUrl } from '@domain/archive/settings.ts';
import type { PasskeyRecoveryStatus } from '@domain/vault/passkey.ts';

const key = (id: string) => PASSKEY_RECOVERY_STATUS_PREFIX + encodeURIComponent(id);
let writes: Promise<unknown> = Promise.resolve();
export async function getRecoveryStatus(credentialId: string): Promise<PasskeyRecoveryStatus> {
  if (!(await vault.listPasskeys()).some(p => p.credentialId === credentialId)) throw new Error('Unknown passkey');
  const stored = (await browser.storage.local.get(key(credentialId)))[key(credentialId)] as PasskeyRecoveryStatus | undefined;
  return stored ?? { blobSaved: null, relays: DEFAULT_RELAYS.map(archiveRelayUrl), accepted: {} };
}
async function update(credentialId: string, change: (state: PasskeyRecoveryStatus) => PasskeyRecoveryStatus) {
  const run = writes.catch(() => {}).then(async () => {
    await vault.requireUnlocked();
    const revision = vault.getSessionRevision();
    const state = change(await getRecoveryStatus(credentialId));
    if (vault.isLocked() || revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
    await browser.storage.local.set({ [key(credentialId)]: state });
    return state;
  });
  writes = run;
  return run;
}
export const recordBlobSaved = (id: string) => update(id, state => ({ ...state, blobSaved: true }));
export const addRecoveryRelay = (id: string, relay: string) => update(id, state => {
  const relays = [...new Set([...state.relays, archiveRelayUrl(relay)])];
  if (relays.length > PASSKEY_RECOVERY_MAX_RELAYS) throw new Error('Too many recovery relays');
  return { ...state, relays };
});
export const recordRecoveryPublication = (id: string, results: { relay: string; accepted: boolean }[], eventId: string) => update(id, state => ({
  ...state, accepted: { ...state.accepted, ...Object.fromEntries(results.filter(r => r.accepted).map(r => [r.relay, { eventId, acceptedAt: Date.now() }])) },
}));

export const recordBlobUnavailable = (id: string) => update(id, state => ({ ...state, blobSaved: state.blobSaved ?? false }));
vault.onDestroy(async () => {
  await writes.catch(() => {});
  const stored = await browser.storage.local.get(null);
  await browser.storage.local.remove(Object.keys(stored).filter(key => key.startsWith(PASSKEY_RECOVERY_STATUS_PREFIX)));
});
