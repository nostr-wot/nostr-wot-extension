import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConnectionDraft, pairingUri, parseConnections } from '../../src/domain/wallet/app-connections.ts';

test('connection limits require whole positive sats and bounded expiry', () => {
  assert.deepEqual(validateConnectionDraft({name:' Primal ',dailyLimit:1000,days:30}),{name:'Primal',dailyLimit:1000,days:30});
  for (const dailyLimit of [0,-1,0.1,NaN,Infinity,10_000_000]) assert.throws(()=>validateConnectionDraft({name:'Primal',dailyLimit,days:30}));
  for (const days of [0,1.5,366]) assert.throws(()=>validateConnectionDraft({name:'Primal',dailyLimit:1000,days}));
  assert.throws(()=>validateConnectionDraft({name:'',dailyLimit:1000,days:30}));
});
test('pairing validates relay and keys and encodes query separators', () => {
 const key='12'.repeat(32);
 assert.match(pairingUri({pubkey:key,relay:'wss://relay.test/?x=1&y=2'},key),/relay=wss%3A/);
 assert.throws(()=>pairingUri({pubkey:key,relay:'https://relay.test'},key));
 assert.throws(()=>pairingUri({pubkey:'bad',relay:'wss://relay.test'},key));
});
test('provider rows preserve budgets and filter expired connections', () => {
 const row={data:{pubkey:'12'.repeat(32),description:'Primal',expires_at:200,created_at:1,last_used:5,permissions:'pay info'},budgets:[{budget_msats:100000,used_budget_msats:12000,refresh_window:86400}]};
 assert.equal(parseConnections([row],100)[0].budgets[0].usedSats,12);
 assert.equal(parseConnections([row],201).length,0);
 assert.throws(()=>parseConnections([{data:{...row.data,pubkey:'invalid'},budgets:[]}],100));
});

import { createServer } from 'node:http';
import { once } from 'node:events';
import browser,{resetMockStorage} from '../helpers/browser-mock.ts';
import * as vault from '../../src/services/vault/vault.ts';
import { createAppConnection,listAppConnections,copyAppConnection,revokeAppConnection } from '../../src/services/wallet/app-connections.ts';
import { handlers } from '../../src/services/background/wallet-handlers.ts';
import { clearWalletProviders } from '../../src/services/wallet/index.ts';
import { resetWalletDisplayCache } from '../../src/services/wallet/display-cache.ts';
import { connectionKey } from '../../src/domain/wallet/app-connections.ts';

test('HTTP contract and encrypted client manage isolated multiple connections, recovery and revocation',async t=>{
 const rows=new Map<string,Map<string,any>>([['key-a',new Map()],['key-b',new Map()]]);
 const registered:any[]=[];let failAfterCreate=false;let blocked=false;
 const proxy=createServer(async(req,res)=>{
  const key=req.headers['x-api-key'] as string, mine=rows.get(key);res.setHeader('Content-Type','application/json');
  if(!mine||blocked){res.statusCode=403;res.end('{}');return;}
  const path=req.url!;
  if(path==='/api/v1/wallet'){res.end(JSON.stringify({name:'Fixture',balance:0}));return;}
  if(req.method==='GET'){res.end(JSON.stringify({connections:[...mine.values()],provider:{pubkey:'34'.repeat(32),relay:'wss://relay.example'}}));return;}
  const pubkey=path.split('/').pop()!;
  if(req.method==='DELETE'){mine.delete(pubkey);res.end('{}');return;}
  let body='';for await(const c of req)body+=c;const input=JSON.parse(body);registered.push(input);
  mine.set(pubkey,{data:{pubkey,description:input.name,expires_at:Math.floor(Date.now()/1000)+input.days*86400,permissions:'pay lookup info',created_at:1,last_used:0},budgets:[{budget_msats:input.dailyLimit*1000,used_budget_msats:0,refresh_window:86400}]});
  if(failAfterCreate){res.statusCode=502;res.end('{}');return;}
  res.end('{}');
 });
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const url=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;
 resetMockStorage();vault.lock();clearWalletProviders();
 const config={type:'lnbits' as const,instanceUrl:url,adminKey:'key-a'};
 await vault.create('test-password',{activeAccountId:'a',accounts:[{id:'a',name:'A',type:'nsec',pubkey:'12'.repeat(32),privkey:'21'.repeat(32),mnemonic:null,nip46Config:null,readOnly:false,createdAt:1,walletConfig:config}]});
 t.after(async()=>{vault.lock();clearWalletProviders();for(const s of [proxy]){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}});
 const current=()=>{if(vault.isLocked())throw new Error('Locked');};
 const api=(path='',method='GET',key='key-a',body?:unknown)=>fetch(url+'/api/nwc/connections'+path,{method,headers:{'X-Api-Key':key},...(body?{body:JSON.stringify(body)}:{})});
 assert.deepEqual((await listAppConnections('a',config,current)).connections,[]);
 const requestId=crypto.randomUUID();
 const first=await createAppConnection('a',config,{name:'Primal',dailyLimit:1000,days:30},current,requestId);
 assert.deepEqual(await createAppConnection('a',config,{name:'Primal',dailyLimit:1000,days:30},current,requestId),first);
 assert.equal(rows.get('key-a')!.size,1,'replayed transport must not create another grant');
 const second=await createAppConnection('a',config,{name:'Other app',dailyLimit:100,days:7},current);
 assert.notEqual(first.uri,second.uri);
 assert.equal((await listAppConnections('a',config,current)).connections.length,2);
 assert.equal(registered[0].dailyLimit,1000);
 const stored=await browser.storage.local.get(null);assert.doesNotMatch(JSON.stringify(stored),new RegExp(new URL(first.uri).searchParams.get('secret')!));
 assert.equal(await copyAppConnection('a',config,first.pubkey,current),first.uri);
 assert.equal((await listAppConnections('b',{...config,adminKey:'key-b'},current)).connections.length,0);
 assert.equal((await listAppConnections('other-account',config,current)).connections[0].canCopy,false);
 await assert.rejects(copyAppConnection('a',{...config,adminKey:'key-b'},first.pubkey,current));
 await createAppConnection('b',{...config,adminKey:'key-b'},{name:'B',dailyLimit:5,days:1},current);
 await revokeAppConnection('b',{...config,adminKey:'key-b'},first.pubkey,current);
 assert.equal((await listAppConnections('a',config,current)).connections.length,2,'another wallet cannot revoke ours');
 failAfterCreate=true;
 await assert.rejects(createAppConnection('a',config,{name:'Lost response',dailyLimit:10,days:1},current));
 const recovered=(await listAppConnections('a',config,current)).connections.find(c=>c.name==='Lost response')!;
 assert.ok(recovered.canCopy);assert.match(await copyAppConnection('a',config,recovered.pubkey,current),/^nostr\+walletconnect:/);
 failAfterCreate=false;
 await revokeAppConnection('a',config,first.pubkey,current);
 await assert.rejects(copyAppConnection('a',config,first.pubkey,current));
 await assert.rejects(createAppConnection('a',config,{name:'Primal',dailyLimit:1000,days:30},current,requestId),/revoked/);
 blocked=true;assert.equal((await api()).status,403);blocked=false;
 await assert.rejects(handlers.get('wallet_listAppConnections')!({accountId:'other'}),/Account switched/);
 await resetWalletDisplayCache('a','lnbits');assert.equal((await browser.storage.local.get(connectionKey('a')))[connectionKey('a')],undefined);
 vault.lock();await assert.rejects(listAppConnections('a',config,current),/Locked/);
});
