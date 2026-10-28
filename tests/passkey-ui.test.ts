import PasswordStep from '../src/screens/Wizard/PasswordStep';
import PasskeySection from '../src/screens/Settings/PasskeySection.tsx';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import browser from './helpers/browser-mock.ts';
import PasskeyStep from '../src/screens/Wizard/PasskeyStep.tsx';
import PasskeyBackupStep from '../src/components/PasskeyRecoverySetup/index.tsx';
import PasskeyRecoverySave from '../src/components/PasskeyRecoverySave';
import MethodStep from '../src/screens/Wizard/MethodStep.tsx';
import ActionTile from '../src/components/ActionTile';
import UnlockSection from '../src/screens/Prompt/UnlockSection.tsx';

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  return { dom, root: createRoot(document.getElementById('root')!) };
}
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label || node.querySelector('strong')?.textContent === label)!;

test('passkey recovery download alone does not skip acknowledgement and never recreates the vault', async context => {
  const { dom, root } = mount(); const calls: string[] = []; let completed = 0;
  context.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', () => {});
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message.method); return { result: '{}' }; });
  try {
    await act(async () => root.render(createElement(PasskeyBackupStep, { onNext: () => completed++ })));
    assert.equal(button('common.continue').disabled, true);
    await act(async () => button('passkey.download').click());
    assert.equal(button('common.continue').disabled, true);
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    assert.equal(button('common.continue').disabled, false);
    await act(async () => button('common.continue').click());
    assert.equal(completed, 1);
    assert.deepEqual(calls, ['vault_exportPasskeyBackup']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('passkey create and restore entries only appear for a new vault', async () => {
  const { dom, root } = mount();
  try {
    await act(async () => root.render(createElement(MethodStep, { hasAccounts: false, onSelect: () => {} })));
    assert.match(document.body.textContent!, /passkey.create/);
    await act(async () => root.render(createElement(MethodStep, { hasAccounts: true, onSelect: () => {} })));
    assert.doesNotMatch(document.body.textContent!, /passkey.create|passkey.restore/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('passkey unlock hides password input and offers each registered fallback credential', async context => {
  const { dom, root } = mount();
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'vault_listPasskeys') return { result: [{ credentialId: 'first', prfSalt: 'salt' }, { credentialId: 'second', prfSalt: 'salt2' }] };
    if (message.method === 'vault_isLocked') return { result: true };
    if (message.method === 'vault_getAutoLock') return { result: 900000 };
    return { result: false };
  });
  try {
    await act(async () => root.render(createElement(UnlockSection, { onUnlocked: () => {} })));
    assert.equal(document.querySelector('input[type="password"]'), null);
    assert.ok(button('passkey.unlock'));
    assert.ok(document.querySelector('[aria-label="passkey.title"]'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('closing the unlock screen while passkey verification runs never unlocks the vault afterward', async context => {
  const { dom, root } = mount(); const methods: string[] = [];
  const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const originalPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  let finish!: (value: unknown) => void;
  const verification = new Promise(resolve => { finish = resolve; });
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: () => verification, create: async () => null } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    methods.push(message.method);
    if (message.method === 'vault_listPasskeys') return { result: [{ credentialId: 'AQID', prfSalt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }] };
    if (message.method === 'vault_isLocked') return { result: true };
    if (message.method === 'vault_getAutoLock') return { result: 900000 };
    return { result: false };
  });
  try {
    await act(async () => root.render(createElement(UnlockSection, { onUnlocked: () => assert.fail('closed view must not unlock') })));
    await act(async () => button('passkey.unlock').click());
    await act(async () => root.unmount());
    const secret = new Uint8Array(32).fill(8);
    await act(async () => finish({ rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: secret.buffer } } }) }));
    assert.equal(methods.includes('vault_unlockPasskey'), false);
    assert.ok(secret.every(byte => byte === 0));
  } finally {
    if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (originalPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
    dom.window.close();
  }
});

test('setup opens three other-method choices and uses hover-only accent borders', async () => {
 const { dom, root } = mount(); const selected: string[] = [];
 try {
  await act(async () => root.render(createElement(MethodStep, { hasAccounts: false, onSelect: id => selected.push(id) })));
  assert.ok(button('passkey.create')); assert.ok(button('wizard.createWithPhrase'));
  assert.match(document.body.textContent!, /common.or/);
  for (const card of document.querySelectorAll('button')) {
    assert.ok(card.classList.contains('bg-glass')); assert.ok(card.classList.contains('shadow-card'));
    assert.ok(card.classList.contains('hover:border-brand')); assert.ok(!card.classList.contains('border-brand'));
    assert.ok(card.querySelector('.gap-2'));
  }
  await act(async () => button('wizard.otherMethods').click()); assert.equal(selected.at(-1), 'moreOptions');
  await act(async () => root.render(createElement(MethodStep, { otherMethods: true, hasAccounts: false, onSelect: id => selected.push(id) })));
  assert.equal(document.querySelectorAll('button').length, 3);
  for (const [label, method] of [['recoveryFlow.title', 'import'], ['wizard.watchOnly', 'npub'], ['wizard.nostrConnect', 'nip46']]) {
    await act(async () => button(label).click()); assert.equal(selected.at(-1), method);
  }
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('add account offers direct account methods instead of new-vault setup', async () => {
 const { dom, root } = mount();
 try {
  await act(async () => root.render(createElement(MethodStep, { hasAccounts: true, hasGeneratedAccount: true, onSelect: () => {} })));
  assert.ok(button('wizard.createAnother'));
  assert.ok(button('wizard.otherMethods'));
  assert.equal(!!button('wizard.moreOptions'), false);
  assert.match(document.body.textContent!, /wizard.addAccountIntro/);
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('cancelled provider selection retries without creating a vault', async context => {
  const { dom, root } = mount(); const calls: string[] = []; let prompts = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: async () => { prompts++; return null; }, get: async () => null } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message.method); return { result: { account: { id: 'pending', name: 'Main', pubkey: 'a'.repeat(64) } } }; });
  try {
    await act(async () => root.render(createElement(PasskeyStep, { onNext: () => assert.fail('cancelled enrollment must not continue') })));
    await act(async () => button('passkey.create').click());
    assert.equal(prompts, 1);
    assert.ok(button('common.retry'));
    await act(async () => button('common.retry').click());
    assert.equal(prompts, 2);
    assert.deepEqual(calls, ['onboarding_generateAccount', 'onboarding_generateAccount']);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('confirmed provider storage makes the recovery file optional but failed storage still requires it', async context => {
  const { dom, root } = mount();
  const id = new Uint8Array([1, 2, 3]);
  const backup = JSON.stringify({ format: 'nostr-wot-passkey-vault', vault: {
    version: 2, protection: 'passkey', rpId: 'passkeys.nostr-wot.com',
    passkeys: [{ credentialId: 'AQID', prfSalt: Buffer.alloc(32).toString('base64'), iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(48).toString('base64') }],
    iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(16).toString('base64'),
  } });
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  let canWrite = true; let reads = 0; const completed: boolean[] = []; const calls: string[] = [];
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: async () => null, get: async ({ publicKey }: any) => {
    const writing = publicKey.extensions.largeBlob.write;
    if (!writing) reads++;
    return { rawId: id.buffer, getClientExtensionResults: () => ({ largeBlob: writing ? { written: canWrite } : { blob: new TextEncoder().encode(backup).buffer } }) };
  } } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message.method); return { result: backup }; });
  try {
    await act(async () => root.render(createElement(PasskeyBackupStep, { blobSupported: true, onNext: saved => completed.push(!!saved) })));
    assert.deepEqual(completed, [true]);
    assert.equal(reads, 0);
    assert.equal(button('passkey.saveToRelays'), undefined);
    assert.equal(button('passkey.download'), undefined);
    assert.equal(button('common.continue'), undefined);
    canWrite = false;
    await act(async () => root.render(createElement(PasskeyBackupStep, { key: 'failure', blobSupported: true, onNext: () => assert.fail('must require file') })));
    assert.ok(button('passkey.saveToRelays'));
    assert.ok(button('passkey.download'));
    assert.equal(button('common.continue').disabled, true);
    assert.deepEqual(calls, ['vault_exportPasskeyBackup', 'vault_recordBlobSaved', 'vault_exportPasskeyBackup', 'vault_recordBlobUnavailable']);
    await act(async () => root.render(createElement(PasskeyBackupStep, { key: 'saved', saved: true, onNext: saved => completed.push(!!saved) })));
    assert.equal(button('passkey.saveToRelays'), undefined);
    assert.equal(button('passkey.download'), undefined);
    assert.equal(button('common.continue'), undefined);
    assert.deepEqual(completed, [true, true]);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('restoration offers passkey discovery first and a selectable file fallback', async () => {
  const { dom, root } = mount();
  try {
    await act(async () => root.render(createElement(PasskeyStep, { restore: true, onNext: () => {} })));
    assert.equal(document.querySelector('input[type="file"]'), null);
    assert.equal(button('passkey.restore').disabled, false);
    assert.ok(button('passkey.useFile'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('closing recovery save aborts the request and cannot advance onboarding', async context => {
  const { dom, root } = mount();
  let finish!: (value: unknown) => void;
  context.mock.method(browser.runtime, 'sendMessage', () => new Promise(resolve => { finish = resolve; }));
  try {
    await act(async () => root.render(createElement(PasskeyRecoverySave, { autoStart: true, onSaved: () => assert.fail('closed view advanced'), onUnavailable: () => assert.fail('closed view changed recovery mode') })));
    await act(async () => root.unmount());
    await act(async () => finish({ result: '{}' }));
  } finally { dom.window.close(); }
});

test('passkey setup uses a default name without asking for an account or credential name', async () => {
  const { dom, root } = mount();
  try {
    await act(async () => root.render(createElement(PasskeyStep, { onNext: () => {} })));
    assert.equal(document.querySelector('#passkey-name'), null);
    assert.ok(button('passkey.create'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('passkey discovery retries an unanswered cold-worker read', async context => {
  const { dom, root } = mount();
  const realTimeout = globalThis.setTimeout;
  context.mock.method(globalThis, 'setTimeout', (callback: any, delay?: number, ...args: any[]) => realTimeout(callback, delay === 4000 ? 1 : delay, ...args));
  let attempts = 0;
  context.mock.method(browser.runtime, 'sendMessage', (message: any) => {
    if (message.method === 'vault_listPasskeys') {
      attempts++;
      if (attempts === 1) return new Promise(() => {});
      return Promise.resolve({ result: [{ credentialId: 'AQID', prfSalt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }] });
    }
    return Promise.resolve({ result: true });
  });
  try {
    await act(async () => root.render(createElement(UnlockSection, { onUnlocked: () => {} })));
    await act(async () => new Promise(resolve => realTimeout(resolve, 25)));
    assert.equal(attempts, 2);
    assert.equal(!!button('passkey.unlock'), true);
    assert.equal(document.querySelector('input[type="password"]'), null);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('use-passkey switch is unavailable without enrollment and checks password before browser verification', async context => {
  const { default: UnlockMethod } = await import('../src/screens/Settings/UnlockMethodSection');
  const { dom, root } = mount();
  const methods: string[] = [];
  let enrolled = false;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    methods.push(message.method);
    if (message.method === 'vault_listPasskeys') return { result: enrolled ? [{ credentialId: 'AQID', prfSalt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }] : [] };
    return { result: false };
  });
  try {
    await act(async () => root.render(createElement(UnlockMethod, { passkey: false, locked: false, neverLock: true, onChanged() {} })));
    assert.equal((document.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled, true);
    enrolled = true;
    await act(async () => root.render(createElement(UnlockMethod, { key: 'enrolled', passkey: false, locked: false, neverLock: true, onChanged() {} })));
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button('common.confirm').click());
    assert.match(document.body.textContent!, /key.wrongPassword/);
    assert.equal(methods.includes('vault_changeProtection'), false);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('raised action cards preserve native disabled behavior', async () => {
  const { dom, root } = mount(); let clicks = 0;
  try {
    await act(async () => root.render(createElement(ActionTile, { raised: true, disabled: true, icon: null, title: 'Choice', onClick: () => clicks++ })));
    assert.equal(button('Choice').disabled, true);
    await act(async () => button('Choice').click());
    assert.equal(clicks, 0);
    await act(async () => root.render(createElement(ActionTile, { raised: true, icon: null, title: 'Choice', onClick: () => clicks++ })));
    await act(async () => button('Choice').click());
    assert.equal(clicks, 1);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('import is the single recovery entry and troubleshooting stays collapsed', async () => {
  const { dom, root } = mount(); const selected: string[] = [];
  try {
    await act(async () => root.render(createElement(PasskeyStep, { onNext: () => {} })));
    assert.equal(document.querySelector('details'), null);
    await act(async () => root.render(createElement(MethodStep, { otherMethods: true, onSelect: id => selected.push(id) })));
    assert.equal(button('passkey.advancedCreate'), undefined);
    assert.equal(button('passkey.restore'), undefined);
    await act(async () => button('recoveryFlow.title').click());
    assert.equal(selected.at(-1), 'import');
    await act(async () => root.render(createElement(PasskeyStep, { advanced: true, onNext: () => {} })));
    assert.equal(document.querySelector('details')?.open, false);
    assert.equal(document.querySelector('#recovery-scope'), null);
    assert.equal((document.querySelector('#recovery-domain') as HTMLInputElement).value, 'passkeys.nostrwot.com');
    await act(async () => root.render(createElement(PasskeyStep, { restore: true, onNext: () => {} })));
    assert.equal(document.querySelector('details')?.open, false);
    assert.equal(document.querySelector('#recovery-scope'), null);
    assert.ok(document.querySelector('#recovery-domain'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('missing passkey recovery automatically opens the recovery file picker', async () => {
  const { dom, root } = mount();
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => null,
    get: async () => ({ rawId: new Uint8Array([1, 2, 3]).buffer, response: { userHandle: null }, getClientExtensionResults: () => ({}) }),
  } });
  try {
    await act(async () => root.render(createElement(PasskeyStep, { restore: true, onNext: () => assert.fail('missing recovery must not complete') })));
    await act(async () => button('passkey.restore').click());
    assert.ok(document.querySelector('input[type="file"]'));
    assert.match(document.body.textContent!, /Import your recovery file/);
    assert.equal(button('common.retry').disabled, true);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});


test('Security enrolls a first passkey after checking the existing unlock method, then requires a recovery file', async context => {
  const { default: UnlockMethod } = await import('../src/screens/Settings/UnlockMethodSection');
  const { dom, root } = mount();
  const calls: any[] = []; let changed = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    get: async () => assert.fail('registration PRF should be reused'),
    create: async () => {
      assert.ok(calls.some(call => call.method === 'vault_unlock'));
      return { rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }) };
    },
  } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method === 'vault_listPasskeys') return { result: [] };
    if (message.method === 'vault_listAccounts') return { result: [{ type: 'nsec', pubkey: 'a'.repeat(64) }] };
    if (message.method === 'vault_getActivePubkey') return { result: 'a'.repeat(64) };
    return { result: true };
  });
  try {
    await act(async () => root.render(createElement(UnlockMethod, { passkey: false, locked: false, neverLock: true, onChanged() { changed++; } })));
    await act(async () => button('security.setupPasskey').click());
    await act(async () => button('common.confirm').click());
    const change = calls.find(call => call.method === 'vault_changeProtection');
    assert.ok(change);
    assert.ok(button('passkey.download'));
    assert.equal(button('common.continue').disabled, true);
    assert.equal(changed, 0);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});


test('direct passkey creation starts once on entry and offers retry after cancellation', async context => {
  const { dom, root } = mount(); let prompts = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: async () => { prompts++; return null; }, get: async () => null } });
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: { account: { name: 'Main', pubkey: 'a'.repeat(64) } } }));
  try {
    await act(async () => root.render(createElement(PasskeyStep, { autoStart: true, onNext: () => assert.fail('cancelled') })));
    assert.equal(prompts, 1);
    assert.ok(button('common.retry'));
    await act(async () => root.render(createElement(PasskeyStep, { autoStart: true, onNext: () => {} })));
    assert.equal(prompts, 1);
    await act(async () => button('common.retry').click());
    assert.equal(prompts, 2);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('advanced setup confirms a discovered credential before relay recovery and never creates on discovery cancellation', async context => {
  const { dom, root } = mount();
  const calls: string[] = []; let prompts = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => assert.fail('discovery must not create a credential'),
    get: async () => { prompts++; return { rawId: new Uint8Array([1, 2, 3]).buffer, response: { userHandle: new Uint8Array(32).buffer }, getClientExtensionResults: () => ({}) }; },
  } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    return { error: 'Relays unavailable' };
  });
  try {
    await act(async () => root.render(createElement(PasskeyStep, { advanced: true, onNext: () => assert.fail('missing recovery') })));
    await act(async () => button('passkey.checkExisting').click());
    assert.equal(prompts, 1);
    assert.deepEqual(calls, []);
    assert.match(document.body.textContent!, /passkey.existingFound/);
    await act(async () => button('passkey.restore').click());
    assert.equal(prompts, 1, 'reuse the selected credential instead of prompting for discovery again');
    assert.deepEqual(calls, ['vault_fetchRelayRecovery']);
    assert.ok(document.querySelector('input[type="file"]'));
    await act(async () => button('common.cancel').click());
    assert.equal(document.querySelector('input[type="file"]'), null);
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: async () => { throw new DOMException('Cancelled', 'NotAllowedError'); } } });
    await act(async () => button('passkey.checkExisting').click());
    assert.equal(button('passkey.create'), undefined);
    assert.deepEqual(calls, ['vault_fetchRelayRecovery'], 'cancellation does not generate an account');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('passkey settings offers additional credentials in either domain without redundant migration or advanced controls', async context => {
  const { dom, root } = mount();
  let domain = 'passkeys.nostrwot.com';
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => ({ result: message.method === 'vault_checkRelayRecovery' ? [] : message.method === 'vault_listPasskeys' ? [{ credentialId: 'AQID', rpId: domain, prfSalt: 'salt', recoveryPubkey: 'a'.repeat(64), recoveryScope: 'seed' }] : null }));
  try {
    await act(async () => root.render(createElement(PasskeySection, { locked: false, account: { pubkey: 'a'.repeat(64), type: 'generated', readOnly: false } })));
    assert.equal(document.querySelector('details'), null);
    assert.equal(document.querySelector('#recovery-scope'), null);
    assert.ok(button('passkey.add'));
    assert.equal(button('passkey.saveRecovery'), undefined);
    assert.equal(button('passkey.migrate'), undefined);
    assert.ok(button('passkey.download'));
    domain = 'passkeys.example.com';
    await act(async () => root.render(createElement(PasskeySection, { key: domain, locked: false, account: { pubkey: 'a'.repeat(64), type: 'generated', readOnly: false } })));
    assert.equal(button('passkey.migrate'), undefined);
    assert.ok(button('passkey.add'));
    assert.equal(document.querySelector('[aria-pressed=true]')?.textContent?.includes(domain), true);
    await act(async () => root.render(createElement(PasskeySection, { key: 'locked', locked: true })));
    assert.equal(button('passkey.migrate'), undefined);
    assert.equal(button('passkey.add'), undefined);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('migration stays hidden when the old credential is selected but the same account already has a default-domain credential', async context => {
  const { dom, root } = mount();
  const metadata = { prfSalt: '', recoveryPubkey: 'a'.repeat(64) };
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => ({ result: message.method === 'vault_checkRelayRecovery' ? [] : [
    { ...metadata, credentialId: 'old', rpId: 'passkeys.example.com' },
    { ...metadata, credentialId: 'new', rpId: 'passkeys.nostrwot.com' },
  ] }));
  try {
    await act(async () => root.render(createElement(PasskeySection, { locked: false, account: { pubkey: metadata.recoveryPubkey, type: 'generated', readOnly: false } })));
    assert.equal(button('passkey.migrate'), undefined);
    assert.ok(document.body.textContent?.includes('passkeys.example.com'));
    assert.ok(button('passkey.add'));
    const rows = document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]');
    assert.equal(rows.length, 2);
    await act(async () => rows[1].click());
    assert.equal(rows[1].getAttribute('aria-pressed'), 'true');
    assert.equal(rows[0].getAttribute('aria-pressed'), 'false');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('adding a passkey in the same domain verifies the selected credential and keeps both enrollments', async context => {
  const { dom, root } = mount();
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  const pubkey = 'a'.repeat(64);
  const enrolled = [{ credentialId: 'AQID', rpId: 'passkeys.nostrwot.com', prfSalt: Buffer.alloc(32).toString('base64'), recoveryPubkey: pubkey, recoveryScope: 'seed' }];
  const sequence: string[] = [];
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    get: async () => { sequence.push('verify'); return { rawId: new Uint8Array([1,2,3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }) }; },
    create: async ({ publicKey }: any) => {
      sequence.push('create');
      assert.equal(publicKey.user.name, 'Nostr WoT Account 2');
      assert.equal(publicKey.user.displayName, 'Nostr WoT Account 2');
      assert.deepEqual([...new Uint8Array(publicKey.excludeCredentials[0].id)], [1,2,3]);
      return { rawId: new Uint8Array([4,5,6]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(8).buffer } }, largeBlob: { supported: false } }) };
    },
  } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'vault_checkRelayRecovery') return { result: [] };
    if (message.method === 'vault_listPasskeys') return { result: [...enrolled] };
    if (message.method === 'vault_listAccounts') return { result: [{ pubkey, type: 'generated', readOnly: false }] };
    if (message.method === 'vault_getActivePubkey') return { result: pubkey };
    if (message.method === 'vault_addPasskey') { sequence.push('enroll'); enrolled.push({ ...message.params.passkey }); }
    return { result: null };
  });
  try {
    await act(async () => root.render(createElement(PasskeySection, { locked: false, account: { pubkey, type: 'generated', readOnly: false } })));
    await act(async () => button('passkey.add').click());
    assert.deepEqual(sequence, [], 'naming must not prompt the authenticator');
    assert.equal(document.querySelector<HTMLInputElement>('input')?.value, 'Nostr WoT Account 2');
    await act(async () => button('common.continue').click());
    assert.deepEqual(sequence, ['verify', 'create', 'enroll']);
    assert.equal(enrolled.length, 2);
    assert.equal(document.querySelectorAll('button[aria-pressed]').length, 2);
    assert.equal(button('common.continue').disabled, true, 'unsupported blob requires file fallback');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});


test('passkey onboarding defaults to 15 minutes, hides passkey for None and reveals password fields when switched off', async context => {
  const { dom, root } = mount(); const calls: any[] = []; let completed = 0;
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message); return { result: null }; });
  try {
    await act(async () => root.render(createElement(PasswordStep, { configurePasskey: true, account: { id: 'existing' }, upgradeId: null, onNext: () => completed++ })));
    const toggle = document.querySelector<HTMLInputElement>('input[aria-label="security.usePasskey"]')!;
    assert.equal(toggle.checked, true);
    assert.equal(document.querySelectorAll('input[type=password]').length, 0);
    assert.equal(button('common.confirm').disabled, false);
    await act(async () => button('common.confirm').click());
    assert.equal(completed, 1);
    assert.deepEqual(calls.filter(item => item.method !== 'vault_listPasskeys').map(item => item.method), ['onboarding_configurePasskeyProtection']);
    assert.equal(calls.find(item => item.method === 'onboarding_configurePasskeyProtection').params.autoLockMs, 900000);
    await act(async () => toggle.click());
    assert.equal(document.querySelectorAll('input[type=password]').length, 2);
    assert.equal(button('common.confirm').disabled, true);
    await act(async () => button('common.none').click());
    assert.equal(document.querySelector('input[aria-label="security.usePasskey"]'), null);
    assert.equal(document.querySelectorAll('input[type=password]').length, 0);
    assert.equal(button('common.confirm').disabled, false);
    await act(async () => button('common.confirm').click());
    assert.deepEqual(calls.at(-1).params, { usePasskey: false, password: '', autoLockMs: 0 });
    assert.equal(calls.some(call => call.method === 'vault_getPasskey' || call.method === 'vault_changeProtection'), false);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('Passkey settings enroll an existing private-key account using None verification and require recovery', async context => {
  const { dom, root } = mount();
  const calls: any[] = [];
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    get: async () => assert.fail('registration PRF should be reused'),
    create: async () => {
      assert.ok(calls.some(call => call.method === 'vault_unlock'));
      return { rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }) };
    },
  } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message);
    if (message.method === 'vault_getAutoLock') return { result: 0 };
    if (message.method === 'vault_listPasskeys') return { result: [] };
    if (message.method === 'vault_listAccounts') return { result: [{ type: 'nsec', pubkey: 'a'.repeat(64) }] };
    if (message.method === 'vault_getActivePubkey') return { result: 'a'.repeat(64) };
    return { result: true };
  });
  try {
    await act(async () => root.render(createElement(PasskeySection, { locked: false, account: { type: 'nsec', pubkey: 'a'.repeat(64), readOnly: false } })));
    await act(async () => button('security.setupPasskey').click());
    await act(async () => button('common.confirm').click());
    const change = calls.find(call => call.method === 'vault_changeProtection');
    assert.ok(change);
    assert.equal(calls.find(call => call.method === 'vault_unlock').params.password, '');
    assert.equal(change.params.usePasskey, true);
    assert.ok(change.params.newPasskey);
    assert.equal(change.params.autoLockMs, undefined, 'retain existing changeProtection timer policy');
    assert.ok(button('passkey.download'));
    assert.equal(button('common.continue').disabled, true);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('empty passkey settings require password confirmation and hide setup for locked or nonlocal accounts', async context => {
  const { dom, root } = mount();
  const calls: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    if (message.method === 'vault_listPasskeys') return { result: [] };
    if (message.method === 'vault_getAutoLock') return { result: 900000 };
    return { result: false };
  });
  try {
    await act(async () => root.render(createElement(PasskeySection, { locked: false, account: { type: 'generated', pubkey: 'a'.repeat(64), readOnly: false } })));
    await act(async () => button('security.setupPasskey').click());
    assert.ok(document.querySelector('input[type="password"]'));
    assert.equal(button('common.confirm').disabled, true);
    assert.equal(calls.includes('vault_changeProtection'), false);
    for (const [key, locked, type, readOnly] of [['locked', true, 'nsec', false], ['remote', false, 'nip46', false], ['watch', false, 'nsec', true]] as const) {
      await act(async () => root.render(createElement(PasskeySection, { key, locked, account: { type, readOnly, pubkey: 'a'.repeat(64) } })));
      assert.equal(button('security.setupPasskey'), undefined);
    }
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('file recovery is available before and after a failed passkey lookup', async () => {
  const { dom, root } = mount();
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => null,
    get: async () => ({ rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ({ largeBlob: { blob: new TextEncoder().encode('not valid recovery').buffer } }) }),
  } });
  try {
    await act(async () => root.render(createElement(PasskeyStep, { restore: true, onNext: () => assert.fail('invalid recovery must not complete') })));
    assert.ok(button('passkey.useFile'));
    await act(async () => button('passkey.restore').click());
    assert.ok(button('passkey.useFile'));
    await act(async () => button('passkey.useFile').click());
    assert.ok(document.querySelector('input[type="file"]'));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});


test('add-account waits for seed discovery and exposes retry instead of assuming no seed', async context => {
  const { default: WizardOverlay } = await import('../src/screens/Wizard/WizardOverlay');
  const { dom, root } = mount();
  let reject!: (error: Error) => void;
  const response = new Promise((_resolve, fail) => { reject = fail; });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'onboarding_checkExistingSeed') return response;
    assert.fail(`Unexpected request before seed discovery: ${message.method}`);
  });
  try {
    await act(async () => root.render(createElement(WizardOverlay, { visible: true, canClose: true })));
    assert.equal(button('wizard.createAnother'), undefined);
    assert.equal(button('common.loading').disabled, true);
    await act(async () => reject(new Error('Seed check unavailable')));
    assert.match(document.body.textContent!, /Seed check unavailable/);
    assert.ok(button('common.retry'));
    assert.equal(button('wizard.createAnother'), undefined);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('first-account wizard stays mounted when creating the account adds it', async context => {
  // Creating a passkey account writes `accounts` while the wizard is still on
  // its recovery step. Unmounting then aborts and repeats the recovery write
  // (or re-runs Passkey's autoStart), which is the extra biometric prompt.
  const { default: WizardOverlay } = await import('../src/screens/Wizard/WizardOverlay');
  const { dom, root } = mount();
  const calls: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    return { result: null };
  });
  try {
    await act(async () => root.render(createElement(WizardOverlay, { visible: true, canClose: false })));
    const steps = document.querySelector('[class*="overflow-y-auto"]') ?? document.body.firstElementChild;
    const content = document.body.textContent;
    await act(async () => root.render(createElement(WizardOverlay, { visible: true, canClose: true })));
    assert.equal(calls.includes('onboarding_checkExistingSeed'), false, 'adding the first account must not restart seed discovery');
    assert.equal(document.body.textContent, content);
    assert.equal(steps?.isConnected, true, 'the wizard must not be unmounted and remounted');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('a wizard resumed before accounts load still learns that accounts exist', async context => {
  const { default: WizardOverlay } = await import('../src/screens/Wizard/WizardOverlay');
  const { dom, root } = mount();
  const calls: string[] = [];
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    return message.method === 'onboarding_checkExistingSeed' ? { result: { hasSeed: true } } : { result: null };
  });
  try {
    await act(async () => root.render(createElement(WizardOverlay, { visible: true, canClose: false, accountsLoaded: false })));
    assert.equal(calls.includes('onboarding_checkExistingSeed'), false);
    await act(async () => root.render(createElement(WizardOverlay, { visible: true, canClose: true, accountsLoaded: true })));
    assert.equal(calls.includes('onboarding_checkExistingSeed'), true, 'existing accounts must be recognised once known');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('confirming None after passkey creation completes without another credential request', async context => {
  const { dom, root } = mount();
  let completed = 0;
  let requests = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => null,
    get: async () => { requests++; throw new DOMException('Unexpected extra prompt', 'NotAllowedError'); },
  } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    if (message.method === 'vault_getPasskey') return { result: { rpId: 'passkeys.nostrwot.com', credentialId: 'AQID', prfSalt: 'AA==' } };
    return { result: null };
  });
  try {
    await act(async () => root.render(createElement(PasswordStep, { configurePasskey: true, account: { id: 'created' }, upgradeId: null, onNext: () => completed++ })));
    await act(async () => button('common.none').click());
    await act(async () => button('common.confirm').click());
    assert.equal(requests, 0, 'the final onboarding choice must reuse fresh verification');
    assert.equal(completed, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

for (const failure of ['duplicate', 'read']) test(`existing-vault ${failure} failure never exposes first-time auto-lock setup`, async context => {
  const { dom, root } = mount(); const calls: string[] = []; let completed = 0; let reject = true;
  await browser.storage.local.set({ accounts: [{ id: 'one' }, { id: 'two' }] });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    calls.push(message.method);
    if (message.method === 'vault_exists') return failure === 'read' && reject ? { error: 'Could not read vault' } : { result: true };
    if (message.method === 'vault_isLocked') return { result: false };
    if (message.method === 'onboarding_addToVault') return reject ? { error: 'This account is already added with full signing access.' } : { result: true };
    return { result: false };
  });
  try {
    await act(async () => root.render(createElement(PasswordStep, { account: { id: 'incoming', type: 'nip46' }, upgradeId: null, onNext: () => completed++ })));
    assert.match(document.body.textContent!, failure === 'read' ? /Could not read vault/ : /already added/);
    assert.doesNotMatch(document.body.textContent!, /wizard.protectYourAccountDesc|security.autoLock|wizard.minEightChars/);
    assert.equal(document.querySelector('input[type="password"]'), null);
    assert.equal(completed, 0);
    assert.ok(!calls.includes('onboarding_createVault'));
    reject = false;
    await act(async () => button('common.retry').click());
    assert.equal(completed, 1);
    assert.ok(!calls.some(method => ['onboarding_createVault', 'vault_setAutoLock', 'onboarding_configurePasskeyProtection'].includes(method)));
    assert.doesNotMatch(document.body.textContent!, /wizard.protectYourAccountDesc/);
  } finally { await act(async () => root.unmount()); dom.window.close(); await browser.storage.local.remove('accounts'); }
});
