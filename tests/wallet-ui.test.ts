import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TransactionList from '../src/screens/Wallet/TransactionList';
import Wallet from '../src/screens/Wallet/Wallet';
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
 const {default:WalletBalance}=await import('../src/components/WalletBalance/WalletBalance');
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
 const html=renderToStaticMarkup(createElement(AccountWalletProvider,{enabled:false},createElement(Settings,{providerType:'lnbits',onClose(){},onDisconnected(){}})));
 assert.match(html,/common.loading/); assert.doesNotMatch(html,/wallet.claimUsername/);assert.match(html,/common.save/);
});

it('wallet settings owns a bounded scroll region and explains its refresh and disconnect actions',async()=>{
 const {default:Settings}=await import('../src/screens/Wallet/WalletSettings');
 const html=renderToStaticMarkup(createElement(AccountWalletProvider,{enabled:false},createElement(Settings,{providerType:'lnbits',onClose(){},onDisconnected(){}})));
 assert.match(html,/flex-1 min-h-0 overflow-y-auto/);
 assert.match(html,/wallet.refreshSettingsHint/);assert.match(html,/wallet.disconnectHint/);
});
it('wallet copy controls use named SVG icons without rendering connection credentials',async()=>{
 const {WalletCopyButton}=await import('../src/screens/Wallet/WalletSettings');
 const html=renderToStaticMarkup(createElement(WalletCopyButton,{value:'secret-connection',label:'Copy connection'}));
 assert.match(html,/<svg/);assert.match(html,/aria-label="Copy connection"/);assert.doesNotMatch(html,/secret-connection|>Copy connection</);
});

it('Home keeps the wallet visible beside loading, restricted and disconnected site notices',async()=>{
 const {HomeWalletLayout}=await import('../src/screens/Home/Home');
 for(const notice of ['Loading site','Restricted page','Site not connected',null]) {
  const html=renderToStaticMarkup(createElement(HomeWalletLayout,{wallet:createElement('div',null,'Connected wallet'),siteNotice:notice},createElement('div',null,'Site controls')));
  assert.match(html,/Connected wallet/);
  if(notice){assert.ok(html.includes(notice));assert.doesNotMatch(html,/Site controls/);}
  else assert.match(html,/Site controls/);
 }
});

it('approval rows identify origin, action and human-readable kind',async()=>{
 const {default:ApprovalCard}=await import('../src/screens/Approval/ApprovalCard');
 const html=renderToStaticMarkup(createElement(ApprovalCard,{group:{origin:'example.com',method:'signEvent',permKey:'signEvent:1',requests:[{id:'one',origin:'example.com',type:'signEvent',eventKind:1,timestamp:1}]},onClick(){}}));
 assert.match(html,/example.com/);assert.match(html,/Short Note/);assert.match(html,/\(1\)/);assert.match(html,/approval.signEvent/);
});
