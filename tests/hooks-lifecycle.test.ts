import { AccountProvider, useAccount } from '../src/context/AccountContext';
import { WizardStep } from '../src/constants/wizard.ts';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, type ReactNode } from 'react';
import { JSDOM } from 'jsdom';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import ScrollWheelPicker from '../src/components/ScrollWheelPicker';
import { useAnimatedVisible } from '../src/hooks/useAnimatedVisible';
import useVaultUnlock from '../src/hooks/useVaultUnlock';
import useSiteState from '../src/hooks/useSiteState';
import { useLatch } from '../src/hooks/useLatch';
import PasswordStep from '../src/screens/Wizard/PasswordStep';
import UnlockSection from '../src/screens/Prompt/UnlockSection';
import KeyActionModal from '../src/screens/Vault/KeyActionModal';
import { VaultProvider } from '../src/context/VaultContext';

function deferred<T>() {
 let resolve!: (value: T) => void;
 const promise = new Promise<T>(done => { resolve = done; });
 return { promise, resolve };
}
async function mount() {
 const dom = new JSDOM('<div id="root"></div>');
 const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
 const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
 for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
 const { createRoot } = await import('react-dom/client');
 const root = createRoot(document.getElementById('root')!);
 let mounted = true;
 return {
  dom,
  render: (element: ReactNode) => act(async () => { root.render(element); }),
  unmount: async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } },
  async close() {
   if (mounted) await act(async () => root.unmount());
   dom.window.close();
   for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
   }
  },
 };
}

it('wheel clears a pending pointer hold when it unmounts', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const view = await mount(); let captures = 0;
 try {
  await view.render(createElement(ScrollWheelPicker, { items: ['a', 'b'], selectedIndex: 1 }));
  assert.equal(document.querySelector('[aria-selected="true"]')?.textContent, 'b');
  const wheel = document.querySelector('[role="listbox"]')!;
  Object.assign(wheel, { setPointerCapture() { captures++; } });
  await act(async () => wheel.dispatchEvent(new view.dom.window.MouseEvent('pointerdown', { bubbles: true, clientY: 10 })));
  await view.unmount();
  await act(async () => t.mock.timers.tick(151));
  assert.equal(captures, 0, 'detached wheel must not capture a pointer');
 } finally { await view.close(); }
});

it('animated visibility cancels an exit on reopen and completes only the current exit', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const view = await mount();
 function Probe({ visible, duration = 200 }: { visible: boolean; duration?: number }) {
  const state = useAnimatedVisible(visible, duration);
  return state.shouldRender ? createElement('span', null, state.animating ? 'exiting' : 'visible') : null;
 }
 try {
  await view.render(createElement(Probe, { visible: true }));
  await view.render(createElement(Probe, { visible: false }));
  assert.equal(document.body.textContent, 'exiting');
  await act(async () => t.mock.timers.tick(100));
  await view.render(createElement(Probe, { visible: true }));
  await act(async () => t.mock.timers.tick(200));
  assert.equal(document.body.textContent, 'visible');
  await view.render(createElement(Probe, { visible: false, duration: 50 }));
  await act(async () => t.mock.timers.tick(49));
  assert.equal(document.body.textContent, 'exiting');
  await act(async () => t.mock.timers.tick(1));
  assert.equal(document.body.textContent, '');
 } finally { await view.close(); }
});

it('vault unlock completion cannot call an unmounted consumer', async t => {
 const view = await mount(), reply = deferred<{ result: boolean }>(); let successes = 0;
 let unlock!: ReturnType<typeof useVaultUnlock>;
 t.mock.method(browser.runtime, 'sendMessage', () => reply.promise);
 function Probe() { unlock = useVaultUnlock({ onSuccess: () => { successes++; } }); return null; }
 try {
  await view.render(createElement(Probe));
  await act(async () => unlock.setPassword('password'));
  let pending!: Promise<boolean>;
  await act(async () => { pending = unlock.unlock(); });
  await view.unmount();
  await act(async () => { reply.resolve({ result: true }); await pending; });
  assert.equal(successes, 0);
 } finally { await view.close(); }
});

it('prompt auto-unlock ignores a reply after the section unmounts', async t => {
 const view = await mount(), reply = deferred<{ result: boolean }>(); let successes = 0;
 t.mock.method(browser.runtime, 'sendMessage', () => reply.promise);
 try {
  await view.render(createElement(UnlockSection, { onUnlocked: () => { successes++; } }));
  await view.unmount();
  await act(async () => reply.resolve({ result: false }));
  assert.equal(successes, 0);
 } finally { await view.close(); }
});

it('wizard does not add an account after its pending vault check is abandoned', async t => {
 resetMockStorage(); await browser.storage.local.set({ accounts: [{ id: 'existing' }] });
 const view = await mount(), exists = deferred<{ result: boolean }>(); const calls: string[] = [];
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string }) => {
  calls.push(message.method);
  return message.method === 'vault_exists' ? exists.promise : { result: false };
 });
 try {
  await view.render(createElement(PasswordStep, { account: { id: 'new' }, upgradeId: null, onNext() {} }));
  await view.unmount();
  await act(async () => exists.resolve({ result: true }));
  assert.ok(!calls.includes('onboarding_addToVault'), 'abandoned screen must not initiate an account mutation');
 } finally { await view.close(); }
});

it('wizard uses the latest completion callback without adding the same account again', async t => {
 resetMockStorage(); await browser.storage.local.set({ accounts: [{ id: 'existing' }] });
 const view = await mount(), added = deferred<{ result: boolean }>(); const completions: string[] = []; let adds = 0;
 const account = { id: 'new' };
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string }) => {
  if (message.method === 'onboarding_addToVault') { adds++; return added.promise; }
  return { result: message.method === 'vault_exists' };
 });
 try {
  await view.render(createElement(PasswordStep, { account, upgradeId: null, onNext: () => completions.push('old') }));
  assert.equal(adds, 1);
  await view.render(createElement(PasswordStep, { account, upgradeId: null, onNext: () => completions.push('current') }));
  await act(async () => added.resolve({ result: true }));
  assert.equal(adds, 1);
  assert.deepEqual(completions, ['current']);
 } finally { await view.close(); }
});

it('key action ignores an abandoned auto-unlock result instead of refreshing its provider', async t => {
 const view = await mount(), locked = deferred<{ result: boolean }>(); let reads = 0;
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string }) => {
  reads++;
  return message.method === 'vault_isLocked' ? locked.promise : { result: false };
 });
 try {
  await view.render(createElement(VaultProvider, null, createElement(KeyActionModal, { action: 'unknown', onClose() {} })));
  const before = reads;
  await view.unmount();
  await act(async () => locked.resolve({ result: false }));
  assert.equal(reads, before, 'closed key dialog must not issue another provider refresh');
 } finally { await view.close(); }
});

it('localized unlock messages do not restart consumers when only their object identity changes', async () => {
 const view = await mount(); let unlock!: ReturnType<typeof useVaultUnlock>;
 const success = () => {};
 function Probe({ language }: { language: string }) {
  unlock = useVaultUnlock({ onSuccess: success, messages: { enterPassword: language === 'en' ? 'Enter password' : 'Passwort eingeben' } });
  return createElement('span', null, unlock.error);
 }
 try {
  await view.render(createElement(Probe, { language: 'en' }));
  const first = unlock.unlock;
  await view.render(createElement(Probe, { language: 'en' }));
  assert.equal(unlock.unlock, first);
  await view.render(createElement(Probe, { language: 'de' }));
  await act(async () => { await unlock.unlock(); });
  assert.equal(document.body.textContent, 'Passwort eingeben');
 } finally { await view.close(); }
});

it('profile cache refresh preserves a draft, while reopening seeds the latest profile', async t => {
 resetMockStorage();
 const { AccountProvider } = await import('../src/context/AccountContext');
 const { default: EditProfileOverlay } = await import('../src/screens/EditProfile/EditProfileOverlay');
 const pubkey = '11'.repeat(32);
 await browser.storage.local.set({ accounts: [{ id: 'a', pubkey, name: 'Account', type: 'imported' }], activeAccountId: 'a', profileCache: { [pubkey]: { name: 'Initial' } } });
 t.mock.method(browser.runtime, 'sendMessage', async () => ({ result: null }));
 const view = await mount();
 const render = (visible: boolean) => view.render(createElement(AccountProvider, null, createElement(EditProfileOverlay, { visible, onClose() {} })));
 const name = () => document.querySelector<HTMLInputElement>('input[placeholder="profileEdit.namePlaceholder"]')!;
 try {
  await render(false); await render(true);
  assert.equal(name().value, 'Initial');
  const setValue = Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(name(), 'Draft'); name().dispatchEvent(new view.dom.window.Event('input', { bubbles: true })); });
  assert.equal(name().value, 'Draft');
  await act(async () => browser.storage.local.set({ profileCache: { [pubkey]: { name: 'Refreshed' } } }));
  assert.equal(name().value, 'Draft');
  await render(false); await render(true);
  assert.equal(name().value, 'Refreshed');
 } finally { await view.close(); }
});

it('permission back navigation returns directly to the menu without a site list', async t => {
 resetMockStorage();
 const { AccountProvider } = await import('../src/context/AccountContext');
 const { PermissionsProvider } = await import('../src/context/PermissionsContext');
 const { default: PermissionsSection } = await import('../src/screens/Settings/PermissionsSection');
 const { createRef } = await import('react');
 const { t: label } = await import('../src/services/i18n/i18n');
 const ref = createRef<{ goBack: () => boolean }>();
 t.mock.method(browser.tabs, 'query', async () => [{id:1,url:'https://site.test/path'}]);
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string }) => ({ result: message.method === 'signer_getUseGlobalDefaults' ? true : message.method === 'signer_getPermissionsRaw' ? {} : [] }));
 const view = await mount();
 try {
  await view.render(createElement(AccountProvider, null, createElement(PermissionsProvider, null, createElement(PermissionsSection, { ref }))));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent!.includes(label('perms.rulesHint')))!.click());
  assert.ok(document.body.textContent!.includes('https://site.test'));
  await act(async () => { assert.equal(ref.current?.goBack(), true); });
  assert.equal(document.querySelector('input[type="search"]'),null);
  assert.ok(document.body.textContent!.includes(label('perms.rulesHint')));
  await act(async () => { assert.equal(ref.current?.goBack(), false); });
 } finally { await view.close(); }
});

it('activity refresh preserves expanded pagination while a filter change resets it', async t => {
 resetMockStorage();
 const { AccountProvider } = await import('../src/context/AccountContext');
 const { default: ActivityOverlay } = await import('../src/screens/Activity/ActivityOverlay');
 const { LOCK_STATE_KEY } = await import('../src/constants/vault');
 const log = Array.from({ length: 45 }, (_, i) => ({ method: 'getPublicKey', decision: 'allow', domain: 'site.test', timestamp: Date.now() - i * 60000 }));
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string }) => ({ result: message.method === 'getActivityLog' ? [...log] : null }));
 const view = await mount();
 const render = (initialDomain: string | null) => view.render(createElement(AccountProvider, null, createElement(ActivityOverlay, { visible: true, initialDomain, initialPubkey: '', onClose() {} })));
 try {
  await render(null);
  assert.equal(document.querySelectorAll('time').length, 40);
  const more = [...document.querySelectorAll('button')].find(button => button.textContent === 'common.showMore')!;
  await act(async () => more.click());
  assert.equal(document.querySelectorAll('time').length, 45);
  await act(async () => browser.storage.local.set({ [LOCK_STATE_KEY]: true }));
  assert.equal(document.querySelectorAll('time').length, 45);
  await render('site.test');
  assert.equal(document.querySelectorAll('time').length, 40);
 } finally { await view.close(); }
});

it('wizard persistence retains a restored mid-flow step and clears it at entry points', async () => {
 resetMockStorage();
 const { default: useWizardFlow } = await import('../src/hooks/useWizardFlow');
 const { createInitialState } = await import('../src/domain/wizard/wizardMachine');
 const { WIZARD_STORAGE_KEY } = await import('../src/constants/wizard');
 const saved = createInitialState({ initialStep: WizardStep.Import });
 await browser.storage.session.set({ [WIZARD_STORAGE_KEY]: { ...saved, ts: Date.now() } });
 const view = await mount(); let flow!: ReturnType<typeof useWizardFlow>;
 function Probe() { flow = useWizardFlow({ persist: true }); return createElement('span', null, flow.step); }
 try {
  await view.render(createElement(Probe));
  assert.equal(flow.step, 'import');
  assert.equal((await browser.storage.session.get(WIZARD_STORAGE_KEY))[WIZARD_STORAGE_KEY].step, 'import');
  await view.render(createElement(Probe));
  assert.equal(flow.step, 'import');
  await act(async () => flow.reset());
  assert.equal(flow.step, 'lang');
  assert.equal((await browser.storage.session.get(WIZARD_STORAGE_KEY))[WIZARD_STORAGE_KEY], undefined);
 } finally { await view.close(); }
});

it('resetting the unlock form retires an in-flight success without clearing a newer draft', async t => {
 const view = await mount(), reply = deferred<{ result: boolean }>(); let successes = 0;
 let unlock!: ReturnType<typeof useVaultUnlock>;
 t.mock.method(browser.runtime, 'sendMessage', () => reply.promise);
 function Probe() { unlock = useVaultUnlock({ onSuccess: () => { successes++; } }); return null; }
 try {
  await view.render(createElement(Probe));
  await act(async () => unlock.setPassword('old-password'));
  let pending!: Promise<boolean>;
  await act(async () => { pending = unlock.unlock(); });
  await act(async () => unlock.reset());
  await act(async () => unlock.setPassword('new-draft'));
  await act(async () => { reply.resolve({ result: true }); await pending; });
  assert.equal(successes, 0);
  assert.equal(unlock.password, 'new-draft');
  assert.equal(unlock.loading, false);
 } finally { await view.close(); }
});

it('changing the wizard account retires the old check before account creation', async t => {
 resetMockStorage(); await browser.storage.local.set({ accounts: [{ id: 'existing' }] });
 const view = await mount(), firstCheck = deferred<{ result: boolean }>(); let checks = 0;
 const added: unknown[] = [];
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string; params?: { account?: unknown } }) => {
  if (message.method === 'vault_exists') return ++checks === 1 ? firstCheck.promise : { result: true };
  if (message.method === 'onboarding_addToVault') added.push(message.params?.account);
  return { result: false };
 });
 const oldAccount = { id: 'old' }, currentAccount = { id: 'current' };
 try {
  await view.render(createElement(PasswordStep, { account: oldAccount, upgradeId: null, onNext() {} }));
  await view.render(createElement(PasswordStep, { account: currentAccount, upgradeId: null, onNext() {} }));
  await act(async () => firstCheck.resolve({ result: true }));
  assert.deepEqual(added, [currentAccount]);
 } finally { await view.close(); }
});

it('PQ home reads only cached evidence; entering settings refreshes once and account changes refresh the new identity', async t => {
 resetMockStorage();
 const { AccountProvider } = await import('../src/context/AccountContext');
 const { PqcProvider, usePqc } = await import('../src/context/PqcContext');
 const { default: PqcSection } = await import('../src/screens/Settings/PqcSection');
 const { PQC_HOW_SEEN_KEY } = await import('../src/constants/pqc');
 const accounts = ['a', 'b'].map(id => ({ id, pubkey: id.repeat(64), name: id, type: 'generated' }));
 await browser.storage.local.set({ accounts, activeAccountId: 'a', [PQC_HOW_SEEN_KEY]: true });
 const reads: { cached: boolean; account: string }[] = [];
 let current = accounts[0];
 let confirmed = false;
 t.mock.method(browser.runtime, 'sendMessage', async (message: { method: string; params?: { cachedOnly?: boolean } }) => {
  if (message.method === 'pqc_getStatus') return { result: { pubkey: current.pubkey, canDerive: true, canImport: false, source: 'derived', reason: null, wordCount: 24, keys: { kem: current.id, dsa: current.id }, attestation: null } };
  if (message.method === 'pqc_checkPublished') {
   reads.push({ cached: message.params?.cachedOnly === true, account: current.id });
   if (!message.params?.cachedOnly) confirmed = true;
   return { result: confirmed ? { published: true, current: true } : null };
  }
  return { result: null };
 });
 function Probe() {
  const { published } = usePqc();
  return createElement('output', null, published?.published ? 'published' : 'unknown');
 }
 const view = await mount();
 const render = (settings: boolean) => view.render(createElement(AccountProvider, null, createElement(PqcProvider, null, createElement(Probe), settings ? createElement(PqcSection) : null)));
 try {
  await render(false);
  assert.equal(document.querySelector('output')?.textContent, 'unknown');
  assert.ok(reads.length > 0);
  assert.ok(reads.every(read => read.cached));
  await render(true);
  assert.equal(reads.filter(read => !read.cached).length, 1);
  assert.equal(document.querySelector('output')?.textContent, 'published');
  await render(true);
  assert.equal(reads.filter(read => !read.cached).length, 1, 'rerender must not repeat network reads');
  current = accounts[1]; confirmed = false;
  await act(async () => { await browser.storage.local.set({ activeAccountId: 'b' }); });
  assert.deepEqual(reads.filter(read => !read.cached).map(read => read.account), ['a', 'b']);
 } finally { await view.close(); }
});

it('account context renders local identity while profile relay requests remain unanswered', async t => {
 const view = await mount();
 resetMockStorage();
 const pubkey = 'ab'.repeat(32);
 await browser.storage.local.set({ accounts: [{ id: 'local', name: 'Local account', pubkey, type: 'npub', readOnly: true }], activeAccountId: 'local', profileCache: { [pubkey]: { name: 'Cached profile' } } });
 let profileRequests = 0;
 t.mock.method(browser.runtime, 'sendMessage', async ({ method }: { method: string }) => {
  assert.equal(method, 'getProfileMetadata');
  profileRequests++;
  return new Promise(() => {});
 });
 function Identity() {
  const account = useAccount();
  return createElement('span', null, account.active?.name, ' / ', account.cachedProfile?.name);
 }
 try {
  await view.render(createElement(AccountProvider, null, createElement(Identity)));
  assert.equal(document.body.textContent, 'Local account / Cached profile');
  assert.equal(profileRequests, 1);
 } finally { await view.close(); }
});

it('site state resolves from storage while the background never answers', async () => {
 resetMockStorage();
 await browser.storage.local.set({ allowedDomains: ['https://example.com'], identityDisabledSites: [] });
 const originalQuery = browser.tabs.query;
 const originalSend = browser.runtime.sendMessage;
 let sent = 0;
 browser.tabs.query = () => Promise.resolve([{ id: 7, url: 'https://example.com/page' }]) as never;
 // A worker start that stalls: every message is held forever.
 browser.runtime.sendMessage = () => { sent++; return new Promise(() => {}); };
 const view = await mount();
 let seen: { siteState: string | null; identityEnabled: boolean } | null = null;
 function Probe() { seen = useSiteState({ id: 'a1' } as never); return null; }
 try {
  await view.render(createElement(Probe));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(seen!.siteState, 'connected');
  assert.equal(seen!.identityEnabled, true);
  assert.equal(sent, 0, 'the home card must not wait on the background');
 } finally {
  await view.close();
  browser.tabs.query = originalQuery;
  browser.runtime.sendMessage = originalSend;
 }
});

it('latch stays true after its value goes back to false', async () => {
 const view = await mount();
 const seen: boolean[] = [];
 function Probe({ value }: { value: boolean }) { seen.push(useLatch(value)); return null; }
 try {
  await view.render(createElement(Probe, { value: false }));
  assert.equal(seen.at(-1), false, 'never requested: nothing to load');
  await view.render(createElement(Probe, { value: true }));
  assert.equal(seen.at(-1), true);
  await view.render(createElement(Probe, { value: false }));
  assert.equal(seen.at(-1), true, 'closing keeps it mounted for its exit animation');
 } finally { await view.close(); }
});
