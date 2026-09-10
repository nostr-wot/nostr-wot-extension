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
    const buttons=Array.from(dom.window.document.querySelectorAll('button'));
    await act(async()=>buttons.find(button=>button.textContent==='approval.alwaysAllowLabel')!.click());
    assert.equal(always,1);assert.equal(once,0);
    await act(async()=>buttons.find(button=>button.textContent==='approval.approveOnce')!.click());
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
  let pending=[{id:'one',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,event:{kind:1,pubkey:account.pubkey,content:'test',tags:[]}}];
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
    assert.ok(button('approval.alwaysAllowLabel'),'remembered permission is separate');
    await act(async()=>button('approval.approveOnce')!.click());
    assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params),[{id:'one',decision:{allow:true,remember:false}}]);
    assert.equal(calls.filter(c=>c.method==='signer_savePermission'||c.method==='signer_resolveBatch').length,0);
    await act(async()=>root.render(null));
    pending=[{id:'two',accountId:account.id,origin:'https://site.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,event:{kind:1,pubkey:account.pubkey,content:'test',tags:[]}}];
    await act(async()=>root.render(render()));
    await act(async()=>button('approval.alwaysAllowLabel')!.click());
    assert.deepEqual(calls.find(c=>c.method==='signer_savePermission')?.params,{domain:'https://site.test',methodName:'signEvent:1',decision:'allow',accountId:account.id});
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:originalMessages});
    for(const [key,descriptor] of previous) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
