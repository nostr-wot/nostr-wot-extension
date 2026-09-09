import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import browser, {resetMockStorage} from '../helpers/browser-mock.ts';
import * as vault from '../../src/lib/vault.ts';
import * as signer from '../../src/lib/signer.ts';
import { handlers } from '../../src/lib/bg/wallet-handlers.ts';
import { getWalletProvider, setWalletProvider, clearWalletProviders } from '../../src/lib/wallet/index.ts';
import { isWeblnAllowed } from '../../src/lib/bg/domain-handlers.ts';

const invoice='lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const origin='zap.example';
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
    {window,exports:{},crypto,setTimeout,clearTimeout,CustomEvent:class {constructor(public type:string){}},console});
  return {window,events};
}

test('website payment discovery and LNbits payment integration',{timeout:20000},async t=>{
  const requests:{path:string;body:any}[]=[];
  let failPayment=false;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};requests.push({path:req.url!,body});
    assert.equal(req.headers['x-api-key'],'test-key');
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/v1/wallet')res.end(JSON.stringify({name:'Integration LNbits',balance:1000000}));
    else if(body.out && failPayment){res.statusCode=400;res.end('{}');}
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
    assert.equal(webln.enabled,false);await signer.resolveRequest(approval.id,{allow:true});await enabling;assert.equal(webln.enabled,true);
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
    const signApproval=await pending();await signer.resolveRequest(signApproval.id,{allow:true});const signed=await signing;
    assert.ok(verifyEvent(signed));assert.equal(signed.kind,9734);
    const payment=webln.sendPayment(invoice);const payApproval=await pending();assert.equal(payApproval.walletAmount,250000);
    const count=requests.filter(x=>x.body.out).length;await signer.resolveRequest(payApproval.id,{allow:true});
    assert.equal((await payment).preimage,'test-preimage');assert.equal(requests.filter(x=>x.body.out).length,count+1);
  });
  await t.test('rejection never pays; wallet error reaches the website',async()=>{
    let count=requests.filter(x=>x.body.out).length;
    const rejected=assert.rejects(webln.sendPayment(invoice),/denied/);await signer.resolveRequest((await pending()).id,{allow:false});await rejected;
    assert.equal(requests.filter(x=>x.body.out).length,count);
    failPayment=true;const failed=assert.rejects(webln.sendPayment(invoice),/LNbits API error/);await signer.resolveRequest((await pending()).id,{allow:true});await failed;
    assert.equal(requests.filter(x=>x.body.out).length,++count);failPayment=false;
  });
  for (const recipient of ['alice@recipient.example', bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode('https://recipient.example/.well-known/lnurlp/alice')), 2000)]) await t.test(`${recipient.includes('@') ? 'Lightning Address' : 'Pasted LNURL'} resolves, verifies amount, pays once per intent`,async()=>{
    const originalFetch=globalThis.fetch;const urls:string[]=[];
    globalThis.fetch=(async(input:any,init?:RequestInit)=>{
      const url=String(input);if(!url.startsWith('https://recipient.example/'))return originalFetch(input,init);
      urls.push(url);return new Response(JSON.stringify(url.includes('/.well-known/')?{tag:'payRequest',callback:'https://recipient.example/callback',minSendable:1000,maxSendable:500000000,metadata:'[["text/plain","Donation"]]',commentAllowed:100}:{pr:invoice}));
    }) as typeof fetch;
    try {
      const resolved=await call('wallet_resolveLightningAddress',{address:recipient});assert.equal(resolved.minSats,1);
      const params={address:recipient,amountSats:250000,comment:'Thanks',intentId:`integration-zap-${recipient}`};
      const count=requests.filter(x=>x.body.out).length;
      assert.equal((await call('wallet_payToLightningAddress',params)).preimage,'test-preimage');
      await call('wallet_payToLightningAddress',params);assert.equal(requests.filter(x=>x.body.out).length,count+1);
      const callback=new URL(urls.find(x=>x.includes('/callback'))!);assert.equal(callback.searchParams.get('amount'),'250000000');assert.equal(callback.searchParams.get('comment'),'Thanks');
      await assert.rejects(call('wallet_payToLightningAddress',{...params,amountSats:10,intentId:`wrong-amount-${recipient}`}),/not the 10/);
      assert.equal(requests.filter(x=>x.body.out).length,count+1);
    }finally{globalThis.fetch=originalFetch;}
  });
});
