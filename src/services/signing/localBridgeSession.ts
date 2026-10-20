import { recordExternalEventRejection } from './rejections.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { captureAccountSession, assertAccountSession, type AccountSession } from './accountSession.ts';
import { signVerifiedRemoteEvent } from './remoteEventVerifier.ts';
import { config } from '../background/state.ts';
import { broadcastAccountChanged } from '../background/domain-handlers.ts';
import { onActiveAccountChanged } from './approvalQueue.ts';
import { clearForAccount } from '../permissions/permissions.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';

const pairingKey = (id: string) => `localBridgePairing:${id}`;
const pendingAccountKey = 'localBridgePendingAccount';
type PairingAccount = { previousAccountId: string | null; temporary: boolean };
const selectionKey = (id: string) => `localBridgeAccount:${id}`;
type Pending = { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Connection = { port: chrome.runtime.Port; session: AccountSession; pubkey: string; pending: Map<string, Pending> };
let connection: Connection | undefined;
let generation = 0;
let selectionWrites: Promise<unknown> = Promise.resolve();
function writeSelection(operation: () => Promise<void>): Promise<void> {
  const work = selectionWrites.then(operation);
  selectionWrites = work.catch(() => {});
  return work;
}

export async function isLocalBridgeSelected(accountId: string | null = vault.getActiveAccountId()): Promise<boolean> {
  if (!accountId) return false;
  const key = selectionKey(accountId);
  return (await browser.storage.local.get(key))[key] === true;
}

function closeConnection(reason: string): void {
  generation++;
  const current = connection;
  connection = undefined;
  if (!current) return;
  for (const pending of current.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  current.pending.clear();
  try { current.port.postMessage({type:'close',error:reason}); } catch { /* Port already closed. */ }
}
vault.onSessionInvalidated(() => closeConnection('Account switched or vault session changed'));

export async function localBridgeStatus(): Promise<{selected:boolean;connected:boolean;accountId:string|null;pubkey:string|null}> {
  const {activeAccountId, accounts} = await browser.storage.local.get(['activeAccountId','accounts']);
  const accountId = typeof activeAccountId === 'string' ? activeAccountId : null;
  const pubkey = (accounts as Array<{id:string;pubkey:string}> | undefined)?.find(a => a.id === accountId)?.pubkey ?? null;
  return {selected:await isLocalBridgeSelected(accountId),connected:!!connection && connection.session.accountId === accountId && !vault.isLocked(),accountId,pubkey};
}

/** Remove only accounts owned by pairing; never change a newer user selection. */
async function releasePairingAccount(accountId: string): Promise<void> {
  const {activeAccountId, accounts = []} = await browser.storage.local.get(['activeAccountId', 'accounts']) as {activeAccountId?:string;accounts?:SafeAccount[]};
  const record = (await browser.storage.local.get(pairingKey(accountId)))[pairingKey(accountId)] as PairingAccount | undefined;
  if (record) {
    await vault.requireUnlocked();
    const vaultActiveBefore = vault.getActiveAccountId();
    if (record.temporary) {
      if (vault.getAccountById(accountId)) await vault.removeAccount(accountId);
      await clearForAccount(accountId);
    }
    const remaining = record.temporary ? accounts.filter(a => a.id !== accountId) : accounts;
    await browser.storage.local.set({accounts:remaining});
    // A failed setActiveAccount may change the vault before public metadata is saved.
    if (activeAccountId === accountId || vaultActiveBefore === accountId) {
      const restoreId = vaultActiveBefore && vaultActiveBefore !== accountId ? vaultActiveBefore : record.previousAccountId;
      const previous = remaining.find(a => a.id === restoreId);
      const next = previous ?? remaining[0];
      if (next && vault.getAccountById(next.id)) await vault.setActiveAccount(next.id);
      else vault.clearActiveAccount();
      await browser.storage.local.set({activeAccountId:next?.id ?? null});
      config.myPubkey = next?.pubkey ?? '';
      if (next) await browser.storage.sync.set({myPubkey:next.pubkey});
      else await browser.storage.sync.remove('myPubkey');
      await onActiveAccountChanged(accountId, next?.id ?? null);
      if (next) void broadcastAccountChanged(next.pubkey);
    }
  }
  await browser.storage.local.remove([selectionKey(accountId), pairingKey(accountId)]);
}

async function recoverPendingAccount(): Promise<void> {
  const data = await browser.storage.local.get(pendingAccountKey);
  if (typeof data[pendingAccountKey] !== 'string') return;
  await releasePairingAccount(data[pendingAccountKey]);
  await browser.storage.local.remove(pendingAccountKey);
}
vault.onUnlock(async () => {
  // Unlock holds the vault mutation lane. Queue cleanup without awaiting a save
  // from inside that lane; the durable marker allows a later retry on failure.
  setTimeout(() => { void writeSelection(recoverPendingAccount).catch(() => {}); }, 0);
});

export async function disableLocalBridge(): Promise<{ok:true}> {
  closeConnection('Phone signer disabled');
  await writeSelection(async () => {
    await recoverPendingAccount();
    const {activeAccountId} = await browser.storage.local.get('activeAccountId');
    if (typeof activeAccountId === 'string') await releasePairingAccount(activeAccountId);
  });
  return {ok:true};
}

/** Only the dedicated extension document may supply a phone signer. */
export function acceptLocalBridgePort(port: chrome.runtime.Port): void {
  if (port.name !== 'local-bridge') return;
  if (port.sender?.id !== browser.runtime.id || port.sender?.url !== browser.runtime.getURL('src/entrypoints/local-bridge/index.html') || (port.sender.frameId !== undefined && port.sender.frameId !== 0)) {
    port.disconnect();
    return;
  }
  let disconnected = false;
  let registering = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (connection?.port === port) closeConnection('Phone signer disconnected; reconnect or explicitly disable it');
  });
  port.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const data = message as Record<string, unknown>;
    if (data.type === 'ping') { try { port.postMessage({type:'pong'}); } catch {} return; }
    if (data.type === 'ready' && !registering && connection?.port !== port) {
      registering = true;
      let revision = generation;
      void writeSelection(async () => {
        let beganAccount: string | undefined;
        try {
          if (typeof data.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(data.pubkey)) throw new Error('Invalid phone public key');
          if (!(await vault.exists())) throw new Error('Set up and unlock the extension vault before pairing');
          if (vault.isLocked()) throw new Error('Unlock the extension vault before pairing');
          let vaultRevision = vault.getSessionRevision();
          const assertPairing = () => {
            if (disconnected || generation !== revision || vault.isLocked() || vault.getSessionRevision() !== vaultRevision) throw new Error('Phone connection expired');
          };
          assertPairing();
          const {activeAccountId, accounts = []} = await browser.storage.local.get(['activeAccountId','accounts']) as {activeAccountId?:string;accounts?:SafeAccount[]};
          assertPairing();
          let selected = accounts.find((a: {id:string;pubkey:string}) => a.id === activeAccountId && a.pubkey === data.pubkey)
            ?? accounts.find((a: {pubkey:string}) => a.pubkey === data.pubkey);
          const temporary = !selected;
          if (!selected) selected = {id:crypto.randomUUID(),name:'Phone (temporary)',type:'npub',pubkey:data.pubkey,readOnly:true,createdAt:Date.now()};
          const existingPairing = (await browser.storage.local.get(pairingKey(selected.id)))[pairingKey(selected.id)];
          assertPairing();
          if (selected.id !== activeAccountId && !existingPairing) {
            // Persist ownership before add/save: lock or worker termination must not orphan it.
            await browser.storage.local.set({[pairingKey(selected.id)]:{previousAccountId:activeAccountId ?? null,temporary},[pendingAccountKey]:selected.id});
            beganAccount = selected.id;
            assertPairing();
          }
          let account = vault.getAccountById(selected.id);
          if (account && account.pubkey !== data.pubkey) throw new Error('Account public key mismatch');
          if (!account) {
            if (selected.type !== 'npub') throw new Error('Phone account is unavailable in the unlocked vault');
            await vault.addAccount({...selected,privkey:null,mnemonic:null,nip46Config:null});
            assertPairing();
            account = vault.getAccountById(selected.id);
          }
          if (!account) throw new Error('Phone account unavailable');
          if (vault.getActiveAccountId() !== selected.id) {
            const expectedRevision = vaultRevision + 1;
            const expectedGeneration = revision + 1;
            await vault.setActiveAccount(selected.id);
            vaultRevision = expectedRevision;
            revision = expectedGeneration;
            assertPairing();
          }
          await browser.storage.local.set({accounts:temporary ? [...accounts,selected] : accounts,activeAccountId:selected.id,[selectionKey(selected.id)]:true});
          assertPairing();
          config.myPubkey = account.pubkey;
          await browser.storage.sync.set({myPubkey:account.pubkey});
          assertPairing();
          if (activeAccountId !== selected.id) await onActiveAccountChanged(activeAccountId ?? null, selected.id);
          assertPairing();
          const session = captureAccountSession(selected.id);
          assertAccountSession(session);
          if (disconnected || generation !== revision) throw new Error('Phone connection expired');
          assertPairing();
          closeConnection('Phone signer connection replaced');
          connection = {port,session,pubkey:account.pubkey,pending:new Map()};
          port.postMessage({type:'ready',accountId:session.accountId,pubkey:account.pubkey});
          if (activeAccountId !== selected.id) void broadcastAccountChanged(account.pubkey);
          if (beganAccount) await browser.storage.local.remove(pendingAccountKey);
        } catch (error) {
          if (beganAccount && !vault.isLocked()) {
            await releasePairingAccount(beganAccount);
            await browser.storage.local.remove(pendingAccountKey);
          }
          throw error;
        }
      }).catch(error => { try { port.postMessage({type:'error',error:(error as Error).message}); } catch {} }).finally(() => { registering = false; });
    } else if (data.type === 'response' && connection?.port === port && typeof data.id === 'string') {
      const pending = connection.pending.get(data.id);
      if (!pending) return;
      connection.pending.delete(data.id);
      clearTimeout(pending.timer);
      try {
        assertAccountSession(connection.session);
        if (typeof data.error === 'string') throw new Error(data.error.slice(0,512));
        if (typeof data.result !== 'string' || data.result.length > 1_100_000) throw new Error('Invalid phone signer response');
        pending.resolve(data.result);
      } catch (error) { pending.reject(error as Error); }
    }
  });
}

async function request(session: AccountSession, method: string, params: string[], origin: string): Promise<string> {
  assertAccountSession(session);
  const current = connection;
  if (!current || current.session.accountId !== session.accountId || current.session.revision !== session.revision) throw new Error('Phone signer disconnected; reconnect or explicitly disable it');
  if (current.pending.size >= 16) throw new Error('Too many phone signer requests');
  const id = crypto.randomUUID();
  const revision = generation;
  const result = await new Promise<string>((resolve,reject) => {
    const timer = setTimeout(() => { current.pending.delete(id); reject(new Error('Phone signer request timed out')); },120_000);
    current.pending.set(id,{resolve,reject,timer});
    try { current.port.postMessage({type:'request',id,method,params,origin}); }
    catch { closeConnection('Phone signer disconnected'); }
  });
  assertAccountSession(session);
  if (generation !== revision || connection !== current) throw new Error('Phone signer session changed');
  return result;
}

export async function signWithLocalBridge(event: UnsignedEvent, session: AccountSession, origin: string): Promise<SignedEvent> {
  assertAccountSession(session);
  const pubkey = vault.getAccountById(session.accountId)?.pubkey;
  if (!pubkey) throw new Error('No active account');
  const revision = generation;
  const result = await signVerifiedRemoteEvent(event,pubkey,async approved => JSON.parse(await request(session,'sign_event',[JSON.stringify(approved)],origin)) as SignedEvent, () => recordExternalEventRejection(origin, event.kind, pubkey, pubkey));
  assertAccountSession(session);
  if (generation !== revision) throw new Error('Phone signer session changed');
  return result;
}

export async function cryptoWithLocalBridge(method: 'nip04Encrypt'|'nip04Decrypt'|'nip44Encrypt'|'nip44Decrypt', pubkey:string, payload:string, session:AccountSession, origin:string): Promise<string> {
  const methods = {nip04Encrypt:'nip04_encrypt',nip04Decrypt:'nip04_decrypt',nip44Encrypt:'nip44_encrypt',nip44Decrypt:'nip44_decrypt'};
  const result = await request(session,methods[method],[pubkey,payload],origin);
  assertAccountSession(session);
  return result;
}

/** Internal features must explicitly support the phone rather than borrow a local identity key. */
export async function assertLocalSigningAllowed(accountId: string): Promise<void> {
  if (await isLocalBridgeSelected(accountId)) throw new Error('This operation is unavailable while the phone signer is selected');
}
