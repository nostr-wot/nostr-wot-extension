import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import { getWalletProvider, clearWalletProviders, removeWalletProvider } from '../../src/services/wallet/index.ts';

const walletKey = new Uint8Array(32).fill(21);
const clientKey = new Uint8Array(32).fill(22);
const walletPubkey = getPublicKey(walletKey);
const clientPubkey = getPublicKey(clientKey);
type Request = { id: string; method: string; params: Record<string, unknown> };

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'NWC integration condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Independent wallet peer uses nostr-tools, while the provider uses the app's
// crypto. Deliberately forwards hostile events too: the provider must verify them.
async function localWallet() {
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const relay = `ws://127.0.0.1:${address.port}`;
  const requests: Request[] = [];
  const filters: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  server.on('connection', socket => {
    socket.on('message', raw => {
      void (async () => {
        const [type, value, filter] = JSON.parse(raw.toString());
        if(type==='REQ') { filters.push(filter); socket.send(JSON.stringify(['EOSE',value])); }
        if(type!=='EVENT') return;
        assert.ok(verifyEvent(value)); assert.equal(value.kind,23194);
        assert.equal(value.pubkey,clientPubkey);
        assert.deepEqual(value.tags,[['p',walletPubkey]]);
        const content=JSON.parse(await nip04.decrypt(walletKey,clientPubkey,value.content));
        requests.push({id:value.id,...content});
        socket.send(JSON.stringify(['OK',value.id,true,'']));
      })().catch(error=>errors.push(error));
    });
  });
  function send(event: object) {
    for(const socket of server.clients) if(socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(['EVENT','nwc-sub',event]));
  }
  async function response(req: Request, result: object, options: {key?:Uint8Array; tamper?:boolean; content?:string; reference?:string; error?:{code:string;message:string}} = {}) {
    const content=options.content ?? await nip04.encrypt(walletKey,clientPubkey,JSON.stringify({result_type:req.method,result,...(options.error?{error:options.error}:{})}));
    const event=finalizeEvent({kind:23195,created_at:Math.floor(Date.now()/1000),tags:[['p',clientPubkey],['e',options.reference??req.id]],content},options.key??walletKey);
    send(options.tamper?{...event,content:event.content+'tampered'}:event);
  }
  return {relay,requests,filters,errors,response,
    async close() {for(const socket of server.clients) socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  };
}

test('NWC integration through the wallet factory', {timeout:20000}, async t => {
  const wallet=await localWallet();
  clearWalletProviders();
  t.after(async()=>{clearWalletProviders();await wallet.close();assert.deepEqual(wallet.errors,[]);});
  const config={type:'nwc' as const,connectionString:`nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(wallet.relay)}&secret=${Buffer.from(clientKey).toString('hex')}`};
  let provider=getWalletProvider('integration-wallet',config)!;
  assert.equal(provider.type,'nwc');
  await provider.connect();
  await until(()=>wallet.filters.length===1);

  await t.test('connects and subscribes only to the configured wallet and client',()=>{
    assert.equal(provider.isConnected(),true);
    assert.deepEqual(wallet.filters[0],{kinds:[23195],authors:[walletPubkey],'#p':[clientPubkey]});
    assert.equal(getWalletProvider('integration-wallet',config),provider);
  });
  await t.test('reads alias and converts balance from millisatoshis',async()=>{
    let start=wallet.requests.length;const info=provider.getInfo();
    await until(()=>wallet.requests.length>start);assert.equal(wallet.requests[start].method,'get_info');
    await wallet.response(wallet.requests[start],{alias:'Test wallet',methods:['get_balance','pay_invoice']});
    assert.deepEqual(await info,{alias:'Test wallet',methods:['get_balance','pay_invoice']});
    start=wallet.requests.length;const balance=provider.getBalance();await until(()=>wallet.requests.length>start);
    await wallet.response(wallet.requests[start],{balance:42000});assert.deepEqual(await balance,{balance:42});
  });
  await t.test('creates an invoice using millisatoshis and the requested description',async()=>{
    const start=wallet.requests.length;const invoice=provider.makeInvoice(21,'Test deposit');
    await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    assert.equal(req.method,'make_invoice');assert.deepEqual(req.params,{amount:21000,description:'Test deposit'});
    await wallet.response(req,{invoice:'test-invoice',payment_hash:'test-hash'});
    assert.deepEqual(await invoice,{bolt11:'test-invoice',paymentHash:'test-hash'});
  });
  await t.test('looks up unpaid and settled invoices',async()=>{
    for(const paid of [false,true]) {
      const start=wallet.requests.length;const lookup=provider.lookupInvoice('test-hash');
      await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
      assert.equal(req.method,'lookup_invoice');assert.deepEqual(req.params,{payment_hash:'test-hash'});
      await wallet.response(req,{amount:21000,settled_at:paid?1700000000:0});
      assert.deepEqual(await lookup,{paid,amountPaid:21});
    }
  });
  await t.test('pages settled transaction history with direction and fee conversion',async()=>{
    const start=wallet.requests.length;const history=provider.listTransactions(2,4);
    await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    assert.equal(req.method,'list_transactions');assert.deepEqual(req.params,{limit:2,offset:4,unpaid:false});
    await wallet.response(req,{transactions:[
      {type:'incoming',invoice:'invoice-a',amount:21000,fees_paid:0,description:'Deposit',settled_at:1700000001,payment_hash:'hash-a'},
      {type:'outgoing',invoice:'invoice-b',amount:12000,fees_paid:1000,description:'Payment',settled_at:1700000002,payment_hash:'hash-b'}
    ]});
    const tx=await history;assert.deepEqual(tx.map(x=>[x.paymentHash,x.amount,x.fee,x.status,x.createdAt]),[
      ['hash-a',21,0,'settled',1700000001],['hash-b',-12,1,'settled',1700000002]
    ]);
  });
  await t.test('payments remain pending until the wallet replies and return its preimage',async()=>{
    const start=wallet.requests.length;let settled=false;
    const payment=provider.payInvoice('synthetic-invoice').finally(()=>{settled=true;});
    await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    assert.equal(settled,false);assert.equal(req.method,'pay_invoice');assert.deepEqual(req.params,{invoice:'synthetic-invoice'});
    await wallet.response(req,{preimage:'test-preimage'});assert.deepEqual(await payment,{preimage:'test-preimage'});
  });
  for(const code of ['UNAUTHORIZED','INSUFFICIENT_BALANCE','PAYMENT_FAILED']) await t.test(`surfaces ${code} without retrying a payment`,async()=>{
    const start=wallet.requests.length;const rejected=assert.rejects(provider.payInvoice(`invoice-${code}`),new RegExp(code));
    await until(()=>wallet.requests.length>start);await wallet.response(wallet.requests[start],{},{error:{code,message:'Test wallet refused'}});
    await rejected;assert.equal(wallet.requests.length,start+1);
  });
  await t.test('matches concurrent replies to their request event IDs',async()=>{
    const start=wallet.requests.length;const balance=provider.getBalance(),info=provider.getInfo();
    await until(()=>wallet.requests.length===start+2);
    const req=wallet.requests.slice(start);await wallet.response(req.find(x=>x.method==='get_info')!,{alias:'Concurrent',methods:[]});
    await wallet.response(req.find(x=>x.method==='get_balance')!,{balance:7000});
    assert.deepEqual(await balance,{balance:7});assert.equal((await info).alias,'Concurrent');
  });
  for(const variant of ['wrong-author','forged','undecryptable','wrong-reference'] as const) await t.test(`ignores ${variant} and still accepts the genuine response`,async()=>{
    const start=wallet.requests.length;let settled=false;
    const balance=provider.getBalance().finally(()=>{settled=true;});await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    await wallet.response(req,{balance:999000},variant==='wrong-author'?{key:new Uint8Array(32).fill(23)}:variant==='forged'?{tamper:true}:variant==='undecryptable'?{content:'not encrypted'}:{reference:'0'.repeat(64)});
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);
    await wallet.response(req,{balance:1000});assert.deepEqual(await balance,{balance:1});
  });
  await t.test('disconnect rejects pending requests and rebuilding restores the connection',async()=>{
    const start=wallet.requests.length;const rejected=assert.rejects(provider.getBalance(),/disconnected/);
    await until(()=>wallet.requests.length>start);removeWalletProvider('integration-wallet');await rejected;
    assert.equal(provider.isConnected(),false);await assert.rejects(provider.getInfo(),/not connected/);
    const old=provider;provider=getWalletProvider('integration-wallet',config)!;assert.notEqual(provider,old);
    await provider.connect();const next=wallet.requests.length;const balance=provider.getBalance();
    await until(()=>wallet.requests.length>next);await wallet.response(wallet.requests[next],{balance:2000});assert.deepEqual(await balance,{balance:2});
  });
});
