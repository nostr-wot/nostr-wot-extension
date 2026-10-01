import { it } from 'node:test';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActivityEntryDetail from '../src/components/EventDetailModal/ActivityEntryDetail';
import EventPreview from '../src/components/EventPreview';
import SiteIcon from '../src/components/SiteIcon';
import DetailDisclosure from '../src/components/DetailDisclosure';
import TextBlock from '../src/components/TextBlock';

it('text blocks preserve the entire body, whitespace and escaped content in both modes', () => {
  const body = '  First line\n<script>\n' + 'body '.repeat(500);
  for (const mono of [false, true]) {
    const html = renderToStaticMarkup(TextBlock({ children: body, mono }));
    assert.match(html, /whitespace-pre-wrap/);
    assert.match(html, /max-height:180px/);
    assert.ok(html.includes(body.replace('<script>', '&lt;script&gt;')));
    assert.doesNotMatch(html, /<script>/);
  }
});

for (const [kind, content, label] of [
  [0, '{"name":"Alice","about":"Line one\\nLine two","nip05":"alice@example.test"}', 'Alice'],
  [1, 'A complete note', 'A complete note'],
  [3, '', 'event.contactList'],
  [5, '', 'event.eventDeletion'],
  [6, '', 'event.repostingNote'],
  [7, '🎉', '🎉'],
  [13, 'sealed', 'event.sealedDesc'],
  [1059, 'wrapped', 'event.sealedDesc'],
  [30078, '', 'Application'],
  [45678, '<unknown>', '&lt;unknown&gt;'],
] as const) {
  it(`kind ${kind} retains its preview and every tag when composed from shared controls`, () => {
    const tags = [['p', 'peer'], ['e', 'event'], ['d', 'Application', 'save_data'], ['custom', 'last tag']];
    const html = renderToStaticMarkup(createElement(EventPreview, {
      type: 'signEvent', event: { kind, content, tags },
    }));
    assert.ok(html.includes(label));
    assert.match(html, /<details open/);
    for (const tag of tags) assert.ok(html.includes(JSON.stringify(tag).replaceAll('"', '&quot;')));
    const dom=new JSDOM(html);
    const raw=dom.window.document.querySelector('button[aria-label="event.showRaw"]')!;
    assert.ok(raw);assert.equal(raw.getAttribute('aria-haspopup'),'dialog');
    assert.ok(raw.className.includes('focus-visible:shadow-focus'));dom.window.close();
  });
}

it('profile previews reject unsafe image URLs and handle malformed metadata', () => {
  const render = (content: string) => renderToStaticMarkup(createElement(EventPreview, {
    type: 'signEvent', event: { kind: 0, content, tags: [] },
  }));
  assert.doesNotMatch(render('{"name":"Alice","banner":"javascript:bad","picture":"javascript:bad"}'), /<img/);
  assert.match(render('{"name":"Alice","banner":"https://example.test/banner.png"}'), /<img[^>]*src="https:\/\/example.test\/banner.png"/);
  assert.match(render('invalid json'), /event.noEventData/);
});

it('raw details remain collapsed, selectable and bounded while escaping their content', () => {
  for (const maxHeight of [undefined, 180]) {
    const html = renderToStaticMarkup(createElement(DetailDisclosure, {
      label: 'Raw data', content: '<script>\n  private payload', maxHeight,
    }));
    assert.match(html, /<summary[^>]*>Raw data<\/summary>/);
    assert.doesNotMatch(html, /<details[^>]*open|<script>/);
    assert.match(html, /&lt;script&gt;\n {2}private payload/);
    assert.match(html, /whitespace-pre-wrap.*overflow-y-auto.*select-text/);
    assert.ok(html.includes(`max-height:${maxHeight ?? 240}px`));
  }
});

it('encrypted detail uses shared headings and box layout without exposing hidden account metadata', () => {
  const html = renderToStaticMarkup(createElement(ActivityEntryDetail, {
    entry: { method: 'nip44Decrypt', timestamp: 1, decision: 'approved', pubkey: '11'.repeat(32),
      theirPubkey: '22'.repeat(32), ciphertext: '<ciphertext>', event: { kind: 4, content: '<ciphertext>' } },
    hideAccount: true, hidePeer: true,
  }));
  assert.match(html, /<h5[^>]*>activity.detail.encrypted<\/h5>/);
  assert.match(html, /bg-card.*border-card-border.*rounded-panel/);
  assert.equal((html.match(/<details/g) || []).length, 2);
  assert.doesNotMatch(html, /111111|222222|<ciphertext>|<details[^>]*open/);
});

it('older encryption history explains the absent body and has no decrypt button', () => {
  const html = renderToStaticMarkup(createElement(ActivityEntryDetail, { entry: { method: 'nip44Encrypt', timestamp: 1, decision: 'approved', pubkey: '11'.repeat(32) } }));
  assert.match(html, /message body was not saved|activity.detail.notSaved/);
  assert.doesNotMatch(html, /<button/);
});
it('encrypted history requires a valid missing peer and keeps ciphertext collapsed', () => {
  const html = renderToStaticMarkup(createElement(ActivityEntryDetail, { entry: { method: 'nip44Decrypt', timestamp: 1, decision: 'approved', pubkey: '11'.repeat(32), ciphertext: 'ciphertext' } }));
  assert.match(html, /<input/);
  assert.match(html, /<button[^>]* disabled="/);
  assert.match(html, /<details[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /NIP-44/);
});
it('encrypted history with a known peer offers decryption', () => {
  const html = renderToStaticMarkup(createElement(ActivityEntryDetail, { entry: { method: 'nip04Decrypt', timestamp: 1, decision: 'approved', pubkey: '11'.repeat(32), theirPubkey: '22'.repeat(32), ciphertext: 'ciphertext' } }));
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /<input| disabled="/);
});
it('unknown event content remains readable and escaped, with tags collapsed only in activity', () => {
  const props = { type: 'signEvent', event: { kind: 45678, content: '<script>unsafe</script>', tags: [['p','peer']] } };
  const html = renderToStaticMarkup(createElement(EventPreview, {...props, compact: true}));
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(renderToStaticMarkup(createElement(EventPreview,props)), /<details open/);
});
it('site icons have a stable decorative fallback before the cached image resolves', () => {
  const html = renderToStaticMarkup(createElement(SiteIcon, { domain: 'site.test' }));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /<img/);
});

it('activity details preserve different ciphertexts and do not expose review actions in approval mode', async () => {
  const { default: EventDetailModal } = await import('../src/components/EventDetailModal');
  const entry = { method: 'nip44Decrypt', timestamp: 1, decision: 'approved', pubkey: '11'.repeat(32), theirPubkey: '22'.repeat(32), ciphertext: 'first-body' };
  const html = renderToStaticMarkup(createElement(EventDetailModal, { group: { domain: 'site.test', methodKey: 'nip44Decrypt', entries: [entry, {...entry, ciphertext: 'second-body'}] } }));
  assert.doesNotMatch(html, /first-body|second-body/);
  assert.equal((html.match(/<li /g) || []).length, 2);
  const approval = renderToStaticMarkup(createElement(EventDetailModal, { request: {type: 'nip44Decrypt', theirPubkey: entry.theirPubkey} }));
  assert.doesNotMatch(approval, /activity.detail.decrypt/);
});

import ActivityFiltersDialog from '../src/screens/Activity/ActivityFiltersDialog';
it('activity filters use a compact dialog and scrim with scrolling content and persistent close action', () => {
  const props = {typeOptions:[{value:'',label:'All operations'}],typeFilter:'',pubkeyFilter:'',activeFilterCount:0,
    onTypeChange(){},onPubkeyChange(){},onClear(){},onClose(){}};
  const html = renderToStaticMarkup(createElement(ActivityFiltersDialog, props));
  assert.match(html, /role="dialog"/);
  assert.match(html, /bg-\[rgba\(0,0,0,0.45\)\]/);
  assert.match(html, /--modal-max-width:360px/);
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /common.close/);
  assert.match(html, /activity.pubkeyFilterHint/);
  assert.match(html, /tabindex="0" role="button"/);
  assert.doesNotMatch(html, /activity.showProtocols|activity.hideProtocols/);
  assert.doesNotMatch(html, /activity.clearFilters/);
  assert.match(renderToStaticMarkup(createElement(ActivityFiltersDialog, {...props,activeFilterCount:1,pubkeyFilter:'peer'})), /activity.clearFilters/);
});

it('group detail displays metadata once above compact rows', async () => {
  const { default: EventDetailModal } = await import('../src/components/EventDetailModal');
  const entry = { method:'nip44Decrypt',timestamp:1000,decision:'approved',pubkey:'11'.repeat(32),theirPubkey:'22'.repeat(32),ciphertext:'encrypted'};
  const group = {domain:'site.test',methodKey:'nip44Decrypt',entries:[entry,{...entry,timestamp:2000}]};
  const html = renderToStaticMarkup(createElement(EventDetailModal,{group}));
  assert.equal((html.match(/activity.detail.account/g) || []).length,1);
  assert.equal((html.match(/activity.detail.peer/g) || []).length,1);
  assert.equal((html.match(/<li /g) || []).length,2);
  assert.equal((html.match(/activity.detail.time/g) || []).length,1);
  assert.equal((html.match(/activity.detail.status/g) || []).length,1);
  assert.doesNotMatch(html, /<details|<pre|activity.detail.reveal/);
  assert.match(html, /1111111111…11111111/);
  assert.ok(html.indexOf('activity.detail.status') < html.indexOf('<ol'));
  const scoped = renderToStaticMarkup(createElement(EventDetailModal,{group,selectedAccountPubkey:entry.pubkey}));
  assert.doesNotMatch(scoped, /activity.detail.account/);
  assert.match(scoped, /activity.detail.peer/);
});

it('mixed-account groups retain each account rather than hiding it under the external selection', async () => {
  const { default: EventDetailModal } = await import('../src/components/EventDetailModal');
  const entry = {method:'getPublicKey',timestamp:1000,decision:'approved',pubkey:'11'.repeat(32)};
  const html = renderToStaticMarkup(createElement(EventDetailModal,{selectedAccountPubkey:entry.pubkey,group:{entries:[entry,{...entry,pubkey:'22'.repeat(32)}]}}));
  assert.equal((html.match(/activity.detail.account/g) || []).length,2);
  assert.doesNotMatch(html, /<summary[^>]*>activity.detail.account/);
});

import { ActivityItemDialog, activityRowPreview } from '../src/components/EventDetailModal/ActivityGroupDetail';
it('selected event uses a mini dialog with scrim, exact timestamp, JSON and guarded decryption', () => {
  const entry = {method:'nip44Decrypt',timestamp:2000,decision:'approved',pubkey:'11'.repeat(32),theirPubkey:'22'.repeat(32),ciphertext:'unique-ciphertext'};
  const html = renderToStaticMarkup(createElement(ActivityItemDialog,{entry,onClose(){}}));
  assert.match(html,/role="dialog"/);
  assert.match(html,/bg-\[rgba\(0,0,0,0.45\)\]/);
  assert.match(html,/--modal-max-width:360px/);
  assert.match(html,/1970-01-01T00:00:02.000Z/);
  assert.match(html,/activity.detail.reveal/);
  assert.match(html,/>JSON</);
  assert.match(html,/unique-ciphertext/);
  assert.match(html,/1111111111…11111111/);
});
it('compact row previews adapt to profile, note, reaction and list events without revealing ciphertext', () => {
  const base = {method:'signEvent',timestamp:1,decision:'approved',pubkey:'11'.repeat(32)};
  assert.equal(activityRowPreview({...base,event:{kind:0,content:'{"name":"Alice","about":"Hello"}'}}),'Alice · Hello');
  assert.equal(activityRowPreview({...base,event:{kind:1,content:'Hello\nworld'}}),'Hello world');
  assert.equal(activityRowPreview({...base,event:{kind:7,content:'+'}}),'+');
  assert.match(activityRowPreview({...base,event:{kind:10002,tags:[['r','wss://relay.test']]}}),/r: wss:\/\/relay.test/);
  assert.match(activityRowPreview({...base,event:{kind:5,tags:[['e','22'.repeat(32)]]}}),/e: 222222222222222222…22222222/);
  assert.equal(activityRowPreview({...base,event:{kind:4,content:'ciphertext'}}),'activity.detail.encrypted');
});

it('approval group details show each note content with one decision footer', async () => {
 const {default: EventDetailModal}=await import('../src/components/EventDetailModal');
 const requests=[
  {id:'first',type:'signEvent',origin:'site.test',event:{kind:1,content:'first pending body',tags:[]}},
  {id:'second',type:'signEvent',origin:'site.test',event:{kind:1,content:'second pending body',tags:[]}},
 ];
 const html=renderToStaticMarkup(createElement(EventDetailModal,{request:requests[0],requests,onApprove:()=>{}}));
 assert.match(html,/first pending body/);assert.match(html,/second pending body/);
 assert.equal((html.match(/data-approval-request=/g)||[]).length,2);
 assert.doesNotMatch(html,/<details[^>]*data-approval-request[^>]*open/);
 assert.doesNotMatch(html,/approval.alwaysAllowLabel/);
 assert.match(html,/aria-label="approval.approveOptions"/);
});

it('remote signer groups also show every pending item without local approval actions', async () => {
 const {default: EventDetailModal}=await import('../src/components/EventDetailModal');
 const requests=[{id:'a',type:'signEvent',origin:'remote.test',event:{kind:1,content:'remote first',tags:[]}},
 {id:'b',type:'signEvent',origin:'remote.test',event:{kind:1,content:'remote second',tags:[]}}];
 const html=renderToStaticMarkup(createElement(EventDetailModal,{request:requests[0],requests,nip46InFlight:true}));
 assert.match(html,/remote.test/);assert.match(html,/remote first/);assert.match(html,/remote second/);
 assert.doesNotMatch(html,/approval.alwaysAllowLabel|approval.alwaysAllowLabel/);
});

it('approval details offer the same bulk action for one or many requests of one kind', async () => {
  const { default: EventDetailModal } = await import('../src/components/EventDetailModal');
  const request = {id:'one',type:'signEvent',origin:'site.test',event:{kind:1,content:'Review me',tags:[]}};
  for (const requests of [undefined,[request],[request,{...request,id:'two'}]]) {
    const html=renderToStaticMarkup(createElement(EventDetailModal,{request,requests,onApprove(){},busy:true}));
    assert.match(html,/aria-label="approval.approveOptions"/);
    assert.doesNotMatch(html,/approval.alwaysAllowLabel/);
    assert.match(html, requests && requests.length > 1 ? />approval.approveShown</ : />approval.approveOnce</);
  }
});

 it('dangerous follow replacements are visible before approving in event details',async()=>{
  const {default:EventDetailModal}=await import('../src/components/EventDetailModal');
  const html=renderToStaticMarkup(createElement(EventDetailModal,{request:{id:'r',type:'signEvent',origin:'site.test',followReplacementCount:20,event:{kind:3,tags:[['p','11'.repeat(32)]]}}}));
  assert.match(html,/approval.followReplacementTitle/);
  assert.match(html,/approval.followReplacementWarning/);
  assert.match(html,/text-error/);
 });

import { zapPreview } from '../src/domain/nostr/zapPreview';
import { formatMsats, paymentMsats } from '../src/domain/wallet/amount';
it('zap amount uses millisatoshis without rounding away fractional sats', () => {
  assert.equal(formatMsats('21000','en'),'21');
  assert.equal(formatMsats('1','en'),'0.001');
  assert.equal(formatMsats('21001234','en'),'21,001.234');
  assert.equal(formatMsats('21001234','de'),'21.001,234');
  assert.equal(formatMsats('9007199254740991999','en'),'9,007,199,254,740,991.999');
  assert.equal(paymentMsats(1.001),'1001');
  for(const amount of [undefined,NaN,Infinity,0,-1,1e30]) assert.equal(paymentMsats(amount),null);
});
it('zap display never guesses ambiguous or malformed amount/recipient tags', () => {
  const p='a'.repeat(64);
  assert.deepEqual(zapPreview({tags:[['amount','21000'],['p',p]]}),{amountMsats:'21000',recipient:p});
  for(const value of ['', '0', '-1','1.5','1e3','999'.repeat(100)]) assert.equal(zapPreview({tags:[['amount',value]]}).amountMsats,null);
  assert.equal(zapPreview({tags:[['amount','21000'],['amount','21000']]}).amountMsats,null);
  assert.equal(zapPreview({tags:[['amount','1000','9000']]}).amountMsats,null);
  assert.equal(zapPreview({tags:[['p',p],['p','b'.repeat(64)]]}).recipient,null);
  assert.equal(zapPreview({tags:[['p','invalid']]}).recipient,null);
  assert.equal(zapPreview({}).amountMsats,null);
});
it('zap approval visibly shows amount, recipient, comment and signing/payment distinction before raw event', () => {
 const html=renderToStaticMarkup(createElement(EventPreview,{type:'signEvent',approval:true,event:{kind:9734,content:'<script>thanks</script>',tags:[['amount','21000'],['p','a'.repeat(64)]]}}));
 const dom=new JSDOM(html),text=dom.window.document.body.textContent!;
 assert.match(text,/21 sats/);assert.match(text,/zapReview.signingOnly/);assert.match(text,/event.recipient/);
 assert.ok(text.includes('aaaaaaaaaaaaaaaa'));assert.ok(text.includes('<script>thanks</script>'));
 assert.doesNotMatch(html,/<script>/);assert.ok(html.indexOf('21')<html.indexOf('event.showRaw'));
 dom.window.close();
});
it('wallet payment approvals show invoice amounts even inside grouped requests', async () => {
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const request={id:'payment',type:'webln_sendPayment',origin:'https://site.test',walletAmount:21.001};
 for(const requests of [undefined,[request,{...request,id:'second',walletAmount:42}]]) {
  const html=renderToStaticMarkup(createElement(Detail,{request,requests,onApprove(){},onDeny(){}}));
  const dom=new JSDOM(html),text=dom.window.document.body.textContent!;
  assert.match(text,/21\.001 sats/);assert.match(text,/walletReview.paymentEffect/);
  assert.doesNotMatch(html,/<details|event.noEventData|webln_sendPayment/);
  if(requests) assert.match(text,/42 sats/);
  dom.window.close();
 }
});
it('wallet access explains its scope and unknown amounts never appear as zero sats', async () => {
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const access=renderToStaticMarkup(createElement(Detail,{request:{type:'webln_enable'}}));
 assert.match(access,/walletReview.accessEffect/);assert.doesNotMatch(access,/event.noEventData|webln_enable/);
 const unknown=renderToStaticMarkup(createElement(Detail,{request:{type:'webln_sendPayment',walletAmount:0}}));
 assert.match(unknown,/zapReview.amountUnknown/);assert.doesNotMatch(unknown,/>0 /);
});

it('single zap and payment queue cards expose their amount before opening detail', async () => {
 const {default:Card}=await import('../src/screens/Approval/ApprovalCard');
 for(const request of [
  {id:'zap',type:'signEvent',event:{kind:9734,tags:[['amount','21000']]},origin:'https://site.test',timestamp:0},
  {id:'payment',type:'webln_sendPayment',walletAmount:21,origin:'https://site.test',timestamp:0},
 ]) {
  const html=renderToStaticMarkup(createElement(Card,{group:{origin:request.origin,method:request.type,permKey:request.type,requests:[request]},onClick(){},hideSite:true}));
  assert.match(html,/21 sats/);
 }
});
