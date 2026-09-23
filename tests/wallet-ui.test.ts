import type { PendingRequest } from '../src/domain/signing/types';
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TransactionList from '../src/screens/Wallet/TransactionList';
import Wallet from '../src/screens/Wallet/Wallet';
import { AccountProvider } from '../src/context/AccountContext';
import {AccountWalletProvider} from '../src/context/WalletContext';
import { filterTransactions } from '../src/domain/wallet/txFilter';
import { EMPTY_TX_FILTERS } from '@constants/wallet.ts';
const props={transactions:[],loading:false,hasMore:false,filters:EMPTY_TX_FILTERS,onRefresh(){},onOpenFilters(){},onLoadMore(){}};
it('history failures show retry, not an empty-wallet claim',()=>{
 const html=renderToStaticMarkup(createElement(TransactionList,{...props,error:'Offline'}));
 assert.match(html,/wallet.historyFailed/); assert.match(html,/common.retry/); assert.doesNotMatch(html,/wallet.noTransactions/);
});
it('empty filtered pages retain pagination controls',()=>{
 const html=renderToStaticMarkup(createElement(TransactionList,{...props,hasMore:true,filters:{...EMPTY_TX_FILTERS,direction:'out'}}));
 assert.match(html,/common.showMore/); assert.match(html,/wallet.noMatchingTransactions/);
});
it('unpaid invoices do not appear as received payments and failed rows show status',()=>{
 const transactions=[{paymentHash:'pending',amount:100,status:'pending' as const,createdAt:1700000000},{paymentHash:'failed',amount:-30,status:'failed' as const,createdAt:1700000000}];
 assert.equal(filterTransactions(transactions,EMPTY_TX_FILTERS).length,1);
 const html=renderToStaticMarkup(createElement(TransactionList,{...props,transactions}));
 assert.doesNotMatch(html,/wallet.txPending|wallet.txRequested/); assert.doesNotMatch(html,/wallet.txReceived/); assert.match(html,/wallet.txFailed/); assert.match(html,/sats/); assert.doesNotMatch(html,/<a/);
});
it('wallet uses the shared purple controls and has named history refresh',()=>{
 const html=renderToStaticMarkup(createElement(AccountWalletProvider,{enabled:false},createElement(Wallet,{providerType:'lnbits',onDisconnected(){}})));
 assert.match(html,/LNbits/); assert.match(html,/text-menu-subtitle/); assert.match(html,/aria-label="common.refresh"/);
});

it('LNbits pending-response rows remain pending and are hidden from activity',async()=>{
 const {LnbitsProvider}=await import('../src/services/wallet/lnbits.ts');
 const provider=new LnbitsProvider({instanceUrl:'https://wallet.test',adminKey:'test'},async()=>new Response(JSON.stringify([
  {payment_hash:'fixture',amount:1000,fee:0,status:'pending',memo:'Lightning Address',time:'2026-09-08T21:40:02.785317+00:00',preimage:'fixture-preimage'},
 ])));
 const transactions=await provider.listTransactions();
 assert.equal(transactions[0].amount,1);
 assert.equal(transactions[0].status,'pending','a preimage does not override provider status');
 const html=renderToStaticMarkup(createElement(TransactionList,{...props,transactions}));
 assert.doesNotMatch(html,/wallet.txPending|wallet.txRequested/);
 assert.match(html,/wallet.noTransactions/); assert.doesNotMatch(html,/wallet.txReceived|\+1/);
});

it('cached wallet data paints before a delayed check and survives failure or an unexpected negative',async()=>{
 const {loadWalletDisplay}=await import('../src/context/WalletContext');
 const patches:any[]=[];
 let fail!:()=>void;
 const waiting=new Promise<string|false>((_,reject)=>{fail=()=>reject(new Error('Offline'));});
 const cached={providerType:'lnbits',balance:27,transactions:[]};
 const pending=loadWalletDisplay('a',p=>patches.push(p),()=>true,async()=>cached,()=>waiting);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(patches[0].configType,'lnbits'); assert.equal(patches[0].cachedBalance,27);
 fail(); await assert.rejects(pending,/Offline/);
 await assert.rejects(()=>loadWalletDisplay('a',p=>patches.push(p),()=>true,async()=>cached,async()=>false));
 assert.ok(patches.every(p=>p.configType==='lnbits'));
});
it('disconnect invalidates an in-flight display check',async()=>{
 const {loadWalletDisplay}=await import('../src/context/WalletContext');
 let current=true; let finish!:(value:string)=>void;
 const waiting=new Promise<string>(resolve=>{finish=resolve;});
 const patches:any[]=[];
 const pending=loadWalletDisplay('a',p=>patches.push(p),()=>current,async()=>null,()=>waiting);
 await new Promise(resolve=>setImmediate(resolve));
 current=false; finish('lnbits'); await pending;
 assert.deepEqual(patches,[]);
});
it('balance remains visible beside loading and failed refresh indicators, without inventing zero',async()=>{
 const {default:WalletBalance}=await import('../src/components/WalletBalance');
 const refreshing=renderToStaticMarkup(createElement(WalletBalance,{balance:123,loading:true,error:false}));
 assert.match(refreshing,/123/); assert.match(refreshing,/role="status"/);
 const failed=renderToStaticMarkup(createElement(WalletBalance,{balance:123,loading:false,error:true}));
 assert.match(failed,/123/); assert.match(failed,/wallet.lastKnownBalance/);
 const unknown=renderToStaticMarkup(createElement(WalletBalance,{balance:null,loading:true,error:false}));
 assert.match(unknown,/—/); assert.doesNotMatch(unknown,/>0</);
});

it('settings publishes independent results immediately, preserves failed fields and ignores stale responses',async()=>{
 const {loadWalletSettings}=await import('../src/context/WalletContext');
 const patches:any[]=[]; let finish!:(value:any)=>void;
 const slow=new Promise(resolve=>{finish=resolve;});
 let current=true;
 const pending=loadWalletSettings('lnbits',p=>patches.push(p),()=>current,async(method:string)=>{
  if(method==='wallet_getLightningAddress')return slow;
  if(method==='wallet_getNwcUri')throw new Error('Offline');
  return method==='wallet_getInfo'?{alias:'My wallet'}:20;
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(patches.some(p=>p.alias==='My wallet')); assert.ok(patches.some(p=>p.threshold===20));
 assert.ok(patches.every(p=>!('address' in p)&&!('nwcUri' in p)));
 current=false;finish({address:'late@example.com'});await assert.rejects(pending,/Offline/);
 assert.ok(patches.every(p=>!('address' in p)));
});
it('payment dialogs use a spaced body and labelled inputs',async()=>{
 const {default:Deposit}=await import('../src/screens/Wallet/DepositDialog');
 const {default:Send}=await import('../src/screens/Wallet/SendDialog');
 for(const Component of [Deposit,Send]){
  const html=renderToStaticMarkup(createElement(Component as any,{onClose(){},onPaid(){},onSent(){}}));
  assert.match(html,/gap-6/);assert.match(html,/<label/);assert.match(html,/340px/);
 }
});

it('settings shows unknown address as loading, never an empty claim form',async()=>{
 const {default:Settings}=await import('../src/screens/Wallet/WalletSettings');
 const html=renderToStaticMarkup(createElement(AccountProvider,null,createElement(AccountWalletProvider,{enabled:false},createElement(Settings,{providerType:'lnbits',onClose(){},onDisconnected(){}}))));
 assert.match(html,/common.loading/); assert.doesNotMatch(html,/wallet.claimUsername/);assert.match(html,/common.save/);
});

it('wallet settings owns a bounded scroll region and explains its refresh and disconnect actions',async()=>{
 const {default:Settings}=await import('../src/screens/Wallet/WalletSettings');
 const html=renderToStaticMarkup(createElement(AccountProvider,null,createElement(AccountWalletProvider,{enabled:false},createElement(Settings,{providerType:'lnbits',onClose(){},onDisconnected(){}}))));
 assert.match(html,/flex-1 min-h-0 overflow-y-auto/);
 assert.match(html,/wallet.refreshSettingsHint/);assert.match(html,/wallet.disconnectHint/);
 assert.match(html,/wallet.connectedTo/);
 assert.match(html,/wallet.connectionHelpTitle/);
 assert.ok(html.indexOf('common.disconnect') < html.indexOf('wallet.autoApprove'), 'disconnect belongs below the connection heading, before other settings');
});
it('wallet copy controls use named SVG icons without rendering connection credentials',async()=>{
 const {default:CopyButton}=await import('../src/components/CopyButton');
 const html=renderToStaticMarkup(createElement(CopyButton,{iconOnly:true,value:'secret-connection',label:'Copy connection'}));
 assert.match(html,/<svg/);assert.match(html,/aria-label="Copy connection"/);assert.doesNotMatch(html,/secret-connection|>Copy connection</);
});

it('Home only shows wallet balance after the current site is confirmed connected',async()=>{
 const {HomeWalletLayout}=await import('../src/screens/Home/Home');
 for(const state of [null,'empty','notConnected','error','connected']) {
  const notice=state==='connected'?null:'Site unavailable';
  const html=renderToStaticMarkup(createElement(HomeWalletLayout,{wallet:createElement('div',null,'Private wallet balance'),siteNotice:notice,siteConnected:state==='connected'},createElement('div',null,'Site controls')));
  if(state==='connected') {
   assert.match(html,/Private wallet balance/);assert.match(html,/Site controls/);
  } else {
   assert.doesNotMatch(html,/Private wallet balance/);assert.match(html,/Site unavailable/);
  }
 }
});

it('approval rows identify origin, action and human-readable kind',async()=>{
 const {default:ApprovalCard}=await import('../src/screens/Approval/ApprovalCard');
 const html=renderToStaticMarkup(createElement(ApprovalCard,{group:{origin:'example.com',method:'signEvent',permKey:'signEvent:1',requests:[{id:'one',origin:'example.com',type:'signEvent',eventKind:1,timestamp:1}]},onClick(){}}));
 assert.match(html,/example.com/);assert.match(html,/Short Note/);assert.match(html,/\(1\)/);assert.match(html,/approval.signEvent/);
});

it('payment preview separates resolving, recipient limits and invoice details', async () => {
 const {default:Preview}=await import('../src/screens/Wallet/PaymentPreview');
 const base={sendInput:'alice@example.com',sendIsAddress:true,sendAddress:null,resolveLoading:true,resolveError:'',sendAmount:'',sendComment:'',sendTarget:{kind:'none',reason:'resolving'} as const,decodedInvoice:null,setSendAmount(){},setSendComment(){}};
 const resolving=renderToStaticMarkup(createElement(Preview,base));
 assert.match(resolving,/wallet.resolvingAddress/);assert.doesNotMatch(resolving,/type="number"/);
 const address=renderToStaticMarkup(createElement(Preview,{...base,resolveLoading:false,sendAddress:{address:'alice@example.com',domain:'example.com',minSats:10,maxSats:20,description:'Tip jar',commentAllowed:40,allowsNostr:false},sendAmount:'30',sendTarget:{kind:'none',reason:'amount'}}));
 assert.match(address,/alice@example.com/);assert.match(address,/Tip jar/);assert.match(address,/maxLength="40"/i);assert.match(address,/wallet.amountOutOfRange/);
 const invoice=renderToStaticMarkup(createElement(Preview,{...base,sendIsAddress:false,decodedInvoice:{amountSats:42,amountMsats:42000,descriptionHash:null,description:'Invoice memo',timestamp:1,expiry:1,paymentHash:'hash',network:'bc'}}));
 assert.match(invoice,/42 sats/);assert.match(invoice,/Invoice memo/);assert.match(invoice,/wallet.invoiceExpired/);assert.doesNotMatch(invoice,/wallet.addressRange/);
});

it('transaction date filters retain both date drafts in shared native inputs', async () => {
 const {default:Filters}=await import('../src/screens/Wallet/TxFilterDialog');
 const html=renderToStaticMarkup(createElement(Filters,{initial:{direction:'all',dateFrom:'2026-09-01',dateTo:'2026-09-09'},onApply(){},onClose(){}}));
 assert.equal((html.match(/type="date"/g)||[]).length,2);
 assert.match(html,/value="2026-09-01"/);assert.match(html,/value="2026-09-09"/);assert.match(html,/border-control-border/);
});

it('switching the wallet account preserves the in-progress popup wizard', async t => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { AccountProvider, useAccount } = await import('../src/context/AccountContext');
  const { WalletProvider } = await import('../src/context/WalletContext');
  const { default: useWizardFlow } = await import('../src/hooks/useWizardFlow');
  const { default: browser } = await import('./helpers/browser-mock');
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
  const { createRoot } = await import('react-dom/client');
  const initialMessages=t.mock.method(browser.runtime,'sendMessage',async()=>({result:false}));
  const parent={id:'seed',pubkey:'11'.repeat(32),name:'Seed',type:'generated'};
  const child={...parent,id:'child',pubkey:'22'.repeat(32)};
  await browser.storage.local.set({accounts:[parent],activeAccountId:parent.id});
  let switchAccount!:(id:string)=>Promise<void>;
  let selectedId:string|null=null;
  let reload!:()=>void, send!:(type:string,payload?:Record<string,unknown>)=>void;
  function Probe(){
    reload=useAccount().reload;
    switchAccount=useAccount().switchAccount;
    selectedId=useAccount().activeId;
    const flow=useWizardFlow({skipLang:true,hasAccounts:true,hasGeneratedAccount:true});
    send=flow.send;
    return createElement('span',null,flow.step);
  }
  const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async()=>{root.render(createElement(AccountProvider,null,createElement(WalletProvider,null,createElement(Probe))));});
    await act(async()=>{send('SELECT',{method:'create'});});
    assert.equal(dom.window.document.body.textContent,'subaccount');
    const completeSavedAccount=send;
    await act(async()=>{await browser.storage.local.set({accounts:[parent,child],activeAccountId:child.id});reload();});
    await act(async()=>{completeSavedAccount('CREATED',{account:child});});
    assert.equal(dom.window.document.body.textContent,'followSuggestions');
    const queryMock=t.mock.method(browser.tabs,'query',async()=>[]);
    for(const id of [parent.id,child.id,parent.id,child.id]) {
      await act(async()=>switchAccount(id));
      assert.equal(selectedId,id);
      assert.equal(dom.window.document.body.textContent,'followSuggestions');
    }
    assert.equal(queryMock.mock.callCount(),4,'each switch refreshes the current tab when one exists');
    queryMock.mock.restore();
    const activeTabQuery = t.mock.method(browser.tabs, 'query', async () => [{ id: 7 }]);
    const pageReload = t.mock.method(browser.tabs, 'sendMessage', async () => ({ ok: true }));
    const originalReload = Object.getOwnPropertyDescriptor(browser.tabs, 'reload');
    let nativeReloads = 0;
    Object.defineProperty(browser.tabs, 'reload', { configurable: true, value: async () => { nativeReloads++; } });
    try {
      await act(async () => switchAccount(parent.id));
      assert.deepEqual(pageReload.mock.calls[0].arguments, [7, { type: 'NOSTR_RELOAD_PAGE' }, { frameId: 0 }]);
      assert.equal(nativeReloads, 0, 'acknowledged page reload must not also trigger a native reload');
      assert.ok(initialMessages.mock.calls.some(call => {
        const message = call.arguments[0] as { method?: string; params?: { tabId?: number } };
        return message.method === 'scheduleAccountSwitchPopupRecovery' && message.params?.tabId === 7;
      }), 'account switches arm background recovery before refreshing');
      pageReload.mock.mockImplementation(async () => { throw new Error('No content script'); });
      await act(async () => switchAccount(child.id));
      assert.equal(nativeReloads, 1, 'tabs without a bridge still refresh');
      pageReload.mock.mockImplementation(async () => undefined);
      await act(async () => switchAccount(parent.id));
      assert.equal(nativeReloads, 2, 'an absent acknowledgement also falls back');
      assert.equal(selectedId, parent.id);
      assert.equal(dom.window.document.body.textContent, 'followSuggestions');
    } finally {
      activeTabQuery.mock.restore();
      pageReload.mock.restore();
      if (originalReload) Object.defineProperty(browser.tabs, 'reload', originalReload);
      else Reflect.deleteProperty(browser.tabs, 'reload');
    }
    // The account picker keeps deletion in a sibling modal, even with a long list.
    const {default:AccountDropdown}=await import('../src/screens/TopBar/AccountDropdown');
    let closed=0, removedId='';
    const sendMock=t.mock.method(browser.runtime,'sendMessage',async(message: {method?:string;params?:{accountId?:string}})=>{
      if(message.method === 'vault_removeAccount') {
        removedId=message.params?.accountId || '';
        return {error:'Removal failed'};
      }
      return {result:false};
    });
    await act(async()=>{root.render(createElement(AccountProvider,null,createElement(AccountDropdown,{onClose(){closed++;},onAddAccount(){}})));});
    const remove=dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="account.remove"]')!;
    await act(async()=>remove.click());
    const dialogs=dom.window.document.querySelectorAll('[role="dialog"]');
    assert.equal(dialogs.length,2);
    assert.match(dialogs[1].textContent || '',/account.removeSeedWarning/);
    assert.doesNotMatch(dialogs[1].textContent || '',/account.removeKeyWarning/);
    assert.equal(dialogs[0].contains(dialogs[1]),false,'confirmation must not be inside the scrolling picker');
    const {readFileSync}=await import('node:fs');
    const theme=readFileSync(new URL('../src/styles/theme.css',import.meta.url),'utf8');
    const defaultLayer=Number(theme.match(/--modal-z:\s*(\d+)/)![1]);
    const layer=(dialog:Element)=>Number((dialog.parentElement as HTMLElement).style.getPropertyValue('--modal-z') || defaultLayer);
    assert.ok(layer(dialogs[1]) >= layer(dialogs[0]),'later sibling confirmation must paint above the picker');

    const confirm=Array.from(dialogs[1].querySelectorAll('button')).find(button=>button.textContent==='common.remove')!;
    await act(async()=>confirm.click());
    assert.equal(removedId,parent.id);
    assert.equal(closed,0,'failed removal keeps the picker open');
    assert.match(dom.window.document.body.textContent || '',/Removal failed/);
    assert.equal((await browser.storage.local.get('accounts')).accounts.length,2);
    await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(dom.window.document.querySelectorAll('[role="dialog"]').length,1);
    assert.equal(closed,0,'Escape dismisses only the confirmation');
    sendMock.mock.restore();

    // One-time approval and the explicit remembered permission stay separate.
    const {default:EventDetailModal}=await import('../src/components/EventDetailModal');
    let always=0, once=0;
    await act(async()=>root.render(createElement(EventDetailModal,{
      request:{type:'signEvent',permKey:'signEvent:1',event:{kind:1}},
      onAlwaysAllow(){always++;},onApprove(){once++;}
    })));
    assert.doesNotMatch(dom.window.document.body.textContent!,/approval.alwaysAllowLabel/);
    await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="approval.approveOptions"]')!.click());
    await act(async()=>Array.from(dom.window.document.querySelectorAll('button')).find(button=>button.textContent==='approval.alwaysAllowLabel')!.click());
    assert.equal(always,1);assert.equal(once,0);
    await act(async()=>Array.from(dom.window.document.querySelectorAll('button')).find(button=>button.textContent==='approval.approveOnce')!.click());
    assert.equal(always,1);assert.equal(once,1);
    const {default:SubAccountStep}=await import('../src/screens/Wizard/SubAccountStep');
    const paths: Array<string | undefined>=[];
    let saved=0,advanced=0,savedName='';
    let releasePreview: (() => void) | undefined;
    t.mock.method(browser.runtime,'sendMessage',async(message: {method:string;params?:{derivationPath?:string;name?:string}})=>{
      if(message.method==='onboarding_generateSubAccount') {
        paths.push(message.params?.derivationPath);
        if(message.params?.derivationPath === "m/84'/0'/0'/0/0") await new Promise<void>(resolve=>{releasePreview=resolve;});
        if(message.params?.derivationPath === 'm/9') return {error:'Preview failed'};
        const derivationPath=message.params?.derivationPath || "m/44'/1237'/0'/0/1";
        return {result:{account:{...child,derivationPath},derivationPath,seedName:'My seed'}};
      }
      if(message.method==='onboarding_addToVault') {saved++;savedName=message.params?.name || '';return {result:{ok:true}};}
      return {result:false};
    });
    await act(async()=>root.render(createElement(SubAccountStep,{onNext(){advanced++;}})));
    const findButton=(label:string)=>Array.from(dom.window.document.querySelectorAll('button')).find(button=>button.textContent===label)!;
    assert.equal(findButton('common.continue').disabled,false);
    const nameInput=dom.window.document.querySelector<HTMLInputElement>('#subaccount-name')!;
    assert.ok(nameInput,'name is editable outside Advanced');
    assert.equal(nameInput.closest('details'),null);
    await act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(nameInput,'My work identity');
      nameInput.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
    const advancedDetails=dom.window.document.querySelector('details')!;
    assert.equal(advancedDetails.open,false);
    assert.equal(advancedDetails.querySelector('summary')!.textContent,'common.advanced');
    assert.doesNotMatch(dom.window.document.body.textContent || '',/wizard.subAccountType|wizard.typeLabel/);
    await act(async()=>advancedDetails.querySelector('summary')!.click());
    const edit=async(value:string)=>act(async()=>{
      const input=dom.window.document.querySelector<HTMLInputElement>('#subaccount-path')!;
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
      input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
    await edit('m/invalid');
    assert.equal(findButton('common.continue').disabled,true);
    assert.equal(findButton('wizard.previewAccount'),undefined,'preview updates automatically');
    assert.equal(paths.length,1,'invalid paths never trigger derivation');
    assert.match(dom.window.document.body.textContent || '',/wizard.invalidDerivationPath/);
    await edit("m/44'/60'/0'/0/0");
    assert.equal(findButton('common.continue').disabled,true,'editing invalidates the old preview');
    assert.match(dom.window.document.body.textContent || '',/wizard.networkPathHint/);
    const {SUBACCOUNT_PREVIEW_DELAY_MS}=await import('../src/constants/accounts.ts');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.equal(paths.at(-1),"m/44'/60'/0'/0/0");
    assert.equal(dom.window.document.querySelector('details')!.open,true,'preview does not close Advanced');
    assert.match(dom.window.document.body.textContent || '',/npub1/);
    assert.match(dom.window.document.body.textContent || '',new RegExp(child.pubkey));
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('#subaccount-name')!.value,'My work identity');
    assert.equal(findButton('common.continue').disabled,false);
    assert.equal(saved,0,'automatic previews never save an account');
    await edit("m/84'/0'/0'/0/0");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.ok(releasePreview);
    const pendingCount=paths.length;
    await edit("m/44'/501'/0'");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.equal(paths.length,pendingCount,'previews are serialized');
    await act(async()=>releasePreview!());
    assert.equal(findButton('common.continue').disabled,true,'stale reply cannot enable saving');
    assert.doesNotMatch(dom.window.document.body.textContent || '',/npub1/);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.equal(paths.at(-1),"m/44'/501'/0'");
    assert.equal(findButton('common.continue').disabled,false);
    await edit('m/9');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.match(dom.window.document.body.textContent || '',/Preview failed/);
    const failedCount=paths.length;
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    assert.equal(paths.length,failedCount,'failed previews do not retry in a loop');
    assert.equal(findButton('common.continue').disabled,true);
    await edit("m/44'/60'/0'/0/0");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,SUBACCOUNT_PREVIEW_DELAY_MS+30));});
    await act(async()=>findButton('common.continue').click());
    assert.equal(saved,1);assert.equal(advanced,1);assert.equal(savedName,'My work identity');
    const {default:RejectionNotice}=await import('../src/screens/Approval/RejectionNotice');
    const {SIGNER_REJECTIONS_KEY}=await import('../src/constants/signing.ts');
    const rejection={id:'old',timestamp:1,origin:'coracle.social',kind:1,requestedPubkey:child.pubkey,activePubkey:parent.pubkey,reason:'accountMismatch'};
    await browser.storage.local.set({[SIGNER_REJECTIONS_KEY]:[rejection]});
    let ackFails=true;
    const noticeMock=t.mock.method(browser.runtime,'sendMessage',async(message:{method:string;params?:{ids?:string[]}})=>{
      const items=(await browser.storage.local.get(SIGNER_REJECTIONS_KEY))[SIGNER_REJECTIONS_KEY] as typeof rejection[];
      if(message.method==='signer_getRejections') return {result:items};
      if(message.method==='signer_acknowledgeRejections') {
        if(ackFails) return {error:'Cannot acknowledge'};
        await browser.storage.local.set({[SIGNER_REJECTIONS_KEY]:items.filter(item=>!message.params?.ids?.includes(item.id))});
        return {result:{ok:true}};
      }
      return {result:false};
    });
    await act(async()=>root.render(createElement(RejectionNotice)));
    assert.match(dom.window.document.body.textContent || '',/coracle.social/);
    await act(async()=>findButton('common.close').click());
    assert.ok(dom.window.document.querySelector('[role="dialog"]'),'failed acknowledgement keeps notice visible');
    assert.match(dom.window.document.body.textContent || '',/common.error/);
    ackFails=false;
    await act(async()=>findButton('common.close').click());
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    noticeMock.mock.restore();



  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});

it('shared dialogs space body sections and both stacked and row actions', async () => {
  const {JSDOM}=await import('jsdom');
  const {default:Modal}=await import('../src/components/Modal');
  const {default:ConfirmDialog}=await import('../src/components/ConfirmDialog');
  const {default:PqcExportModal}=await import('../src/screens/Settings/PqcExportModal');
  const {default:PqcHowItWorks}=await import('../src/screens/Settings/PqcHowItWorks');
  for (const Component of [PqcExportModal,PqcHowItWorks]) {
    const dom=new JSDOM(renderToStaticMarkup(createElement(Component,{onClose(){}})));
    try {
      const body=dom.window.document.querySelector('[role="dialog"]')!.children[1];
      const sections=body.firstElementChild!;
      assert.match(sections.className,/gap-6/);
      assert.ok(sections.children.length > 1);
      for (const section of sections.children) assert.doesNotMatch(section.className,/(?:^|\s)(?:mt|mb|my)-[1-9]/,'shared spacing replaces outer margins');
    } finally {dom.window.close();}
  }

  const footer=createElement('button',null,'First');
  for (const footerRow of [false,true]) {
    const dom=new JSDOM(renderToStaticMarkup(createElement(Modal,{onClose(){},footerRow,
      footer:createElement('div',null,footer)},createElement('p',null,'Introduction'),createElement('p',null,'More details'))));
    try {
      const intro=dom.window.document.querySelector('p')!;
      assert.match(intro.parentElement!.className,/gap-6/,'body sections share a spacing container');
      const actions=dom.window.document.querySelector('button')!.parentElement!.parentElement!;
      assert.match(actions.className,/flex/);
      assert.match(actions.className,/gap-4/,'both footer orientations separate their actions');
      if (!footerRow) assert.match(actions.className,/flex-col/);
    } finally {dom.window.close();}
  }
  const dom=new JSDOM(renderToStaticMarkup(createElement(ConfirmDialog,{title:'Remove',onConfirm(){},onCancel(){},
    message:createElement('div',null,'Warning'),error:'Try again'})));
  try {
    const buttons=Array.from(dom.window.document.querySelectorAll('button'));
    const cancel=buttons.find(button=>button.textContent==='common.cancel')!;
    assert.match(cancel.parentElement!.className,/gap-4/);
    assert.doesNotMatch(cancel.parentElement!.className,/flex-col/,'confirmation actions use an equal-width row');
    const warning=Array.from(dom.window.document.querySelectorAll('div')).find(node=>node.textContent==='Warning' && node.children.length===0)!;
    assert.match(warning.parentElement!.className,/gap-6/,'rich confirmation messages separate their blocks');
  } finally {dom.window.close();}
});

it('rejection summaries reuse kind labels and show both accounts without payloads', async () => {
  const { RejectionList } = await import('../src/screens/Approval/RejectionNotice');
  const html=renderToStaticMarkup(createElement(RejectionList,{items:[{
    id:'rejected',timestamp:1,origin:'coracle.social',kind:1,
    requestedPubkey:'11'.repeat(32),activePubkey:'22'.repeat(32),reason:'accountMismatch'
  }]}));
  assert.match(html,/coracle.social/);
  assert.match(html,/approval.accountMismatchReason/);
  assert.match(html,/approval.requestedAccount/);
  assert.match(html,/approval.extensionAccount/);
  assert.match(html,/npub/);
});


it('wallet profile address status follows cached publication, reopening and account changes', async () => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: ProfileAddressButton } = await import('../src/screens/Wallet/ProfileAddressButton');
  const { default: browser, resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, { window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true }, IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = (pubkey = 'a', cachedAddress?: string) => root.render(createElement(ProfileAddressButton, { key: pubkey, pubkey, address: 'alice@wallet.test', cachedAddress, onAdd() {} }));
  const button = () => dom.window.document.querySelector('button')!;
  try {
    await act(async () => render('a', 'alice@wallet.test'));
    assert.equal(button().disabled, true);
    assert.match(button().textContent!, /wallet.addedToProfile/);
    await act(async () => browser.storage.local.set({ profile_a: { metadata: { lud16: 'elsewhere@wallet.test' }, fetchedAt: 1 } }));
    assert.equal(button().disabled, false);
    await act(async () => browser.storage.local.set({ profile_a: { metadata: { lud16: 'alice@wallet.test' }, fetchedAt: 2 } }));
    assert.equal(button().disabled, true, 'publishing updates the visible status');
    await act(async () => root.render(null));
    await act(async () => render());
    assert.equal(button().disabled, true, 'published status survives reopening');
    await act(async () => render('b'));
    assert.equal(button().disabled, false, 'another account does not inherit the published status');
    await act(async () => browser.storage.local.set({ profile_b: { metadata: {}, fetchedAt: 3 } }));
    assert.equal(button().disabled, false, 'a profile without lud16 offers publication');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    dom.window.close();
  }
});

it('approval sheet separates current-request approval from remembered permissions', async t => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AccountProvider } = await import('../src/context/AccountContext');
  const { VaultProvider } = await import('../src/context/VaultContext');
  const { PermissionsProvider } = await import('../src/context/PermissionsContext');
  const { default: ApprovalOverlay } = await import('../src/screens/Approval/ApprovalOverlay');
  const { default: browser } = await import('./helpers/browser-mock');
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
  const originalMessages=browser.runtime.onMessage;
  Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:{addListener(){},removeListener(){}}});
  const account={id:'approval-test',type:'imported',pubkey:'11'.repeat(32),name:'Test'};
  await browser.storage.local.set({accounts:[account],activeAccountId:account.id,profileCache:{}});
  let pending: Array<Omit<PendingRequest, 'timestamp'>>=[{id:'one',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,event:{kind:1,pubkey:account.pubkey,content:'test',tags:[]}}];
  const calls: Array<{method:string;params?:any}> = [];
  t.mock.method(browser.runtime,'sendMessage',async(message:{method:string;params?:any})=>{
    calls.push(message);
    if(message.method==='signer_getPending') return {result:pending};
    if(message.method==='vault_getState') return {result:{exists:true,locked:false}};
    if(message.method==='signer_getPermissionsRaw') return {result:{}};
    if(message.method==='signer_getUseGlobalDefaults') return {result:false};
    if(message.method==='signer_resolve') pending=pending.filter(r=>r.id!==message.params.id);
    if(message.method==='signer_resolveBatch') pending=[];
    return {result:null};
  });
  const root=createRoot(dom.window.document.getElementById('root')!);
  const render=()=>createElement(AccountProvider,null,createElement(VaultProvider,null,createElement(PermissionsProvider,null,createElement(ApprovalOverlay))));
  try {
    await act(async()=>root.render(render()));
    const button=(label:string)=>Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent===label);
    assert.ok(button('approval.approveOnce'),'single request has an explicit one-time action');
    assert.equal(button('approval.alwaysAllowLabel'),undefined,'remembered permission is behind the arrow');
    assert.ok(dom.window.document.querySelector('[aria-label="approval.approveOptions"]'));
    const card=Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent?.includes('https://site.test'));
    assert.ok(card, 'pending group is rendered');
    const approve=button('approval.approveOnce')!;
    assert.ok(approve.compareDocumentPosition(card) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    await act(async()=>button('approval.approveOnce')!.click());
    assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params),[{id:'one',decision:{allow:true,remember:false}}]);
    assert.equal(calls.filter(c=>c.method==='signer_savePermission'||c.method==='signer_resolveBatch').length,0);
    await act(async()=>root.render(null));
    pending=[{id:'two',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,event:{kind:1,pubkey:account.pubkey,content:'test',tags:[]}}];
    await act(async()=>root.render(render()));
    await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="approval.approveOptions"]')!.click());
    assert.ok(dom.window.document.querySelector('[role="menu"]'));
    await act(async()=>button('approval.alwaysAllowLabel')!.click());
    assert.deepEqual(calls.find(c=>c.method==='signer_savePermission')?.params,{domain:'https://site.test',methodName:'signEvent:1',decision:'allow',accountId:account.id});
    for (const remember of [false, true]) {
      await act(async()=>root.render(null));
      calls.length = 0;
      pending=[{id:'reject',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,event:{kind:1,pubkey:account.pubkey,content:'test',tags:[]}}];
      await act(async()=>root.render(render()));
      assert.equal(button('approval.alwaysDenyLabel'),undefined);
      if (remember) {
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="approval.rejectOptions"]')!.click());
        assert.ok(dom.window.document.querySelector('[role="menu"]'));
        await act(async()=>button('approval.alwaysDenyLabel')!.click());
        assert.deepEqual(calls.find(c=>c.method==='signer_resolveBatch')?.params,{origin:'https://site.test',permKey:'signEvent:1',decision:{allow:false,remember:false}});
        assert.deepEqual(calls.find(c=>c.method==='signer_savePermission')?.params,{domain:'https://site.test',methodName:'signEvent:1',decision:'deny',accountId:account.id});
      } else {
        await act(async()=>button('approval.rejectAll')!.click());
        assert.deepEqual(calls.find(c=>c.method==='signer_resolve')?.params,{id:'reject',decision:{allow:false,remember:false}});
        assert.equal(calls.some(c=>c.method==='signer_savePermission'),false);
      }
    }

    for (const always of [false, true]) {
      await act(async()=>root.render(null));
      calls.length=0;
      pending=[{id:'danger',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:3',needsPermission:true,event:{kind:3,pubkey:account.pubkey,content:'',tags:[]},followReplacementCount:500,followReplacementNewCount:0}];
      pending=[pending[0],{...pending[0],id:'danger2'},{...pending[0],id:'danger3'}];
      await act(async()=>root.render(render()));
      assert.match(dom.window.document.body.textContent!,/approval.followReplacementWarning/,'warning is visible without opening details');
      const approve = async () => {
        if (always) {
          await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="approval.approveOptions"]')!.click());
          await act(async()=>button('approval.alwaysAllowLabel')!.click());
        } else await act(async()=>button('approval.approveShown')!.click());
      };
      await approve();
      assert.ok(button('approval.followReplacementConfirm'),'a separate confirmation is required');
      const confirmation=button('approval.followReplacementConfirm')!.closest('[role="dialog"]')!;
      assert.equal((confirmation.textContent!.match(/approval.followReplacementWarning/g)||[]).length,1,'identical warnings appear once in the confirmation');
      assert.match(dom.window.document.body.textContent!,/approval.followReplacementWarning/);
      assert.equal(calls.some(c=>c.method==='signer_resolve'||c.method==='signer_savePermission'),false);
      await act(async()=>button('common.cancel')!.click());
      assert.equal(calls.some(c=>c.method==='signer_resolve'),false,'cancel leaves the request unsigned');
      await approve();
      await act(async()=>button('approval.followReplacementConfirm')!.click());
      assert.deepEqual(calls.find(c=>c.method==='signer_resolve')?.params,{id:'danger',decision:{allow:true,remember:false,confirmFollowReplacement:true}});
      assert.equal(calls.some(c=>c.method==='signer_savePermission'),always);
      assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params.id),['danger','danger2','danger3'],'all displayed requests still receive explicit confirmation');
    }

    for (const allow of [true, false]) {
      await act(async()=>root.render(null));
      calls.length = 0;
      pending=[1, 4].map(kind=>({id:`kind-${kind}`,accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:`signEvent:${kind}`,needsPermission:true,event:{kind,pubkey:account.pubkey,content:'test',tags:[]}}));
      await act(async()=>root.render(render()));
      await act(async()=>dom.window.document.querySelector<HTMLButtonElement>(`[aria-label="approval.${allow ? 'approveOptions' : 'rejectOptions'}"]`)!.click());
      const menu = dom.window.document.querySelector('[role="menu"]')!;
      const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      assert.equal(items.length, 2, 'each pending type has its own remembered action');
      assert.match(menu.parentElement!.className, /w-full/, 'menu matches its split button anchor');
      await act(async()=>items[1].click());
      assert.deepEqual(calls.find(c=>c.method==='signer_savePermission')?.params,{domain:'https://site.test',methodName:'signEvent:4',decision:allow?'allow':'deny',accountId:account.id});
      assert.equal(calls.filter(c=>c.method==='signer_savePermission').length, 1, 'other types are not granted or denied');
    }

  } finally {
    await act(async()=>root.unmount());dom.window.close();
    Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:originalMessages});
    for(const [key,descriptor] of previous) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});

it('pending cards show dangerous reductions even after an ordinary first request, without repeating identical warnings',async()=>{
 const {default:ApprovalCard}=await import('../src/screens/Approval/ApprovalCard');
 const normal={id:'normal',type:'signEvent',origin:'site.test',timestamp:1};
 const dangerous={...normal,id:'danger',followReplacementCount:546,followReplacementNewCount:0};
 const group={origin:'site.test',method:'signEvent',permKey:'signEvent:3',requests:[normal,dangerous,{...dangerous,id:'duplicate'}]};
 const html=renderToStaticMarkup(createElement(ApprovalCard,{group,onClick(){}}));
 assert.equal((html.match(/approval.followReplacementWarning/g)||[]).length,1);
 assert.match(html,/text-error/);
 const safe=renderToStaticMarkup(createElement(ApprovalCard,{group:{...group,requests:[normal]},onClick(){}}));
 assert.doesNotMatch(safe,/approval.followReplacementWarning/);
});

// Mounted popup flows use the same DOM event path as the existing wizard tests.
async function mountWalletFlow() {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, { window: { value: dom.window, configurable: true }, document: { value: dom.window.document, configurable: true }, IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true } });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const button = (label: string) => Array.from(dom.window.document.querySelectorAll('button')).find(item => item.textContent === label)!;
  return {
    dom, root, act, button,
    async edit(value: string) {
      await act(async () => {
        const input = dom.window.document.querySelector('input')!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async cleanup() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

it('NWC setup validates locally, preserves failures and connects once with the trimmed URI', async t => {
  const { default: WalletSetup } = await import('../src/screens/Wallet/WalletSetup');
  const { default: browser } = await import('./helpers/browser-mock');
  const ui = await mountWalletFlow();
  const calls: unknown[] = [];
  let reply!: (value: unknown) => void;
  let connected = 0;
  t.mock.method(browser.runtime, 'sendMessage', (message: unknown) => {
    calls.push(message);
    return new Promise(resolve => { reply = resolve; });
  });
  try {
    await ui.act(async () => ui.root.render(createElement(WalletSetup, { onConnected() { connected++; } })));
    if (ui.button('common.gotIt')) await ui.act(async () => ui.button('common.gotIt').click());
    const advanced = () => Array.from(ui.dom.window.document.querySelectorAll('button')).find(button => button.textContent?.startsWith('wallet.advancedSettings'))!;
    assert.equal(ui.dom.window.document.querySelector('input'), null);
    await ui.act(async () => advanced().click());
    assert.ok(ui.dom.window.document.querySelector('input'), 'advanced instance URL expands');
    await ui.act(async () => advanced().click());
    assert.equal(ui.dom.window.document.querySelector('input'), null, 'advanced instance URL collapses');
    await ui.act(async () => ui.button('LNbits').click());
    const adminKey = ui.dom.window.document.querySelector<HTMLInputElement>('input[type="password"]')!;
    const adminLabel = Array.from(ui.dom.window.document.querySelectorAll('label')).find(label => label.textContent === 'wallet.adminKey')!;
    assert.equal(adminLabel.control, adminKey);
    assert.equal(ui.dom.window.document.getElementById(adminKey.getAttribute('aria-describedby')!)!.textContent, 'wallet.lnbitsAdminKeyHint');
    await ui.act(async () => ui.button('NWC').click());
    const connectionLabel = Array.from(ui.dom.window.document.querySelectorAll('label')).find(label => label.textContent === 'wallet.nwcUri')!;
    assert.equal(connectionLabel.control, ui.dom.window.document.querySelector('input'), 'NWC connection has an associated label');
    assert.match(ui.dom.window.document.body.textContent!, /wallet.nwcSetupHint/);
    assert.equal(ui.button('common.connect').disabled, true);
    await ui.edit('https://not-a-wallet.test');
    await ui.act(async () => ui.button('common.connect').click());
    assert.match(ui.dom.window.document.body.textContent!, /wallet.invalidNwc/);
    assert.equal(calls.length, 0);
    const uri = `nostr+walletconnect://${'11'.repeat(32)}?relay=wss%3A%2F%2Fwallet.test&secret=${'22'.repeat(32)}`;
    await ui.edit(`  ${uri}  `);
    await ui.act(async () => ui.button('common.connect').click());
    assert.equal(ui.button('common.loading').disabled, true);
    await ui.act(async () => ui.button('common.loading').click());
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0] as { params: unknown }).params, { walletConfig: { type: 'nwc', connectionString: uri } });
    await ui.act(async () => reply({ error: 'Wallet relay unavailable' }));
    assert.equal(connected, 0);
    assert.match(ui.dom.window.document.body.textContent!, /Wallet relay unavailable/);
    assert.equal(ui.button('common.connect').disabled, false);
    await ui.act(async () => ui.button('common.connect').click());
    await ui.act(async () => reply({ result: { ok: true } }));
    assert.equal(connected, 1);
    assert.equal(calls.length, 2, 'only an explicit retry reconnects');
  } finally { await ui.cleanup(); }
});

it('send dialog cannot be dismissed or pay again during a pending payment and reports the final result', async t => {
  const { default: SendDialog } = await import('../src/screens/Wallet/SendDialog');
  const { default: browser } = await import('./helpers/browser-mock');
  const { bech32 } = await import('@scure/base');
  const invoice = bech32.encode('lnbc10n', [...Array(7).fill(0), ...Array(104).fill(0)], 2000);
  const ui = await mountWalletFlow();
  let sent = 0, closed = 0, payments = 0;
  let reply!: (value: unknown) => void;
  t.mock.method(browser.runtime, 'sendMessage', (message: { method: string; params: unknown }) => {
    assert.equal(message.method, 'wallet_payInvoice');
    assert.deepEqual(message.params, { bolt11: invoice });
    payments++;
    return new Promise(resolve => { reply = resolve; });
  });
  try {
    await ui.act(async () => ui.root.render(createElement(SendDialog, { onClose() { closed++; }, onSent() { sent++; } })));
    await ui.edit('not an invoice');
    assert.equal(ui.button('wallet.confirmPay').disabled, true);
    await ui.edit(invoice);
    await ui.act(async () => ui.button('wallet.confirmPay').click());
    assert.equal(ui.button('common.loading').disabled, true);
    await ui.act(async () => {
      ui.button('common.loading').click();
      ui.button('common.cancel').click();
      ui.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="common.close"]')!.click();
      ui.dom.window.document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      ui.dom.window.document.querySelector('[role="dialog"]')!.parentElement!.dispatchEvent(new ui.dom.window.MouseEvent('mousedown', { bubbles: true }));
    });
    assert.equal(payments, 1);
    assert.equal(closed, 0, 'every dismissal route is blocked until the payment resolves');
    await ui.act(async () => reply({ error: 'Insufficient balance' }));
    assert.equal(sent, 0);
    assert.match(ui.dom.window.document.body.textContent!, /Insufficient balance/);
    assert.equal(ui.button('wallet.confirmPay').disabled, false);
    await ui.act(async () => ui.button('wallet.confirmPay').click());
    await ui.act(async () => reply({ result: { preimage: 'synthetic' } }));
    assert.equal(payments, 2);
    assert.equal(sent, 1);
    assert.match(ui.dom.window.document.body.textContent!, /wallet.paymentSent/);
    assert.equal(ui.button('wallet.confirmPay'), undefined);
    await ui.act(async () => ui.button('common.close').click());
    assert.equal(closed, 1);
  } finally { await ui.cleanup(); }
});

it('receive dialog rejects fractional or unsafe sats without silently changing the requested amount', async t => {
  const { default: DepositDialog } = await import('../src/screens/Wallet/DepositDialog');
  const { default: browser } = await import('./helpers/browser-mock');
  const ui = await mountWalletFlow();
  const calls: unknown[] = [];
  t.mock.method(browser.runtime, 'sendMessage', async (message: unknown) => {
    calls.push(message);
    return { error: 'Invoice creation unavailable' };
  });
  try {
    await ui.act(async () => ui.root.render(createElement(DepositDialog, { onClose() {}, onPaid() {} })));
    for (const value of ['', '0', '-1', '1.9', '9007199254740992']) {
      await ui.edit(value);
      assert.equal(ui.button('wallet.createInvoice').disabled, true, `reject ${value}`);
      await ui.act(async () => ui.button('wallet.createInvoice').click());
    }
    assert.equal(calls.length, 0);
    await ui.edit('21');
    await ui.act(async () => ui.button('wallet.createInvoice').click());
    assert.deepEqual((calls[0] as { params: unknown }).params, { amount: 21, memo: 'Deposit' });
    assert.match(ui.dom.window.document.body.textContent!, /Invoice creation unavailable/);
    assert.equal(ui.button('wallet.createInvoice').disabled, false);
  } finally { await ui.cleanup(); }
});

it('receive polling tolerates failures, announces settlement once and ignores replies after closing', async t => {
  const { default: DepositDialog } = await import('../src/screens/Wallet/DepositDialog');
  const { default: browser } = await import('./helpers/browser-mock');
  const ui = await mountWalletFlow();
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let received = 0, closed = 0, checks = 0;
  let reply!: (value: unknown) => void;
  t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string; params: unknown }) => {
    if (message.method === 'wallet_makeInvoice') return { result: { bolt11: 'synthetic-invoice', paymentHash: 'test-hash' } };
    assert.equal(message.method, 'wallet_checkInvoice');
    assert.deepEqual(message.params, { paymentHash: 'test-hash' });
    checks++;
    if (checks === 1) return { error: 'Relay temporarily offline' };
    if (checks === 2) return { result: { paid: false } };
    return new Promise(resolve => { reply = resolve; });
  });
  const open = async () => {
    await ui.act(async () => ui.root.render(createElement(DepositDialog, { onClose() { closed++; }, onPaid() { received++; } })));
    await ui.edit('21');
    await ui.act(async () => ui.button('wallet.createInvoice').click());
  };
  try {
    await open();
    assert.match(ui.dom.window.document.body.textContent!, /synthetic-invoice/);
    for (let i = 0; i < 3; i++) await ui.act(async () => t.mock.timers.tick(2000));
    assert.equal(received, 0, 'neither failures nor pending invoices are payments');
    await ui.act(async () => reply({ result: { paid: true } }));
    assert.equal(received, 1);
    assert.match(ui.dom.window.document.body.textContent!, /wallet.paymentReceived/);
    assert.match(ui.dom.window.document.body.textContent!, /\+21/,'missing amountPaid uses the invoice amount');
    await ui.act(async () => t.mock.timers.tick(2499));
    assert.equal(closed, 0);
    await ui.act(async () => t.mock.timers.tick(1));
    assert.equal(closed, 1);
    assert.equal(checks, 3, 'settlement stops polling');
    await ui.act(async () => ui.root.render(null));
    await open();
    await ui.act(async () => t.mock.timers.tick(2000));
    assert.equal(checks, 4);
    await ui.act(async () => ui.root.render(null));
    await ui.act(async () => reply({ result: { paid: true, amountPaid: 50 } }));
    await ui.act(async () => t.mock.timers.tick(10000));
    assert.equal(received, 1, 'closed invoice cannot deliver a late success callback');
    assert.equal(closed, 1);
    assert.equal(checks, 4, 'unmount cancels future polling');
  } finally { await ui.cleanup(); t.mock.timers.reset(); }
});

it('an ambiguous payment outcome blocks further payments in the current dialog even after editing', async t => {
  const { default: SendDialog } = await import('../src/screens/Wallet/SendDialog');
  const { default: browser } = await import('./helpers/browser-mock');
  const { bech32 } = await import('@scure/base');
  const invoice = bech32.encode('lnbc10n', [...Array(7).fill(0), ...Array(104).fill(0)], 2000);
  const ui = await mountWalletFlow();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let payments = 0, closed = 0, sent = 0;
  t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string; params: { intentId?: string; address?: string } }) => {
    if (message.method === 'wallet_resolveLightningAddress') return { result: {
      address: 'alice@wallet.test', domain: 'wallet.test', description: 'Test recipient',
      minSats: 1, maxSats: 100, commentAllowed: 0, allowsNostr: false,
    } };
    assert.equal(message.method, 'wallet_payToLightningAddress');
    assert.equal(message.params.address, 'alice@wallet.test');
    assert.ok(message.params.intentId, 'the address payment has a replay identifier');
    payments++;
    return { error: 'PAYMENT_OUTCOME_UNKNOWN' };
  });
  try {
    await ui.act(async () => ui.root.render(createElement(SendDialog, { onClose() { closed++; }, onSent() { sent++; } })));
    await ui.edit('alice@wallet.test');
    await ui.act(async () => t.mock.timers.tick(400));
    await ui.act(async () => ui.button('wallet.confirmPay').click());
    assert.equal(sent, 0);
    assert.equal(ui.button('wallet.confirmPay').disabled, true, 'uncertain payment cannot be retried with a fresh intent');
    assert.match(ui.dom.window.document.body.textContent!, /wallet.paymentOutcomeUnknown/);
    await ui.edit('');
    await ui.edit(invoice);
    assert.equal(ui.button('wallet.confirmPay').disabled, true, 'editing does not erase uncertainty');
    await ui.act(async () => ui.button('wallet.confirmPay').click());
    assert.equal(payments, 1);
    await ui.act(async () => ui.button('common.cancel').click());
    assert.equal(closed, 1, 'user can leave to check wallet history');
  } finally { await ui.cleanup(); t.mock.timers.reset(); }
});

it('wallet connection help can be dismissed, remembered and reopened while guides open in background tabs', async t => {
  const { default: WalletSetup } = await import('../src/screens/Wallet/WalletSetup');
  const { default: browser, resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const ui = await mountWalletFlow();
  const created = t.mock.method(browser.tabs, 'create', async () => ({ id: 7 }));
  const render = async () => ui.act(async () => ui.root.render(createElement(WalletSetup, { onConnected() {} })));
  const dialog = () => ui.dom.window.document.querySelector('[role="dialog"]');
  try {
    await render();
    assert.ok(dialog(), 'first visit opens the explanation');
    await ui.act(async () => ui.button('wallet.albyGuide').click());
    assert.deepEqual(created.mock.calls[0].arguments, [{ url: 'https://nostr-wot.com/guides/alby-hub-nwc', active: false }]);
    assert.ok(dialog(), 'opening a guide leaves the help visible');
    assert.match(dialog()!.textContent!, /wallet.guideOpened/);
    created.mock.mockImplementation(async () => { throw new Error('Tab creation failed'); });
    await ui.act(async () => ui.button('wallet.albyGuide').click());
    assert.match(dialog()!.textContent!, /wallet.guideOpenFailed/);
    assert.doesNotMatch(dialog()!.textContent!, /wallet.guideOpened/);
    created.mock.mockImplementation(async () => ({ id: 7 }));
    await ui.act(async () => ui.button('common.gotIt').click());
    assert.equal(dialog(), null);
    await ui.act(async () => ui.root.render(null));
    await render();
    assert.ok(dialog(), 'dismissal without opting out permits the next explanation');
    await ui.act(async () => ui.dom.window.document.querySelector<HTMLInputElement>('[aria-label="wallet.dontShowAgain"]')!.click());
    const failedSave = t.mock.method(browser.storage.local, 'set', async () => { throw new Error('Preference write failed'); });
    await ui.act(async () => ui.button('common.gotIt').click());
    assert.ok(dialog(), 'failed persistence keeps the dialog open');
    assert.match(dialog()!.textContent!, /Preference write failed/);
    failedSave.mock.restore();
    await ui.act(async () => ui.button('common.gotIt').click());
    assert.equal(dialog(), null);
    await ui.act(async () => ui.root.render(null));
    await render();
    assert.equal(dialog(), null, 'opt-out survives remount');
    await ui.act(async () => ui.button('NWC').click());
    await ui.edit('draft-connection');
    await ui.act(async () => ui.dom.window.document.querySelector<HTMLButtonElement>('[aria-label="wallet.connectionHelpTitle"]')!.click());
    assert.ok(dialog(), 'info button always reopens help');
    await ui.act(async () => ui.button('wallet.lnbitsNwcGuide').click());
    await ui.act(async () => ui.button('wallet.lnbitsApiGuide').click());
    assert.deepEqual(created.mock.calls.slice(-2).map(call => call.arguments), [
      [{ url: 'https://nostr-wot.com/guides/lnbits-wallet-setup#lnbits-nwc', active: false }],
      [{ url: 'https://nostr-wot.com/guides/lnbits-wallet-setup#lnbits-api', active: false }],
    ]);
    const { setLanguage } = await import('../src/services/i18n/i18n');
    t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
    for (const language of ['en', 'es', 'de', 'fr', 'it', 'pt', 'unsupported']) {
      await ui.act(async () => { await setLanguage(language); });
      const prefix = language === 'en' || language === 'unsupported' ? '' : `/${language}`;
      for (const [label, path] of [
        ['wallet.albyGuide', 'alby-hub-nwc'],
        ['wallet.lnbitsNwcGuide', 'lnbits-wallet-setup#lnbits-nwc'],
        ['wallet.lnbitsApiGuide', 'lnbits-wallet-setup#lnbits-api'],
      ]) {
        await ui.act(async () => ui.button(label).click());
        assert.deepEqual(created.mock.calls.at(-1)!.arguments, [{ url: `https://nostr-wot.com${prefix}/guides/${path}`, active: false }]);
      }
    }
    await ui.act(async () => { await setLanguage('en'); });
    await ui.act(async () => ui.button('common.gotIt').click());
    assert.equal(ui.dom.window.document.querySelector('input')!.value, 'draft-connection', 'help and background guides preserve the connection draft');
  } finally { await ui.cleanup(); }
});

it('shared modal contains keyboard focus, skips unavailable controls and restores its opener', async () => {
  const { default: Modal } = await import('../src/components/Modal');
  const { default: Toggle } = await import('../src/components/Toggle');
  const ui = await mountWalletFlow();
  const opener = ui.dom.window.document.createElement('button');
  ui.dom.window.document.body.prepend(opener); opener.focus();
  const tab = (shiftKey = false) => {
    const event = new ui.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    ui.dom.window.document.activeElement!.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  try {
    await ui.act(async () => ui.root.render(createElement(Modal, { onClose() {} },
      createElement('button', { disabled: true }, 'disabled'),
      createElement('div', { hidden: true }, createElement('button', {}, 'hidden')),
      createElement('button', {}, 'first'),
      createElement(Toggle, { 'aria-label': 'remember', checked: false }),
      createElement('button', {}, 'last'))));
    const dialog = ui.dom.window.document.querySelector('[role="dialog"]')!;
    assert.ok(ui.dom.window.document.activeElement === dialog);
    tab(); assert.ok(ui.dom.window.document.activeElement === ui.button('first'));
    tab(); assert.equal(ui.dom.window.document.activeElement?.getAttribute('aria-label'), 'remember');
    tab(); assert.ok(ui.dom.window.document.activeElement === ui.button('last'));
    tab(); assert.ok(ui.dom.window.document.activeElement === ui.button('first'));
    tab(true); assert.ok(ui.dom.window.document.activeElement === ui.button('last'));
    opener.focus(); assert.ok(ui.dom.window.document.activeElement === dialog, 'focus cannot escape to the page');
    await ui.act(async () => ui.root.render(null));
    assert.ok(ui.dom.window.document.activeElement === opener);
  } finally { await ui.cleanup(); }
});

it('only the visually topmost modal handles focus and Escape, including later lower overlays', async () => {
  const { default: Modal } = await import('../src/components/Modal');
  const ui = await mountWalletFlow();
  const opener = ui.dom.window.document.createElement('button');
  ui.dom.window.document.body.prepend(opener); opener.focus();
  let upperClosed = 0, lowerClosed = 0;
  const upper = createElement(Modal, { key: 'upper', title: 'upper', zIndex: 1000, onClose() { upperClosed++; } }, createElement('button', {}, 'upper action'));
  const lower = createElement(Modal, { key: 'lower', title: 'lower', zIndex: 700, onClose() { lowerClosed++; } }, createElement('button', {}, 'lower action'));
  try {
    await ui.act(async () => ui.root.render(upper));
    ui.button('upper action').focus();
    await ui.act(async () => ui.root.render([upper, lower]));
    assert.ok(ui.dom.window.document.activeElement === ui.button('upper action'), 'later lower modal must not steal focus');
    ui.dom.window.document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(upperClosed, 1); assert.equal(lowerClosed, 0);
    await ui.act(async () => ui.root.render(lower));
    assert.equal(ui.dom.window.document.activeElement?.getAttribute('aria-label'), 'lower');
    await ui.act(async () => ui.root.render(null));
    assert.ok(ui.dom.window.document.activeElement === opener);
  } finally { await ui.cleanup(); }
});

it('stacked modal restores its parent control, then the original opener', async () => {
  const { default: Modal } = await import('../src/components/Modal');
  const ui = await mountWalletFlow();
  const opener = ui.dom.window.document.createElement('button');
  ui.dom.window.document.body.prepend(opener); opener.focus();
  const parent = createElement(Modal, { key: 'parent', onClose() {} }, createElement('button', {}, 'child opener'));
  const child = createElement(Modal, { key: 'child', onClose() {} }, createElement('button', {}, 'child action'));
  try {
    await ui.act(async () => ui.root.render(parent)); ui.button('child opener').focus();
    await ui.act(async () => ui.root.render([parent, child]));
    await ui.act(async () => ui.root.render(parent));
    assert.ok(ui.dom.window.document.activeElement === ui.button('child opener'));
    await ui.act(async () => ui.root.render(null));
    assert.ok(ui.dom.window.document.activeElement === opener);
  } finally { await ui.cleanup(); }
});

it('nested modal remains topmost despite child effects mounting before parent effects', async () => {
  const { default: Modal } = await import('../src/components/Modal');
  const ui = await mountWalletFlow();
  const opener = ui.dom.window.document.createElement('button');
  ui.dom.window.document.body.prepend(opener); opener.focus();
  let parentClosed = 0, childClosed = 0;
  const render = (child: boolean) => createElement(Modal, { title: 'parent', onClose() { parentClosed++; } },
    createElement('button', {}, 'parent action'),
    child ? createElement(Modal, { title: 'child', onClose() { childClosed++; } }, createElement('button', {}, 'child action')) : null);
  try {
    await ui.act(async () => ui.root.render(render(true)));
    assert.equal(ui.dom.window.document.activeElement?.getAttribute('aria-label'), 'child');
    ui.dom.window.document.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(parentClosed, 0); assert.equal(childClosed, 1);
    await ui.act(async () => ui.root.render(render(false)));
    assert.equal(ui.dom.window.document.activeElement?.getAttribute('aria-label'), 'parent');
    await ui.act(async () => ui.root.render(null));
    assert.ok(ui.dom.window.document.activeElement === opener);
  } finally { await ui.cleanup(); }
});

it('modal entry and focus restoration preserve the animated popup scroll position', async (t) => {
  const { default: Modal } = await import('../src/components/Modal');
  const ui = await mountWalletFlow();
  const opener = ui.dom.window.document.createElement('button');
  ui.dom.window.document.body.prepend(opener); opener.focus();
  const focus = ui.dom.window.HTMLElement.prototype.focus;
  const moves = t.mock.method(ui.dom.window.HTMLElement.prototype, 'focus', function(this: HTMLElement, options?: FocusOptions) {
    return focus.call(this, options);
  });
  try {
    await ui.act(async () => ui.root.render(createElement(Modal, { title: 'Wallet help', onClose() {} }, 'Help')));
    assert.equal(ui.dom.window.document.activeElement?.getAttribute('role'), 'dialog');
    assert.equal(moves.mock.calls.at(-1)!.arguments[0]?.preventScroll, true, 'initial focus must not scroll an entering overlay');
    await ui.act(async () => ui.root.render(null));
    assert.equal(ui.dom.window.document.activeElement, opener);
    assert.equal(moves.mock.calls.at(-1)!.arguments[0]?.preventScroll, true, 'restoring the opener must not shift the popup');
  } finally { moves.mock.restore(); await ui.cleanup(); }
});

it('Deposit exposes the wallet address with QR/copy while retaining invoice creation', async () => {
  const {default:Deposit}=await import('../src/screens/Wallet/DepositDialog');
  const render=(extra:object)=>renderToStaticMarkup(createElement(Deposit,{onClose(){},onPaid(){},...extra}));
  const html=render({address:'alice@example.com'});
  assert.match(html,/alice@example.com/);assert.match(html,/wallet.lightningAddress/);
  assert.match(html,/aria-label="common.copy"/);assert.match(html,/<svg/);
  assert.match(html,/wallet.createInvoice/);assert.match(html,/type="number"/);
  assert.doesNotMatch(html,/wallet.receiveAddressUnavailable/);
  assert.match(render({address:null}),/wallet.receiveAddressUnavailable/);
  assert.match(render({addressError:'offline'}),/wallet.receiveAddressFailed/);
  assert.match(render({addressError:'offline'}),/common.retry/);
  assert.doesNotMatch(render({addressLoading:true}),/wallet.receiveAddressUnavailable/);
});

it('confirmed WebLN receipt identifies the site and amount without inventing an unknown amount', async () => {
  const {PaymentReceipt}=await import('../src/screens/Wallet/PaymentSuccessNotice');
  const notice={id:'id',origin:'shop.example',amount:21,timestamp:1700000000000};
  const html=renderToStaticMarkup(createElement(PaymentReceipt,{notice}));
  assert.match(html,/wallet.paymentSent/);assert.match(html,/shop.example/);assert.match(html,/21 sats/);assert.match(html,/role="status"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PaymentReceipt,{notice:{...notice,amount:0}})),/0 sats/);
  const txHtml=renderToStaticMarkup(createElement(TransactionList,{...props,transactions:[{paymentHash:'note',amount:-1,status:'settled',createdAt:1,memo:'Lunch with friends'}]}));
  assert.match(txHtml,/Lunch with friends/);assert.match(txHtml,/whitespace-pre-wrap break-words/);
});

it('WebLN receipt acknowledgement keeps later arrivals and reopening restores unread receipts', async t => {
  const {JSDOM}=await import('jsdom');
  const {act}=await import('react');
  const {default:browser}=await import('./helpers/browser-mock');
  const {default:Notice}=await import('../src/screens/Wallet/PaymentSuccessNotice');
  const dom=new JSDOM('<div id="root"></div>');
  const previous=new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(dom.window.document.getElementById('root')!);
  let items=[{id:'one',origin:'first.example',amount:21,timestamp:1}];
  t.mock.method(browser.runtime,'sendMessage',async(message:{method:string;params:{accountId:string;ids?:string[]}})=>{
    assert.equal(message.params.accountId,'account');
    if(message.method==='wallet_acknowledgePaymentNotices'){
      items.push({id:'two',origin:'second.example',amount:42,timestamp:2});
      items=items.filter(item=>!message.params.ids?.includes(item.id));
    }
    return {result:message.method==='wallet_getPaymentNotices'?[...items]:true};
  });
  try {
    await act(async()=>root.render(createElement(Notice,{accountId:'account'})));
    assert.match(dom.window.document.body.textContent!,/first.example/);
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='common.close')!.click());
    assert.doesNotMatch(dom.window.document.body.textContent!,/first.example/);
    assert.match(dom.window.document.body.textContent!,/second.example/);
    await act(async()=>root.render(null));
    await act(async()=>root.render(createElement(Notice,{accountId:'account'})));
    assert.match(dom.window.document.body.textContent!,/second.example/);
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
