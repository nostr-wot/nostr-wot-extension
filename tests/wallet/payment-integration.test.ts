import { localWallet, until, walletPubkey, clientKey } from '../helpers/nwc-wallet.ts';
import * as permissions from '../../src/services/permissions/permissions.ts';
import { makeLnurlInvoice } from '../helpers/lnurl-invoice.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { NIP07_CALL_TIMEOUT_MS, WEBLN_CALL_TIMEOUT_MS } from '../../src/constants/signing.ts';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import browser, {resetMockStorage} from '../helpers/browser-mock.ts';
import * as vault from '../../src/services/vault/vault.ts';
import * as signer from '../../src/services/signing/signer.ts';
import * as signerApprovalQueue from '../../src/services/signing/approvalQueue.ts';
import { handlers } from '../../src/services/background/wallet-handlers.ts';
import { getWalletProvider, setWalletProvider, clearWalletProviders } from '../../src/services/wallet/index.ts';
import { isWeblnAllowed } from '../../src/services/background/domain-handlers.ts';

const invoice='lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
function noteInvoice(metadata: string) {
  const decoded = bech32.decode(makeLnurlInvoice(metadata) as `${string}1${string}`, 2000);
  const hash = bech32.toWords(new Uint8Array(32).fill(42));
  return bech32.encode(decoded.prefix, [...decoded.words.slice(0, 7), 1, 1, 20, ...hash, ...decoded.words.slice(7)], 2000);
}
const origin='zap.example';
import { signEvent } from '../../src/lib/crypto/nip01.ts';
import { decodeBolt11 } from '../../src/domain/wallet/bolt11.ts';
const key=new Uint8Array(32).fill(31), pubkey=getPublicKey(key);
async function call(method:string,params:Record<string,unknown>={}) { return handlers.get(method)!(params) as Promise<any>; }
async function pending() {
  for(let n=0;n<400;n++) {
    const list=(await browser.storage.session.get('signerPending')).signerPending as {id:string;type:string;walletAmount?:number}[]|undefined;
    if(list?.length) return list[0];
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Approval did not appear');
}

// Execute the actual injected API. The browser messaging adapter calls real
// handlers; separate communication tests exercise content-script transport gates.
function page() {
  const listeners: ((event:any)=>void)[]=[];
  const events:string[]=[];
  const window:any={location:{origin:`https://${origin}`},addEventListener:(type:string,fn:any)=>{if(type==='message')listeners.push(fn);},dispatchEvent:(event:any)=>{events.push(event.type);}};
  window.postMessage=(message:any)=>{
    if(message.type!=='WEBLN_REQUEST' && message.type!=='NIP07_REQUEST') return;
    void (async()=>{
      try {
        const params={...message.params,origin};
        let result;
        if(message.type==='NIP07_REQUEST') result=await signer.handleSignEvent(params.event,origin);
        else {
          if(message.method!=='enable' && !await isWeblnAllowed(origin)) throw new Error('WebLN not connected');
          result=await call(`webln_${message.method}`,params);
        }
        listeners.forEach(fn=>fn({source:window,data:{type:message.type.replace('REQUEST','RESPONSE'),id:message.id,result}}));
      }catch(error){listeners.forEach(fn=>fn({source:window,data:{type:message.type.replace('REQUEST','RESPONSE'),id:message.id,error:(error as Error).message}}));}
    })();
  };
  const source=readFileSync(new URL('../../inject.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {window,exports:{},crypto,setTimeout,clearTimeout,__NIP07_CALL_TIMEOUT_MS__:NIP07_CALL_TIMEOUT_MS,__WEBLN_CALL_TIMEOUT_MS__:WEBLN_CALL_TIMEOUT_MS,CustomEvent:class {constructor(public type:string){}},console});
  return {window,events};
}

test('website payment discovery and LNbits payment integration',{timeout:20000},async t=>{
  const requests:{path:string;body:any}[]=[];
  let failPayment=false;
  let pendingPayment=false;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};requests.push({path:req.url!,body});
    assert.equal(req.headers['x-api-key'],'test-key');
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/v1/wallet')res.end(JSON.stringify({name:'Integration LNbits',balance:1000000}));
    else if(req.method === 'GET' && req.url?.startsWith('/api/v1/payments?'))res.end(JSON.stringify([{payment_hash:decodeBolt11(noteInvoice('[["text/plain","Donation"]]'))!.paymentHash,amount:-250000000,memo:'Lightning Address',status:'success',time:1700000000}]));
    else if(body.out && failPayment){res.statusCode=400;res.end('{}');}
    else if(body.out && pendingPayment)res.end(JSON.stringify({status:'pending',preimage:null}));
    else if(body.out)res.end(JSON.stringify({preimage:'test-preimage'}));
    else res.end(JSON.stringify({payment_request:invoice,payment_hash:'test-hash'}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  resetMockStorage();vault.lock();clearWalletProviders();
  const config={type:'lnbits' as const,instanceUrl:`http://127.0.0.1:${address.port}`,adminKey:'test-key'};
  await vault.create('test-password',{activeAccountId:'payment-account',accounts:[{id:'payment-account',name:'Payment',type:'nsec',pubkey,privkey:Buffer.from(key).toString('hex'),mnemonic:null,nip46Config:null,readOnly:false,createdAt:1,walletConfig:config}]});
  await browser.storage.local.set({activeAccountId:'payment-account',accounts:[{id:'payment-account',type:'nsec',pubkey}]});await browser.storage.sync.set({myPubkey:pubkey});
  t.after(async()=>{clearWalletProviders();vault.lock();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const p=page(),webln=p.window.webln;
  await t.test('website discovers WebLN and enable requires user consent',async()=>{
    assert.equal(typeof webln.sendPayment,'function');assert.ok(p.events.includes('webln-ready'));
    await assert.rejects(webln.sendPayment(invoice),/enable/);
    const enabling=webln.enable();const approval=await pending();assert.equal(approval.type,'webln_enable');
    assert.equal(webln.enabled,false);await signerApprovalQueue.resolveRequest(approval.id,{allow:true});await enabling;assert.equal(webln.enabled,true);
  });
  await t.test('LNbits advertises the WebLN methods that websites can call',async()=>{
    const info=await webln.getInfo();assert.deepEqual(info.methods,['getInfo','sendPayment','makeInvoice','getBalance']);
    assert.equal(info.node.alias,'Integration LNbits');assert.equal(info.node.pubkey,'');
    assert.equal((await webln.getBalance()).balance,1000);
  });
  await t.test('restricted wallet does not advertise unavailable payment types',async()=>{
    const original=getWalletProvider('payment-account',config)!;
    const restricted=Object.create(original);restricted.getInfo=async()=>({alias:'Read only',methods:['get_balance']});
    setWalletProvider('payment-account',restricted);
    try {assert.deepEqual((await webln.getInfo()).methods,['getInfo','getBalance']);}
    finally {setWalletProvider('payment-account',original);}
  });
  for(const args of [21,'21',{amount:21,defaultMemo:'Website deposit'}]) await t.test(`makeInvoice accepts ${typeof args}`,async()=>{
    const result=await webln.makeInvoice(args);assert.equal(result.paymentRequest,invoice);assert.equal(requests.at(-1)!.body.amount,21);
  });
  await t.test('invalid invoice amounts never reach the wallet',async()=>{
    const count=requests.length;
    for(const amount of [0,-1,1.5,NaN,'bad'])await assert.rejects(webln.makeInvoice({amount}),/amount/i);
    assert.equal(requests.length,count);
  });
  await t.test('website zap request signs kind 9734 and pays its invoice after approval',async()=>{
    const signing=p.window.nostr.signEvent({kind:9734,created_at:1700000000,tags:[['p',pubkey],['amount','250000000'],['relays','wss://relay.example']],content:'Test zap'});
    const signApproval=await pending();await signerApprovalQueue.resolveRequest(signApproval.id,{allow:true});const signed=await signing;
    assert.ok(verifyEvent(signed));assert.equal(signed.kind,9734);
    const payment=webln.sendPayment(noteInvoice(JSON.stringify(signed)));const payApproval=await pending();assert.equal(payApproval.walletAmount,250000);
    assert.deepEqual(await call('wallet_getPaymentNotices'),[]);
    const count=requests.filter(x=>x.body.out).length;await signerApprovalQueue.resolveRequest(payApproval.id,{allow:true});
    assert.equal((await payment).preimage,'test-preimage');assert.equal(requests.filter(x=>x.body.out).length,count+1);
    assert.equal((await call('wallet_getTransactions'))[0].memo,'Test zap');
    const notices=await call('wallet_getPaymentNotices');assert.equal(notices.length,1);assert.equal(notices[0].origin,origin);assert.equal(notices[0].amount,250000);
    await call('wallet_acknowledgePaymentNotices',{ids:[notices[0].id]});assert.deepEqual(await call('wallet_getPaymentNotices'),[]);
  });
  await t.test('rejection never pays; wallet error reaches the website',async()=>{
    let count=requests.filter(x=>x.body.out).length;
    const rejected=assert.rejects(webln.sendPayment(invoice),/denied/);await signerApprovalQueue.resolveRequest((await pending()).id,{allow:false});await rejected;
    assert.equal(requests.filter(x=>x.body.out).length,count);
    failPayment=true;const failed=assert.rejects(webln.sendPayment(invoice),/LNbits API error/);await signerApprovalQueue.resolveRequest((await pending()).id,{allow:true});await failed;
    assert.equal(requests.filter(x=>x.body.out).length,++count);failPayment=false;
    assert.deepEqual(await call('wallet_getPaymentNotices'),[]);
  });
  await t.test('pending LNbits payments do not produce success receipts',async()=>{
    pendingPayment=true;
    const payment=assert.rejects(webln.sendPayment(invoice),/PAYMENT_OUTCOME_UNKNOWN/);
    await signerApprovalQueue.resolveRequest((await pending()).id,{allow:true});
    await payment;
    assert.deepEqual(await call('wallet_getPaymentNotices'),[]);
    pendingPayment=false;
  });
  await t.test('receipt storage failure cannot turn a paid invoice into a retryable error',async()=>{
    const originalSet=browser.storage.local.set;
    browser.storage.local.set=async(items:Record<string,unknown>)=>{
      if(Object.keys(items).some(key=>key.startsWith('walletPaymentRecords_')))throw new Error('Storage unavailable');
      return originalSet(items);
    };
    try {
      const payment=webln.sendPayment(invoice);
      await signerApprovalQueue.resolveRequest((await pending()).id,{allow:true});
      assert.equal((await payment).preimage,'test-preimage');
    }finally {browser.storage.local.set=originalSet;}
  });
  for (const recipient of ['alice@recipient.example', bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode('https://recipient.example/.well-known/lnurlp/alice')), 2000)]) await t.test(`${recipient.includes('@') ? 'Lightning Address' : 'Pasted LNURL'} resolves, verifies amount, pays once per intent`,async()=>{
    const originalFetch=globalThis.fetch;const urls:string[]=[];
    globalThis.fetch=(async(input:any,init?:RequestInit)=>{
      const url=String(input);if(!url.startsWith('https://recipient.example/'))return originalFetch(input,init);
      urls.push(url);return new Response(JSON.stringify(url.includes('/.well-known/')?{tag:'payRequest',callback:'https://recipient.example/callback',minSendable:1000,maxSendable:500000000,metadata:'[["text/plain","Donation"]]',commentAllowed:100}:{pr:noteInvoice('[["text/plain","Donation"]]')}));
    }) as typeof fetch;
    try {
      const resolved=await call('wallet_resolveLightningAddress',{address:recipient});assert.equal(resolved.minSats,1);
      const params={address:recipient,amountSats:250000,comment:'Thanks',intentId:`integration-zap-${recipient}`};
      const count=requests.filter(x=>x.body.out).length;
      assert.equal((await call('wallet_payToLightningAddress',params)).preimage,'test-preimage');
      await call('wallet_payToLightningAddress',params);assert.equal(requests.filter(x=>x.body.out).length,count+1);
      const callback=new URL(urls.find(x=>x.includes('/callback'))!);assert.equal(callback.searchParams.get('amount'),'250000000');assert.equal(callback.searchParams.get('comment'),'Thanks');
      assert.equal((await call('wallet_getTransactions'))[0].memo,'Thanks');
      await assert.rejects(call('wallet_payToLightningAddress',{...params,amountSats:10,intentId:`wrong-amount-${recipient}`}),/not the 10/);
      assert.equal(requests.filter(x=>x.body.out).length,count+1);
    }finally{globalThis.fetch=originalFetch;}
  });
});


test('NWC production wallet and WebLN handlers over a signed loopback relay', { timeout: 20000 }, async t => {
  const wallet = await localWallet();
  resetMockStorage(); vault.lock(); clearWalletProviders();
  t.after(async () => { clearWalletProviders(); vault.lock(); await wallet.close(); assert.deepEqual(wallet.errors, []); });
  const accountId = 'nwc-handler-account';
  const config = { type: 'nwc' as const, connectionString: `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(wallet.relay)}&secret=${Buffer.from(clientKey).toString('hex')}` };
  await vault.create('test-password', { activeAccountId: accountId, accounts: [{ id: accountId, name: 'NWC', type: 'nsec', pubkey, privkey: Buffer.from(key).toString('hex'), mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1 }] });
  await browser.storage.local.set({ activeAccountId: accountId, accounts: [{ id: accountId, type: 'nsec', pubkey }] });
  await browser.storage.sync.set({ myPubkey: pubkey });

  async function exchange(operation: () => Promise<any>, method: string, result: object, params?: object) {
    const start = wallet.requests.length;
    const request = operation();
    await until(() => wallet.requests.length > start);
    const received = wallet.requests[start];
    assert.equal(received.method, method);
    if (params) assert.deepEqual(received.params, params);
    await wallet.response(received, result);
    return request;
  }

  await t.test('setup persists NWC and connects through the production factory', async () => {
    assert.equal(await call('wallet_hasConfig'), false);
    assert.equal(await exchange(() => call('wallet_connect', { walletConfig: config }), 'get_info', { alias: 'Verified NWC', methods: ['get_balance'] }), true);
    assert.equal(await call('wallet_hasConfig'), 'nwc');
    assert.deepEqual(vault.getActiveAccountWithWallet()?.walletConfig, config);
    assert.equal((await exchange(() => call('wallet_getInfo'), 'get_info', { alias: 'Local NWC', methods: ['get_balance'] })).alias, 'Local NWC');
  });
  await t.test('internal balance, deposit, lookup and history use correct protocol amounts', async () => {
    assert.deepEqual(await exchange(() => call('wallet_getBalance'), 'get_balance', { balance: 15000 }), { balance: 15 });
    assert.deepEqual(await exchange(() => call('wallet_makeInvoice', { amount: 3, memo: 'Deposit' }), 'make_invoice', { invoice, payment_hash: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' }, { amount: 3000, description: 'Deposit' }), { bolt11: invoice, paymentHash: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' });
    assert.deepEqual(await exchange(() => call('wallet_checkInvoice', { paymentHash: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' }), 'lookup_invoice', { amount: 3000, settled_at: 1700000000 }, { payment_hash: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' }), { paid: true, amountPaid: 3 });
    assert.deepEqual(await exchange(() => call('wallet_getTransactions', { limit: 10, offset: 2 }), 'list_transactions', { transactions: [] }, { limit: 10, offset: 2, unpaid: false }), []);
    assert.deepEqual(await exchange(() => call('wallet_payInvoice', { bolt11: invoice }), 'pay_invoice', { preimage: 'abababababababababababababababababababababababababababababababab' }, { invoice }), { preimage: 'abababababababababababababababababababababababababababababababab' });
  });
  const webln = page().window.webln;
  await t.test('WebLN requires consent and exposes only granted NWC methods', async () => {
    const enabling = webln.enable();
    await signerApprovalQueue.resolveRequest((await pending()).id, { allow: true });
    await enabling;
    const info = await exchange(() => webln.getInfo(), 'get_info', { alias: 'Restricted', methods: ['get_balance'] });
    assert.deepEqual(info.methods, ['getInfo', 'getBalance']);
    assert.equal(info.node.pubkey, '');
    assert.deepEqual(await exchange(() => webln.getBalance(), 'get_balance', { balance: 2000 }), { balance: 2 });
    assert.deepEqual(await exchange(() => webln.makeInvoice({ amount: 4, defaultMemo: 'WebLN' }), 'make_invoice', { invoice, payment_hash: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd' }, { amount: 4000, description: 'WebLN' }), { paymentRequest: invoice });
  });
  await t.test('WebLN rejection does not publish; approval publishes once', async () => {
    const before = (await call('wallet_getPaymentNotices')).length;
    const start = wallet.requests.length;
    const rejected = assert.rejects(webln.sendPayment(invoice), /denied/);
    await signerApprovalQueue.resolveRequest((await pending()).id, { allow: false }); await rejected;
    assert.equal(wallet.requests.length, start);
    const payment = webln.sendPayment(invoice);
    const approval = await pending(); assert.equal(approval.walletAmount, 250000);
    assert.equal(wallet.requests.length, start);
    await signerApprovalQueue.resolveRequest(approval.id, { allow: true });
    await until(() => wallet.requests.length > start);
    assert.equal(wallet.requests[start].method, 'pay_invoice');
    assert.equal((await call('wallet_getPaymentNotices')).length, before, 'approval and dispatch are not settlement');
    await wallet.response(wallet.requests[start], { preimage: 'abababababababababababababababababababababababababababababababab' });
    assert.deepEqual(await payment, { preimage: 'abababababababababababababababababababababababababababababababab' });
    assert.equal(wallet.requests.length, start + 1);
    assert.equal((await call('wallet_getPaymentNotices')).length, before + 1);
  });
  await t.test('YakiHonne published WebLN consumer pattern receives an approved preimage', async () => {
    // Mirrors useLightningWallets.js: enable, sendPayment, then map preimage.
    // This tests the consumer contract, not YakiHonne's hosted wallet backend.
    const consumer = async () => {
      await webln.enable();
      const result = await webln.sendPayment(invoice);
      return { status: Boolean(result.preimage), preImage: result.preimage };
    };
    const start = wallet.requests.length;
    const payment = consumer();
    const approval = await pending();
    assert.equal(wallet.requests.length, start);
    await signerApprovalQueue.resolveRequest(approval.id, { allow: true });
    await until(() => wallet.requests.length > start);
    assert.equal(wallet.requests[start].method, 'pay_invoice');
    const preimage = 'ab'.repeat(32);
    await wallet.response(wallet.requests[start], { preimage });
    assert.deepEqual(await payment, { status: true, preImage: preimage });
    assert.equal(wallet.requests.length, start + 1);
  });
  await t.test('account-specific deny overrides automatic threshold without publishing', async () => {
    await call('wallet_setAutoApproveThreshold', { threshold: 1000000 });
    await permissions.save(origin, 'webln_sendPayment', null, 'deny', accountId);
    const start = wallet.requests.length;
    await assert.rejects(webln.sendPayment(invoice), /Permission denied/);
    assert.equal(wallet.requests.length, start);
  });
  await t.test('locking revokes pending NWC work and unlocking reconstructs its connection', async () => {
    const start = wallet.requests.length;
    const rejected = assert.rejects(call('wallet_getBalance'), /disconnected/);
    await until(() => wallet.requests.length > start);
    const old = getWalletProvider(accountId, config)!;
    vault.lock(); await rejected;
    assert.equal(old.isConnected(), false);
    await assert.rejects(call('wallet_getBalance'), /locked/i);
    await vault.unlock('test-password');
    assert.deepEqual(await exchange(() => call('wallet_getBalance'), 'get_balance', { balance: 3000 }), { balance: 3 });
    assert.notEqual(getWalletProvider(accountId, config), old);
  });
  await t.test('ambiguous Lightning Address payment retains its intent without requesting another invoice', async () => {
    const originalFetch = globalThis.fetch;
    let resolutions = 0;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://recipient.example/')) return originalFetch(input, init);
      resolutions++;
      return new Response(JSON.stringify(url.includes('/.well-known/')
        ? { tag: 'payRequest', callback: 'https://recipient.example/callback', minSendable: 1000, maxSendable: 500000000, metadata: '[["text/plain","Donation"]]' }
        : { pr: noteInvoice('[["text/plain","Donation"]]') }));
    }) as typeof fetch;
    try {
      const start = wallet.requests.length;
      const payments = wallet.requests.filter(req => req.method === 'pay_invoice').length;
      const params = { address: 'alice@recipient.example', amountSats: 250000, intentId: 'nwc-ambiguous' };
      const rejected = assert.rejects(call('wallet_payToLightningAddress', params), /unknown/i);
      await until(() => wallet.requests.length > start);
      assert.equal(wallet.requests[start].method, 'pay_invoice');
      wallet.dropConnections(); await rejected;
      assert.equal(resolutions, 2);
      // getConnectedProvider reconnects first, but the durable intent must stop
      // the operation before resolving the address or minting another invoice.
      await assert.rejects(call('wallet_payToLightningAddress', params), /unknown/i);
      await assert.rejects(call('wallet_payToLightningAddress', params), /unknown/i);
      assert.equal(resolutions, 2);
      assert.equal(wallet.requests.filter(req => req.method === 'pay_invoice').length, payments + 1);
    } finally { globalThis.fetch = originalFetch; }
  });
  await t.test('disconnect removes the credential and rejects later calls', async () => {
    assert.equal(await call('wallet_disconnect'), true);
    assert.equal(await call('wallet_hasConfig'), false);
    await assert.rejects(call('wallet_getInfo'), /No wallet configured/);
  });
});

test('wallet payment metadata stays private, account scoped and is erased on disconnect', async t => {
  const records = await import('../../src/services/wallet/payment-records.ts');
  const { paymentRecordsKey } = await import('../../src/domain/wallet/payment-records.ts');
  const { captureAccountSession, assertAccountSession } = await import('../../src/services/signing/accountSession.ts');
  resetMockStorage(); vault.lock(); clearWalletProviders();
  const config = {type:'nwc' as const,connectionString:'nostr+walletconnect://'+'ab'.repeat(32)+'?relay=wss://relay.example&secret='+'cd'.repeat(32)+'&lud16=Alice%40example.com'};
  await vault.create('test-password',{activeAccountId:'notes-account',accounts:[{id:'notes-account',name:'Notes',type:'nsec',pubkey,privkey:Buffer.from(key).toString('hex'),mnemonic:null,nip46Config:null,readOnly:false,createdAt:1,walletConfig:config}]});
  t.after(()=>vault.lock());
  const session = captureAccountSession();
  const current = () => assertAccountSession(session);
  assert.deepEqual(await call('wallet_getLightningAddress'), {address:'alice@example.com'});
  await Promise.all([
    records.savePaymentNote('notes-account','a','Private lunch note',current),
    records.savePaymentNote('notes-account','b','Second note',current),
  ]);
  const rows = [{paymentHash:'a',amount:-1,status:'settled' as const,createdAt:1},{paymentHash:'b',amount:-2,status:'failed' as const,createdAt:2}];
  assert.deepEqual((await records.applyPaymentNotes('notes-account',rows)).map(tx=>tx.memo),['Private lunch note','Second note']);
  assert.equal((await records.applyPaymentNotes('other',rows))[0].memo,undefined);
  assert.equal((await records.applyPaymentNotes('notes-account',[{...rows[0],amount:1}]))[0].memo,undefined);
  const zap = await signEvent({kind:9734,created_at:1,tags:[['p',pubkey]],content:'Signed website zap'},key);
  await records.rememberSignedZapNote('notes-account',zap,current);
  const zapInvoice=noteInvoice(JSON.stringify(zap));
  const zapHash=decodeBolt11(zapInvoice)!.paymentHash!;
  const tx={...rows[0],paymentHash:zapHash,bolt11:zapInvoice};
  assert.equal((await records.applyPaymentNotes('notes-account',[tx]))[0].memo,'Signed website zap');
  assert.equal((await records.applyPaymentNotes('other',[tx]))[0].memo,undefined);
  const unrelated=noteInvoice(JSON.stringify({...zap,content:'Different'}));
  assert.equal((await records.applyPaymentNotes('notes-account',[{...tx,bolt11:unrelated}]))[0].memo,undefined);
  await records.linkInvoiceNote('notes-account',unrelated,current);
  assert.equal((await records.applyPaymentNotes('notes-account',[{...tx,bolt11:undefined}]))[0].memo,undefined);
  await records.linkInvoiceNote('notes-account',zapInvoice,current);
  assert.equal((await records.applyPaymentNotes('notes-account',[{...tx,bolt11:undefined}]))[0].memo,'Signed website zap');
  await records.rememberSignedZapNote('notes-account',{...zap,kind:1,content:'Not a zap'},current);
  assert.equal((await records.applyPaymentNotes('notes-account',[{...rows[0],paymentHash:'other-hash',bolt11:noteInvoice(JSON.stringify({...zap,kind:1,content:'Not a zap'}))}]))[0].memo,undefined);
  for(let n=0;n<22;n++) await records.recordPaymentSuccess('notes-account','site.example',n,current);
  const notices=await call('wallet_getPaymentNotices');assert.equal(notices.length,20);
  await call('wallet_acknowledgePaymentNotices',{ids:[notices[0].id]});
  assert.equal((await call('wallet_getPaymentNotices')).length,19);
  await assert.rejects(call('wallet_getPaymentNotices',{accountId:'other'}),/Account switched/);
  await assert.rejects(call('wallet_acknowledgePaymentNotices',{accountId:'other',ids:[]}),/Account switched/);
  const stored=(await browser.storage.local.get(paymentRecordsKey('notes-account')))[paymentRecordsKey('notes-account')];
  assert.equal(stored.privateCache,1);assert.doesNotMatch(JSON.stringify(stored),/Private lunch|site.example|Second note/);
  vault.lock();
  await assert.rejects(call('wallet_getPaymentNotices'),/locked/i);
  await assert.rejects(records.savePaymentNote('notes-account','c','Late note',current),/locked/i);
  await vault.unlock('test-password');
  assert.equal((await records.applyPaymentNotes('notes-account',rows))[0].memo,'Private lunch note');
  await call('wallet_disconnect');
  assert.equal((await records.applyPaymentNotes('notes-account',rows))[0].memo,undefined);
  assert.deepEqual(await call('wallet_getPaymentNotices'),[]);
  for(const address of ['', 'bad', 'https://evil.example', 'javascript:alert(1)']) {
    await vault.updateAccountWalletConfig('notes-account',{...config,connectionString:config.connectionString.replace('Alice%40example.com',encodeURIComponent(address))});
    assert.deepEqual(await call('wallet_getLightningAddress'),{address:null});
  }
});
