import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localWallet, until, walletPubkey, clientPubkey, clientKey } from '../helpers/nwc-wallet.ts';
import { getWalletProvider, clearWalletProviders, removeWalletProvider } from '../../src/services/wallet/index.ts';

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
    await wallet.response(req,{invoice:'test-invoice',payment_hash:'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'});
    assert.deepEqual(await invoice,{bolt11:'test-invoice',paymentHash:'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'});
  });
  await t.test('looks up unpaid and settled invoices',async()=>{
    for(const paid of [false,true]) {
      const start=wallet.requests.length;const lookup=provider.lookupInvoice('cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd');
      await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
      assert.equal(req.method,'lookup_invoice');assert.deepEqual(req.params,{payment_hash:'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'});
      await wallet.response(req,{amount:21000,settled_at:paid?1700000000:0});
      assert.deepEqual(await lookup,{paid,amountPaid:21});
    }
  });
  await t.test('pages settled transaction history with direction and fee conversion',async()=>{
    const start=wallet.requests.length;const history=provider.listTransactions(2,4);
    await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    assert.equal(req.method,'list_transactions');assert.deepEqual(req.params,{limit:2,offset:4,unpaid:false});
    await wallet.response(req,{transactions:[
      {type:'incoming',invoice:'invoice-a',amount:21000,fees_paid:0,description:'Deposit',settled_at:1700000001,payment_hash:'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'},
      {type:'outgoing',invoice:'invoice-b',amount:12000,fees_paid:1000,description:'Payment',settled_at:1700000002,payment_hash:'efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef'}
    ]});
    const tx=await history;assert.deepEqual(tx.map(x=>[x.paymentHash,x.amount,x.fee,x.status,x.createdAt]),[
      ['cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',21,0,'settled',1700000001],['efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',-12,1,'settled',1700000002]
    ]);
  });
  await t.test('payments remain pending until the wallet replies and return its preimage',async()=>{
    const start=wallet.requests.length;let settled=false;
    const payment=provider.payInvoice('synthetic-invoice').finally(()=>{settled=true;});
    await until(()=>wallet.requests.length>start);const req=wallet.requests[start];
    assert.equal(settled,false);assert.equal(req.method,'pay_invoice');assert.deepEqual(req.params,{invoice:'synthetic-invoice'});
    await wallet.response(req,{preimage:'abababababababababababababababababababababababababababababababab'});assert.deepEqual(await payment,{preimage:'abababababababababababababababababababababababababababababababab'});
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
