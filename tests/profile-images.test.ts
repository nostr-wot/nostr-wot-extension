import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { uploadProfileImages } from '../src/services/media/blossom.ts';
import ProfilePreviewCard from '../src/screens/EditProfile/ProfilePreviewCard';
import EncryptedBackupForm from '../src/components/EncryptedBackupForm';

it('uploads avatar and cover with the same uploader and reuses successful uploads on preview/back', async () => {
  const picture = new File(['avatar'], 'avatar.png', {type:'image/png'});
  const banner = new File(['cover'], 'cover.jpg', {type:'image/jpeg'});
  const calls: string[] = [];
  const upload = async (file: File) => { calls.push(file.name); return {url:'https://images.example/'+file.name}; };
  const cache = new WeakMap<File,string>();
  const result = await uploadProfileImages({picture,banner},cache,upload);
  assert.deepEqual(result,{picture:'https://images.example/avatar.png',banner:'https://images.example/cover.jpg'});
  assert.deepEqual(await uploadProfileImages({picture,banner},cache,upload),result);
  assert.deepEqual(calls,['avatar.png','cover.jpg']);
});
it('a failed cover upload can retry without uploading the avatar again', async () => {
  const picture = new File(['a'],'a.png',{type:'image/png'}), banner = new File(['b'],'b.png',{type:'image/png'});
  const cache = new WeakMap<File,string>();
  let fail = true, calls = 0;
  const upload = async (file: File) => { calls++; if (file === banner && fail) throw new Error('Offline'); return {url:'https://images.example/'+file.name}; };
  await assert.rejects(() => uploadProfileImages({picture,banner},cache,upload),/Offline/);
  fail=false;
  await uploadProfileImages({picture,banner},cache,upload);
  assert.equal(calls,3);
});
it('URL-only editing needs no upload and unsafe upload URLs are rejected', async () => {
  const cache = new WeakMap<File,string>();
  assert.deepEqual(await uploadProfileImages({},cache,async()=>{throw new Error('unexpected upload');}),{});
  await assert.rejects(() => uploadProfileImages({banner:new File(['a'],'a.png')},cache,async()=>({url:'javascript:alert(1)'})),/URL/);
});
it('the confirmation preview includes a safe cover image, but never an unsafe source', () => {
  const props = {initial:'A',error:'',onBack(){},onConfirm(){}};
  const html=renderToStaticMarkup(createElement(ProfilePreviewCard,{...props,meta:{banner:'https://images.example/cover.jpg'}}));
  assert.match(html,/src="https:\/\/images.example\/cover.jpg"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ProfilePreviewCard,{...props,meta:{banner:'javascript:bad'}})),/javascript:bad/);
});
it('backup recovery warning follows password validation and precedes export actions', () => {
  const html=renderToStaticMarkup(createElement(EncryptedBackupForm,{rpcMethod:'vault_exportNcryptsec',onClose(){}}));
  const warning=html.indexOf('key.ncryptsecNoRecovery');
  assert.ok(warning > html.lastIndexOf('<input'));
  assert.ok(warning < html.indexOf('key.generate</button>'));
  assert.ok(warning > html.indexOf('password'));
});

import PqcOverview, { PqcPublication } from '../src/screens/Settings/PqcOverview';
import KeyRow from '../src/screens/Settings/PqcKeyRow';
it('PQ publication is an actionable section only when publication is needed', () => {
  const props={imported:false,ready:true,existing:{published:true,current:true},busy:false,onPublish(){},onRetry(){}};
  const ready=renderToStaticMarkup(createElement(PqcPublication,props));
  assert.match(ready,/pqc.alreadyPublished/);
  assert.doesNotMatch(ready,/<button/);
  const offline=renderToStaticMarkup(createElement(PqcPublication,{...props,ready:false,existing:{published:false,current:false,unreachable:true}}));
  assert.match(offline,/pqc.checkFailed/); assert.match(offline,/common.retry/);
  const busy=renderToStaticMarkup(createElement(PqcPublication,{...props,ready:false,busy:true}));
  assert.match(busy,/ disabled=""/);
});
it('PQ key cards retain both ends of the key and a named copy action', () => {
  const html=renderToStaticMarkup(createElement(KeyRow,{label:'ml-kem-1024',value:'abc'+'x'.repeat(100)+'xyz'}));
  assert.match(html,/ML-KEM-1024/); assert.match(html,/abc/); assert.match(html,/xyz/);
  assert.match(html,/aria-label="common.copy ml-kem-1024"/);
});

it('PQ overview orders key, export, announcement rows and puts the warning immediately before removal', () => {
  const props={imported:true,ready:true,removing:false,onKeys(){},onExport(){},onAnnouncement(){},onRemove(){}};
  const html=renderToStaticMarkup(createElement(PqcOverview,props));
  assert.ok(html.indexOf('pqc.showKeys') < html.indexOf('pqc.exportKeys'));
  assert.ok(html.indexOf('pqc.exportKeys') < html.indexOf('pqc.publicationTitle'));
  assert.ok(html.indexOf('pqc.publicationTitle') < html.indexOf('pqc.importedBackupWarning'));
  assert.ok(html.indexOf('pqc.importedBackupWarning') < html.indexOf('pqc.importRemove'));
  assert.match(html,/bg-success-bright/);
  assert.match(renderToStaticMarkup(createElement(PqcOverview,{...props,ready:false})),/bg-error-bright/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PqcOverview,{...props,imported:false})),/pqc.importedBackupWarning|pqc.importRemove/);
});

import Textarea, { fitTextarea } from '../src/components/Textarea';
import ProfileImageHeader from '../src/screens/EditProfile/ProfileImageHeader';
import ProfileImageDialog from '../src/screens/EditProfile/ProfileImageDialog';
it('About preserves existing line breaks in the multiline field and publish preview', () => {
  const about='First paragraph\n\nSecond paragraph';
  const field=renderToStaticMarkup(createElement(Textarea,{label:'About',value:about,onChange(){}}));
  assert.match(field,/<textarea/); assert.ok(field.includes(about));
  const preview=renderToStaticMarkup(createElement(ProfilePreviewCard,{meta:{about},initial:'A',error:'',onBack(){},onConfirm(){}}));
  assert.match(preview,/whitespace-pre-wrap/); assert.ok(preview.includes(about));
});
it('textarea grows and shrinks to the measured text, including its border', () => {
  const node={style:{height:'500px'},scrollHeight:240,offsetHeight:74,clientHeight:72};
  fitTextarea(node);
  assert.equal(node.style.height,'242px');
  node.scrollHeight=72;
  fitTextarea(node);
  assert.equal(node.style.height,'74px');
});
it('cover editing appears above avatar editing, with placeholders and named controls', () => {
  const props={banner:'',picture:'',initial:'A',onEdit(){}};
  const html=renderToStaticMarkup(createElement(ProfileImageHeader,props));
  assert.ok(html.indexOf('profileEdit.editCover') < html.indexOf('profileEdit.changeImage'));
  assert.equal((html.match(/<button/g)||[]).length,2);
  assert.doesNotMatch(html,/<input/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ProfileImageHeader,{...props,banner:'javascript:bad'})),/javascript:bad/);
});
it('the image dialog offers URL and upload, and invalid URLs disable Save', () => {
  const props={target:'banner' as const,url:'https://images.example/cover.jpg',file:null,onClose(){},onSave(){}};
  const html=renderToStaticMarkup(createElement(ProfileImageDialog,props));
  assert.match(html,/role="dialog"/); assert.match(html,/type="file"/); assert.match(html,/profileEdit.bannerUrl/);
  assert.match(html,/profileEdit.uploadImage/);
  const invalid=renderToStaticMarkup(createElement(ProfileImageDialog,{...props,url:'javascript:bad'}));
  assert.match(invalid,/ disabled=""[^>]*>common.save/);
});

import PermissionsDetailLayout from '../src/screens/Settings/PermissionsDetailLayout';
it('site permission detail keeps its domain and actions outside the scrolling rules', () => {
  const html=renderToStaticMarkup(createElement(PermissionsDetailLayout, {domain:'site.example',actions:createElement('button',null,'Add rule')},createElement('div',null,'Many rules')));
  assert.ok(html.indexOf('site.example') < html.indexOf('overflow-y-auto'));
  assert.match(html,/flex-1 min-h-0 overflow-y-auto/);
  assert.ok(html.indexOf('Many rules') < html.indexOf('Add rule'));
});

import NetworkSection from '../src/screens/Settings/NetworkSection.tsx';
import { AccountProvider } from '../src/context/AccountContext.tsx';
import { RelaysProvider } from '../src/context/RelaysContext.tsx';
it('relay editor distinguishes discovery from local settings and disables publish while checking', () => {
  const html = renderToStaticMarkup(createElement(AccountProvider, null,
    createElement(RelaysProvider, null, createElement(NetworkSection))));
  assert.match(html, /network.publishedConfiguration/);
  assert.match(html, /network.localConfiguration/);
  assert.match(html, /network.checkingPublished/);
  assert.doesNotMatch(html, /network.notPublishedYet/);
  assert.match(html, /disabled=""[^>]*>common.publish/);
});

it('the PQ overview leaves the decorative key icon out of the heading', () => {
  const html = renderToStaticMarkup(createElement(PqcOverview, {imported:true,ready:true,removing:false,onKeys(){},onExport(){},onAnnouncement(){},onRemove(){}}));
  assert.doesNotMatch(html.slice(0, html.indexOf('</h3>')), /<svg/);
  assert.match(html.slice(html.indexOf('</h3>')), /<svg/);
});

import AccountDropdown, { AccountPickerRow } from '../src/screens/TopBar/AccountDropdown';
import AccountCopyMenu from '../src/screens/TopBar/AccountCopyMenu';
import AccountBar from '../src/screens/TopBar/AccountBar';
import { VaultProvider } from '../src/context/VaultContext';
it('account picker uses a dimmed dialog and a persistent Add account footer', () => {
  const html = renderToStaticMarkup(createElement(AccountProvider, null, createElement(AccountDropdown,{onClose(){},onAddAccount(){}})));
  assert.match(html,/role="dialog"/);
  assert.match(html,/bg-\[rgba\(0,0,0,0.45\)\]/);
  assert.match(html,/account.addAccount/);
  assert.doesNotMatch(html,/top-full|settings.editProfile|common.copy/);
});
it('account rows show the selected account and omit edit/copy actions', () => {
  const props={name:'Alice',subtitle:'npub123…456',selected:true,readOnly:false,onSelect(){},onRemove(){}};
  const html=renderToStaticMarkup(createElement(AccountPickerRow,props));
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/account.selected/);
  assert.doesNotMatch(html,/settings.editProfile|common.copy/);
  assert.match(renderToStaticMarkup(createElement(AccountPickerRow,{...props,selected:false,readOnly:true})),/aria-pressed="false"/);
});
it('copy remains available beside the account switcher and offers both public key formats', () => {
  const bar=renderToStaticMarkup(createElement(AccountProvider,null,createElement(VaultProvider,null,createElement(AccountBar,{dropdownOpen:false,onToggleDropdown(){}}))));
  assert.match(bar,/aria-haspopup="dialog"/);
  assert.ok(bar.indexOf('aria-haspopup="dialog"') < bar.indexOf('aria-label="common.copy"'));
  const html=renderToStaticMarkup(createElement(AccountCopyMenu,{pubkey:'11'.repeat(32)}));
  assert.match(html,/aria-haspopup="menu"/);
  assert.doesNotMatch(html,/role="dialog"/);
});

import { commitAccountSwitch } from '../src/context/AccountContext';
import { PqcCardView } from '../src/screens/Home/PqcCard';
import ListRow from '../src/components/ListRow';
import ActionTile from '../src/components/ActionTile';
it('menu subtitles and the PQ shield reuse the existing wizard brand colors', () => {
  for (const state of ['enabled','stale','setup','import'] as const) {
    const html=renderToStaticMarkup(createElement(PqcCardView,{state,onClick(){}}));
    assert.match(html,/text-menu-subtitle/);
    assert.match(html,/bg-brand-light text-brand/);
    assert.doesNotMatch(html,/text-success|text-warning/);
  }
  assert.match(renderToStaticMarkup(createElement(ListRow,{title:'Title',subtitle:'Description'})),/text-menu-subtitle/);
  assert.match(renderToStaticMarkup(createElement(ActionTile,{title:'Title',description:'Description',icon:null,onClick(){}})),/text-menu-subtitle/);
});
it('account-scoped readers cannot start before the background switch completes', async () => {
  let finish!: () => void;
  const selected: string[]=[];
  const pending=commitAccountSwitch('new',async () => new Promise<void>(resolve => { finish=resolve; }),id => selected.push(id));
  assert.equal(selected.length,0);
  finish(); await pending;
  assert.deepEqual(selected,['new']);
  await assert.rejects(commitAccountSwitch('bad',async () => {throw new Error('locked');},id => selected.push(id)));
  assert.deepEqual(selected,['new']);
});

import PqcImportPanel from '../src/screens/Settings/PqcImportPanel';
import { PqcProvider } from '../src/context/PqcContext';
it('PQ key paste reuses a labelled, bounded textarea and retains the native file chooser', () => {
  const html=renderToStaticMarkup(createElement(AccountProvider,null,createElement(PqcProvider,null,createElement(PqcImportPanel))));
  assert.match(html,/for="pqc-keyfile"/);
  assert.match(html,/<textarea[^>]*id="pqc-keyfile"/);
  assert.match(html,/max-h-80/);
  assert.match(html,/<input[^>]*type="file"/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>pqc.importSubmit<\/button>/);
});

import ImageEditorButton from '../src/components/ImageEditorButton';
import ProfileSummary from '../src/components/ProfileSummary';
import { createObjectUrlResource } from '../src/services/media/objectUrl';
import useObjectUrl from '../src/hooks/useObjectUrl';
import useTransientState from '../src/hooks/useTransientState';
import useAsyncScope from '../src/hooks/useAsyncScope';
import useMuteListEditor from '../src/screens/Filters/useMuteListEditor';
it('shared image controls accept local previews but reject unsafe remote sources', () => {
  const props = {variant:'avatar' as const,label:'Change avatar',onClick(){}};
  const html = renderToStaticMarkup(createElement(ImageEditorButton,{...props,previewUrl:'blob:local'}));
  assert.match(html,/src="blob:local"/);
  assert.match(html,/aria-label="Change avatar"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ImageEditorButton,{...props,previewUrl:'javascript:bad',src:'javascript:bad'})),/javascript:/);
});
it('shared profile summary tolerates malformed remote fields and escapes text', () => {
  const html = renderToStaticMarkup(createElement(ProfileSummary,{meta:{name:42,about:'<script>\ntext',picture:'javascript:bad'} as never}));
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/javascript:|<script>/);
});
it('object URL resource revokes its own URL only once', t => {
  const created = t.mock.method(URL,'createObjectURL',()=> 'blob:owned');
  const revoked = t.mock.method(URL,'revokeObjectURL',()=>{});
  const blob = new Blob(['image']);
  const resource = createObjectUrlResource(blob);
  assert.equal(created.mock.calls[0].arguments[0],blob);
  assert.equal(resource.url,'blob:owned');
  resource.dispose(); resource.dispose();
  assert.equal(revoked.mock.callCount(),1);
  assert.equal(revoked.mock.calls[0].arguments[0],'blob:owned');
});
it('lifecycle hooks start without render-time I/O and mute edits start unavailable', t => {
  t.mock.method(URL,'createObjectURL',()=> { throw new Error('render-time URL allocation'); });
  function Probe() {
    assert.equal(useObjectUrl(new Blob(['image'])),null);
    assert.equal(useTransientState<string|null>(null,3000)[0],null);
    assert.equal(useAsyncScope().start()(),true);
    const editor = useMuteListEditor();
    assert.equal(editor.list,null);
    assert.equal(editor.loading,true);
    assert.equal(editor.busy,true);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
});

it('PQ import decrypts uploaded backups, retries wrong passwords, and still imports plain files', async t => {
  const {JSDOM}=await import('jsdom');
  const {act}=await import('react');
  const {default:browser}=await import('./helpers/browser-mock');
  const {encryptBackup}=await import('../src/lib/crypto/keyBackup');
  const dom=new JSDOM('<div id="root"></div>');
  const previous=new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  Object.defineProperties(globalThis,{window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}});
  const {createRoot}=await import('react-dom/client');
  const calls:string[]=[];
  t.mock.method(browser.runtime,'sendMessage',async (message:any)=>{
    if(message.method==='pqc_importKeys') calls.push(message.params.keyfile);
    return {result:{pubkey:'test',canDerive:false}};
  });
  const root=createRoot(dom.window.document.getElementById('root')!);
  const plain=JSON.stringify({v:'nip-pqc/v1',kem:{},dsa:{}});
  const encrypted=await encryptBackup(plain,'export password');
  const button=()=>Array.from(dom.window.document.querySelectorAll('button')).find(b=>b.textContent==='pqc.importSubmit')!;
  const upload=async(contents:string)=>act(async()=>{
    const input=dom.window.document.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input,'files',{value:[{text:async()=>contents}],configurable:true});
    input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  });
  const password=async(value:string)=>act(async()=>{
    const input=dom.window.document.querySelector<HTMLInputElement>('#account-import-password, input[type=password]:not(#account-import-key)')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  const submit=async()=>act(async()=>{
    button().click();
    await new Promise(resolve=>setTimeout(resolve,250));
  });
  try {
    await act(async()=>root.render(createElement(AccountProvider,null,createElement(PqcProvider,null,createElement(PqcImportPanel)))));
    await upload(encrypted);
    assert.equal(calls.length,0);
    assert.equal(button().disabled,true);
    await password('wrong');
    await submit();
    assert.equal(calls.length,0);
    assert.match(dom.window.document.body.textContent!,/Wrong password/);
    await password('export password');
    await submit();
    assert.deepEqual(calls,[plain]);
    assert.equal(dom.window.document.querySelector('input[type=password]'),null);
    assert.equal(dom.window.document.querySelector('textarea')!.value,'');
    await upload(plain);
    assert.deepEqual(calls,[plain,plain]);

    const {default:ImportStep}=await import('../src/screens/Wizard/ImportStep');
    const validations:{method:string;params:any}[]=[];
    const advanced:any[]=[];
    t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
      if(message.method.startsWith('onboarding_validate')) validations.push(message);
      return {result:message.method==='onboarding_checkExistingSeed'
        ? {hasSeed:false}
        : {account:{id:'imported'},upgradeFromReadOnly:'readonly'}};
    });
    await act(async()=>root.render(createElement(ImportStep,{onNext:(...args:any[])=>advanced.push(args)})));
    const wizardSubmit=()=>Array.from(dom.window.document.querySelectorAll('button')).find(b=>['common.continue','wizard.decryptContinue'].includes(b.textContent!))!;
    const importWizard=async()=>act(async()=>{
      wizardSubmit().click();
      await new Promise(resolve=>setTimeout(resolve,250));
    });
    const seed='abandon '.repeat(11)+'about';
    await upload(await encryptBackup(seed,'export password'));
    assert.equal(wizardSubmit().disabled,true);
    await password('wrong');
    await importWizard();
    assert.equal(validations.length,0);
    assert.match(dom.window.document.body.textContent!,/Wrong password/);
    await password('export password');
    await importWizard();
    assert.equal(validations[0].method,'onboarding_validateMnemonic');
    assert.equal(validations[0].params.mnemonic,seed);
    assert.deepEqual(advanced[0],[{id:'imported'},'readonly']);
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('#account-import-key')!.value,'');

    await upload(encrypted);
    await password('export password');
    await importWizard();
    assert.equal(validations.length,1,'PQ-only backups never reach account validation');
    assert.match(dom.window.document.body.textContent!,/wizard.pqKeyRequiresAccount/);
    await upload(plain);
    assert.equal(wizardSubmit().disabled,true);
    assert.match(dom.window.document.body.textContent!,/wizard.pqKeyRequiresAccount/);

    await upload(await encryptBackup('ncryptsec1candidate','outer password'));
    await password('outer password');
    await importWizard();
    assert.equal(validations.length,1,'nested ncryptsec requests its separate password');
    assert.equal(dom.window.document.querySelector<HTMLInputElement>('#account-import-password')!.value,'');
    await password('inner password');
    await importWizard();
    assert.equal(validations[1].method,'onboarding_validateNcryptsec');
    assert.equal(validations[1].params.password,'inner password');

    await upload('ab'.repeat(32));
    await importWizard();
    assert.equal(validations[2].method,'onboarding_validateNsec');
    assert.equal(validations[2].params.input,'ab'.repeat(32));

  } finally {
    await act(async()=>root.unmount());
    dom.window.close();
    for(const [key,descriptor] of previous) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor);
      else Reflect.deleteProperty(globalThis,key);
    }
  }
});

import { accountDisplay } from '../src/domain/accounts/display';
import AccountLabel from '../src/screens/TopBar/AccountLabel';
it('remote accounts reuse profile identity and fall back to npub, never a connection label', () => {
  const remote = { type: 'nip46' as const, name: 'Nostr Connect', pubkey: '11'.repeat(32) };
  const profile = { display_name: 'Alice', picture: 'https://example.com/alice.png', nip05: 'alice@example.com' };
  const display = accountDisplay(remote, profile);
  assert.equal(display.name, 'Alice');
  assert.equal(display.picture, profile.picture);
  assert.equal(display.subtitle, profile.nip05);
  assert.equal(display.initial, 'A');
  assert.match(accountDisplay(remote).name, /^npub/);
  assert.equal(accountDisplay({...remote, type:'nsec', name:'My account'}).name, 'My account');
  assert.equal(accountDisplay(remote, {...profile, name:'alice'}).name, 'alice');
  const html = renderToStaticMarkup(createElement(AccountPickerRow, {
    name:display.name, subtitle:display.subtitle, picture:display.picture!, remote:true,
    selected:true, readOnly:false, onSelect(){}, onRemove(){},
  }));
  assert.match(html, /Alice/);
  assert.match(html, /alice.png/);
  assert.match(html, /account.remote/);
  assert.equal((html.match(/<button/g) || []).length, 2, 'badge must not add a nested button');
});
it('the shared topbar and picker label only badges remote or read-only accounts', () => {
  assert.match(renderToStaticMarkup(createElement(AccountLabel,{name:'Alice',remote:true})), /account.remote/);
  assert.match(renderToStaticMarkup(createElement(AccountLabel,{name:'Alice',readOnly:true})), /account.readOnly/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(AccountLabel,{name:'Alice'})), /account.remote|account.readOnly/);
});

it('account copy menu offers exact formats, keyboard dismissal and clipboard feedback without a dialog', async () => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { npubEncode } = await import('../src/lib/crypto/bech32.ts');
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>');
  const globals = new Map(['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const written: string[]=[];
  let fail=false;
  Object.defineProperties(globalThis,{
    window:{value:dom.window,configurable:true},document:{value:dom.window.document,configurable:true},
    navigator:{value:{clipboard:{writeText:async(value:string)=>{if(fail)throw Error('Denied');written.push(value);}}},configurable:true},
    IS_REACT_ACT_ENVIRONMENT:{value:true,configurable:true}
  });
  const { createRoot } = await import('react-dom/client');
  const root=createRoot(dom.window.document.getElementById('root')!);
  const pubkey='11'.repeat(32);
  const trigger=()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  const key=(value:string)=>act(async()=>{dom.window.document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true}));});
  try {
    await act(async()=>root.render(createElement(AccountCopyMenu,{pubkey})));
    await act(async()=>{trigger().focus();trigger().click();});
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    assert.deepEqual([...dom.window.document.querySelectorAll('[role="menuitem"]')].map(el=>el.textContent),['hex','npub']);
    assert.equal(dom.window.document.activeElement!.textContent,'hex');
    await key('ArrowDown');
    assert.equal(dom.window.document.activeElement!.textContent,'npub');
    await act(async()=>{(dom.window.document.activeElement as HTMLButtonElement).click();});
    assert.deepEqual(written,[npubEncode(pubkey)]);
    assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
    assert.equal(dom.window.document.activeElement,trigger());
    assert.match(dom.window.document.body.textContent!,/common.copied/);
    await act(async()=>trigger().click());
    await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();});
    assert.deepEqual(written,[npubEncode(pubkey),pubkey]);
    await act(async()=>trigger().click());
    await key('Escape');
    assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
    await act(async()=>trigger().click());
    await act(async()=>{dom.window.document.getElementById('outside')!.dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true}));});
    assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
    await act(async()=>trigger().click());
    await act(async()=>dom.window.document.getElementById('outside')!.focus());
    assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
    fail=true;
    await act(async()=>trigger().click());
    await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();});
    assert.ok(dom.window.document.querySelector('[role="menu"]'));
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/common.error/);
    await act(async()=>root.render(createElement(AccountCopyMenu,{key:'new',pubkey:'22'.repeat(32)})));
    assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const [name,descriptor] of globals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
});
