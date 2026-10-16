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

it('localized unlock messages do not restart consumers when only their object identity changes', async t => {
 t.mock.method(browser.runtime, 'sendMessage', async () => ({ result: [] }));
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

it('wallet disconnect shares pending and error handling across entry points', async context => {
 const view = await mount();
 const { default: useWalletDisconnect } = await import('../src/hooks/useWalletDisconnect');
 let completed = 0, fail = true;
 context.mock.method(browser.runtime, 'sendMessage', async () => fail ? { error: 'Offline' } : { result: true });
 function Probe() {
  const state = useWalletDisconnect(() => completed++);
  return createElement('button', { onClick: state.disconnect, disabled: state.disconnecting }, state.disconnectError || 'Disconnect');
 }
 try {
  await view.render(createElement(Probe));
  await act(async () => document.querySelector('button')!.click());
  assert.equal(document.querySelector('button')!.textContent, 'Offline');
  assert.equal(document.querySelector('button')!.disabled, false);
  assert.equal(completed, 0);
  fail = false;
  await act(async () => document.querySelector('button')!.click());
  assert.equal(completed, 1);
 } finally { await view.close(); }
});

it('passkey names are edited in a portal dialog with relay availability', async context => {
 const view = await mount();
 const { default: PasskeySection } = await import('../src/screens/Settings/PasskeySection');
 const pubkey = 'a'.repeat(64);
 const credential = { credentialId: 'one', rpId: 'passkeys.nostrwot.com', recoveryPubkey: pubkey, name: 'Laptop' };
 const writes: any[] = [];
 context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
  if (message.method === 'vault_checkRelayRecovery') return { result: [{ relay: 'wss://nos.lol', status: 'found', checkedAt: Date.now() }] };
  if (message.method === 'vault_renamePasskey') { writes.push(message.params); credential.name = message.params.name; return { result: true }; }
  return { result: [credential] };
 });
 try {
  await view.render(createElement(PasskeySection, { locked: false, account: { pubkey, type: 'generated', readOnly: false } }));
  assert.equal(document.querySelector('input'), null);
  assert.doesNotMatch(document.body.textContent!, /Recovery copies|1\/1/);
  assert.ok(document.querySelector('button[aria-label="passkey.relayRecovery"]'));
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="passkey.name"]')!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  assert.ok(dialog);
  assert.equal(document.querySelector('#root')!.contains(dialog), false);
  const input = dialog.querySelector('input')!;
  await act(async () => {
   Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Hardware key');
   input.dispatchEvent(new view.dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'common.save')!.click());
  assert.deepEqual(writes, [{ credentialId: 'one', name: 'Hardware key' }]);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.match(document.body.textContent!, /Hardware key/);
 } finally { await view.close(); }
});

it('relay recovery icon reflects verified storage and opens relay controls without a row count', async context => {
 const view = await mount();
 const { default: RelayRecoverySave } = await import('../src/components/PasskeyRecoverySave/RelayRecoverySave');
 let blobSaved: boolean | null = true, found = false;
 const relays = ['wss://example.com/']; const additions: string[] = [];
 context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
  if (message.method === 'vault_getRecoveryStatus') return { result: { blobSaved, relays, accepted: {} } };
  if (message.method === 'vault_addRecoveryRelay') { additions.push(message.params.relay); relays.push(message.params.relay); return { result: true }; }
  return { result: relays.map(relay => ({ relay, status: found ? 'found' : 'missing', checkedAt: Date.now() })) };
 });
 try {
  await view.render(createElement(RelayRecoverySave, { credentialId: 'one', iconOnly: true }));
  const icon = () => document.querySelector<HTMLButtonElement>('button[aria-label="passkey.relayRecovery"]')!;
  assert.ok(icon().classList.contains('text-muted'));
  assert.equal(document.body.textContent, '');
  await act(async () => icon().click());
  assert.ok(document.querySelector('[role="dialog"]'));
  blobSaved = false;
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]')!.click());
  assert.ok(icon().classList.contains('text-warning'));
  found = true;
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="common.refresh"]')!.click());
  assert.ok(icon().classList.contains('text-success'));
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="passkey.addRelay"]')!.click());
  const input = document.querySelector('input')!;
  await act(async () => {
   Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'wss://second.example.com/');
   input.dispatchEvent(new view.dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'common.add')!.click());
  assert.deepEqual(additions, ['wss://second.example.com/']);
  assert.match(document.body.textContent!, /second.example.com/);
 } finally { await view.close(); }
});

it('Security offers None for a passkey vault and verifies the credential before disabling protection', async context => {
 const view = await mount();
 const { default: SecuritySection } = await import('../src/screens/Settings/SecuritySection');
 let passkey = true, ms = 900000;
 const calls: any[] = [];
 const original = Object.getOwnPropertyDescriptor(navigator, 'credentials');
 const originalPublic = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
 Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
 Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create() {}, get: async () => ({ rawId: new Uint8Array([1,2,3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }) }) } });
 const metadata = { credentialId: 'AQID', rpId: 'passkeys.nostrwot.com', prfSalt: Buffer.alloc(32).toString('base64') };
 context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
  calls.push(message);
  const results: Record<string, unknown> = { vault_exists: true, vault_isLocked: false, vault_getAutoLock: ms, vault_getPasskey: passkey ? metadata : null, vault_listPasskeys: [metadata], vault_getActiveAccountType: { type: 'generated' } };
  if (message.method === 'vault_changeProtection') { ms = 0; passkey = false; return { result: true }; }
  return { result: results[message.method] ?? null };
 });
 try {
  await view.render(createElement(VaultProvider, null, createElement(SecuritySection, { onChangePassword() {} })));
  const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  await act(async () => button('common.none').click());
  assert.equal(document.querySelector('input[aria-label="security.usePasskey"]'), null);
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.equal(calls.some(c => c.method === 'vault_changeProtection'), false);
  await act(async () => button('common.confirm').click());
  const change = calls.find(c => c.method === 'vault_changeProtection');
  assert.equal(change.params.autoLockMs, 0);
  assert.equal(change.params.password, '');
  assert.equal(change.params.usePasskey, false);
 } finally {
  await view.close();
  if (original) Object.defineProperty(navigator, 'credentials', original); else Reflect.deleteProperty(navigator, 'credentials');
  if (originalPublic) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublic); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
 }
});

it('every enrolled passkey has a recovery icon, including other-account and legacy credentials', async context => {
 const view = await mount();
 const { default: PasskeySection } = await import('../src/screens/Settings/PasskeySection');
 const pubkey = 'a'.repeat(64);
 context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
  if (message.method === 'vault_listPasskeys') return { result: [
   { credentialId: 'one', rpId: 'passkeys.nostrwot.com', recoveryPubkey: pubkey },
   { credentialId: 'two', rpId: 'passkeys.nostrwot.com', recoveryPubkey: 'b'.repeat(64) },
   { credentialId: 'old', rpId: 'passkeys.nostr-wot.com' },
  ] };
  if (message.method === 'vault_getRecoveryStatus') return { result: { blobSaved: null, relays: [], accepted: {} } };
  return { result: [] };
 });
 try {
  await view.render(createElement(PasskeySection, { locked: false, account: { pubkey, type: 'generated', readOnly: false } }));
  const icons = document.querySelectorAll<HTMLButtonElement>('button[aria-label="passkey.relayRecovery"]');
  assert.equal(icons.length, 3);
  await act(async () => icons[1].click());
  assert.match(document.body.textContent!, /passkey.selectRecoveryAccount/);
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === 'passkey.saveToRelays')!.disabled, true);
 } finally { await view.close(); }
});

it('a stale unlocked popup refreshes its unlock method after a signing failure without losing the profile draft', async t => {
 resetMockStorage();
 const { useVault } = await import('../src/context/VaultContext');
 const { rpc } = await import('../src/services/rpc');
 const { default: EditProfileOverlay } = await import('../src/screens/EditProfile/EditProfileOverlay');
 const pubkey = '11'.repeat(32);
 await browser.storage.local.set({ accounts: [{ id: 'a', pubkey, name: 'Account', type: 'imported' }], activeAccountId: 'a', profileCache: { [pubkey]: { name: 'Initial' } } });
 let locked = false;
 let autoLockMs = 0;
 t.mock.method(browser.runtime, 'sendMessage', async ({ method }: { method: string }) => {
  if (method === 'vault_exists') return { result: true };
  if (method === 'vault_isLocked') return { result: locked };
  if (method === 'vault_getAutoLock') return { result: autoLockMs };
  if (method === 'signAndPublishEvent') return { error: 'Vault is locked' };
  return { result: null };
 });
 function Probe() { const vault = useVault(); return createElement('output', null, `${vault.locked}:${vault.autoLockEnabled}`); }
 const view = await mount();
 try {
  await view.render(createElement(VaultProvider, null, createElement(AccountProvider, null, createElement(Probe), createElement(EditProfileOverlay, { visible: true, onClose() {} }))));
  const input = document.querySelector<HTMLInputElement>('input[placeholder="profileEdit.namePlaceholder"]')!;
  const setValue = Object.getOwnPropertyDescriptor(view.dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, 'My draft'); input.dispatchEvent(new view.dom.window.Event('input', { bubbles: true })); });
  assert.equal(document.querySelector('output')!.textContent, 'false:false');
  autoLockMs = 900000;
  await act(async () => { await browser.storage.local.set({ autoLockMs }); });
  assert.equal(document.querySelector('output')!.textContent, 'false:true');
  locked = true; // A restarted background worker has lost its in-memory session.
  await act(async () => { await assert.rejects(() => rpc('signAndPublishEvent'), /Vault is locked/); });
  assert.equal(document.querySelector('output')!.textContent, 'true:true');
  assert.equal(input.value, 'My draft');
 } finally { await view.close(); }
});

it('account switcher refreshes from the shared profile cache and ignores a late legacy read', async t => {
 resetMockStorage();
 const { default: AccountDropdown } = await import('../src/screens/TopBar/AccountDropdown');
 const { maintainProfileCache } = await import('../src/services/profile/displayCache');
 const pubkey = 'ab'.repeat(32);
 const old = { name: 'Before edit', picture: 'https://example.com/old.png' };
 const updated = { name: 'After edit', picture: 'https://example.com/new.png', nip05: 'new@example.com' };
 const pending = deferred<unknown>();
 await browser.storage.local.set({ accounts: [{ id: 'a', pubkey, name: 'Account 1', type: 'nsec' }], activeAccountId: 'a', profileCache: { [pubkey]: old } });
 t.mock.method(browser.runtime, 'sendMessage', async ({ method }: { method: string }) => method === 'getProfileMetadata' ? pending.promise : { result: null });
 const view = await mount();
 try {
  await view.render(createElement(AccountProvider, null, createElement(AccountDropdown, { onClose() {}, onAddAccount() {} })));
  assert.ok(document.body.textContent?.includes(old.name));
  await act(async () => { await maintainProfileCache(pubkey, { metadata: updated, fetchedAt: Date.now() }); });
  assert.ok(document.body.textContent?.includes(updated.name));
  assert.ok(document.body.textContent?.includes(updated.nip05));
  assert.equal(document.querySelector('img')?.getAttribute('src'), updated.picture);
  await act(async () => { pending.resolve({ result: old }); });
  assert.ok(document.body.textContent?.includes(updated.name));
  assert.equal(document.querySelector('img')?.getAttribute('src'), updated.picture);
 } finally { await view.close(); }
});
