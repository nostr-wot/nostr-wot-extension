import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { uploadProfileImages } from '../src/services/media/blossom.ts';
import ProfilePreviewCard from '../src/screens/EditProfile/ProfilePreviewCard';
import EncryptedBackupForm from '../src/components/EncryptedBackupForm/EncryptedBackupForm';

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

import Textarea, { fitTextarea } from '../src/components/Textarea/Textarea';
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
import AccountCopyDialog from '../src/screens/TopBar/AccountCopyDialog';
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
  const bar=renderToStaticMarkup(createElement(AccountProvider,null,createElement(VaultProvider,null,createElement(AccountBar,{dropdownOpen:false,onToggleDropdown(){},onCopy(){}}))));
  assert.match(bar,/aria-haspopup="dialog"/);
  assert.ok(bar.indexOf('aria-haspopup="dialog"') < bar.indexOf('aria-label="common.copy"'));
  const html=renderToStaticMarkup(createElement(AccountCopyDialog,{pubkey:'11'.repeat(32),onClose(){}}));
  assert.match(html,/>npub</); assert.match(html,/>hex</);
});

import { commitAccountSwitch } from '../src/context/AccountContext';
import { PqcCardView } from '../src/screens/Home/PqcCard';
import ListRow from '../src/components/ListRow/ListRow';
import ActionTile from '../src/components/ActionTile/ActionTile';
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
