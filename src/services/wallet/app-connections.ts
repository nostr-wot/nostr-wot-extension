import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@lib/crypto/utils.ts';
import { secureWalletUrl, walletHttp } from '@services/http/wallet.ts';
import { readPrivateCache, writePrivateCache } from '@services/storage/private-cache.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { connectionKey, pairingUri, parseConnections, validConnectionKey, validateConnectionDraft, type ConnectionDraft, type ConnectionProvider } from '@domain/wallet/app-connections.ts';
import type { WalletConfig } from '@domain/wallet/types.ts';

const changes = new AsyncLock();
type Config = Extract<WalletConfig,{type:'lnbits'}>;
interface Stored { instance: string; walletKey: string; uris: Record<string,string>; requests?: Record<string,{pubkey:string;draft:ConnectionDraft}>; }
// Both wallet identity and account identity must match before revealing secrets.
async function records(id:string,config:Config):Promise<Stored> {
  const previous=await readPrivateCache<Stored>(connectionKey(id));
  return previous?.instance===config.instanceUrl && previous.walletKey===config.adminKey ? previous : {instance:config.instanceUrl,walletKey:config.adminKey,uris:{}};
}
async function request<T>(config:Config,method:string,path='',body?:unknown):Promise<T> {
  return walletHttp<T>(`${secureWalletUrl(config.instanceUrl)}/api/nwc/connections${path}`,{
    method,headers:{'X-Api-Key':config.adminKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),
  },globalThis.fetch.bind(globalThis),'NWC connections');
}
export async function listAppConnections(id:string,config:Config,assertCurrent:()=>void) {
  assertCurrent();
  const response=await request<{connections:unknown;provider:ConnectionProvider}>(config,'GET');
  assertCurrent();
  const stored=await records(id,config); assertCurrent();
  return {connections:parseConnections(response.connections).map(c=>({...c,canCopy:!!stored.uris[c.pubkey]}))};
}
export async function createAppConnection(id:string,config:Config,draft:ConnectionDraft,assertCurrent:()=>void,requestId:string=crypto.randomUUID()) {
 return changes.run(async()=>{
  const input=validateConnectionDraft(draft); assertCurrent();
  if (!/^[0-9a-f-]{36}$/.test(requestId)) throw new Error('Invalid request ID');
  const stored=await records(id,config); assertCurrent();
  const previous=stored.requests?.[requestId];
  if(previous) {
   if(!stored.uris[previous.pubkey]) throw new Error('Connection was revoked');
   if(JSON.stringify(previous.draft)!==JSON.stringify(input)) throw new Error('Connection request changed');
   await request(config,'PUT',`/${previous.pubkey}`,input); assertCurrent();
   return {pubkey:previous.pubkey,uri:stored.uris[previous.pubkey]};
  }
  const response=await request<{connections:unknown;provider:ConnectionProvider}>(config,'GET'); assertCurrent();
  if (parseConnections(response.connections).length>=50) throw new Error('Maximum active connections reached');
  const key=generateSecretKey();
  try {
   const pubkey=getPublicKey(key), uri=pairingUri(response.provider,bytesToHex(key));
   stored.requests=Object.fromEntries([...Object.entries(stored.requests || {}),[requestId,{pubkey,draft:input}]].slice(-100));
   stored.uris=Object.fromEntries([...Object.entries(stored.uris),[pubkey,uri]].slice(-100));
   // Persist before registration. A lost response can be recovered by refreshing the list.
   await writePrivateCache(connectionKey(id),stored); assertCurrent();
   await request(config,'PUT',`/${pubkey}`,input); assertCurrent();
   return {pubkey,uri};
  } finally { key.fill(0); }
 });
}
export async function copyAppConnection(id:string,config:Config,pubkey:string,assertCurrent:()=>void) {
  if (!validConnectionKey(pubkey)) throw new Error('Invalid connection');
  const {connections}=await listAppConnections(id,config,assertCurrent);
  if (!connections.some(c=>c.pubkey===pubkey)) throw new Error('Connection is no longer active');
  const stored=await records(id,config); assertCurrent();
  if (!stored.uris[pubkey]) throw new Error('Connection secret is not stored on this device');
  return stored.uris[pubkey];
}
export async function revokeAppConnection(id:string,config:Config,pubkey:string,assertCurrent:()=>void) {
 return changes.run(async()=>{
  if (!validConnectionKey(pubkey)) throw new Error('Invalid connection');
  assertCurrent(); await request(config,'DELETE',`/${pubkey}`); assertCurrent();
  const stored=await records(id,config); assertCurrent(); delete stored.uris[pubkey];
  await writePrivateCache(connectionKey(id),stored);
 });
}
