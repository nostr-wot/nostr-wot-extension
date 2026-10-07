import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import browser from './helpers/browser-mock.ts';
import PasskeyStep, { PasskeyBackupStep } from '../src/screens/Wizard/PasskeyStep.tsx';
import PasskeyRecoverySave from '../src/components/PasskeyRecoverySave';
import MethodStep from '../src/screens/Wizard/MethodStep.tsx';
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

test('setup groups three compact secondary choices below creation and an or divider', async () => {
 const { dom, root } = mount(); const selected: string[] = [];
 try {
  await act(async () => root.render(createElement(MethodStep, { hasAccounts: false, onSelect: id => selected.push(id) })));
  assert.ok(button('passkey.create'));
  assert.ok(button('wizard.createWithPhrase'));
  assert.equal(!!button('wizard.moreOptions'), false);
  assert.match(document.body.textContent!, /common.or/);
  const row = document.querySelector('[data-account-alternatives]')!;
  assert.equal(row.querySelectorAll('button').length, 3);
  for (const [label, method] of [['wizard.importShort', 'import'], ['wizard.watchOnly', 'npub'], ['wizard.nostrConnect', 'nip46']]) {
    await act(async () => button(label).click());
    assert.equal(selected.at(-1), method);
  }
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('add account offers direct account methods instead of new-vault setup', async () => {
 const { dom, root } = mount();
 try {
  await act(async () => root.render(createElement(MethodStep, { hasAccounts: true, hasGeneratedAccount: true, onSelect: () => {} })));
  assert.ok(button('wizard.createAnother'));
  assert.ok(button('wizard.importShort'));
  assert.ok(button('wizard.nostrConnect'));
  assert.ok(button('wizard.watchOnly'));
  assert.equal(!!button('wizard.moreOptions'), false);
  assert.match(document.body.textContent!, /wizard.addAccountIntro/);
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('cancelled provider selection offers a user-driven retry without creating an account', async context => {
  const { dom, root } = mount(); const calls: string[] = []; let prompts = 0;
  const oldCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
  const oldPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: async () => { prompts++; return null; }, get: async () => null } });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { calls.push(message.method); return { result: null }; });
  try {
    await act(async () => root.render(createElement(PasskeyStep, { onNext: () => assert.fail('cancelled enrollment must not continue') })));
    await act(async () => button('passkey.create').click());
    assert.equal(prompts, 1);
    assert.ok(button('common.retry'));
    await act(async () => button('common.retry').click());
    assert.equal(prompts, 2);
    assert.deepEqual(calls, []);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    if (oldCredentials) Object.defineProperty(navigator, 'credentials', oldCredentials); else Reflect.deleteProperty(navigator, 'credentials');
    if (oldPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', oldPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
  }
});

test('onboarding skips the recovery file only after provider-confirmed blob write, otherwise requires it', async context => {
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
    assert.equal(button('passkey.download'), undefined);
    canWrite = false;
    await act(async () => root.render(createElement(PasskeyBackupStep, { key: 'failure', blobSupported: true, onNext: () => assert.fail('must require file') })));
    assert.ok(button('passkey.download'));
    assert.equal(button('common.continue').disabled, true);
    assert.deepEqual(calls, ['vault_exportPasskeyBackup', 'vault_exportPasskeyBackup']);
    await act(async () => root.render(createElement(PasskeyBackupStep, { key: 'saved', saved: true, onNext: saved => completed.push(!!saved) })));
    assert.equal(button('passkey.download'), undefined);
    await act(async () => button('common.continue').click());
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
    await act(async () => button('passkey.useFile').click());
    assert.ok(document.querySelector('input[type="file"]'));
    assert.equal(button('passkey.restore').disabled, true);
    await act(async () => button('passkey.usePasskey').click());
    assert.equal(document.querySelector('input[type="file"]'), null);
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
    assert.equal(document.querySelector('input[type="text"], #passkey-name'), null);
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
