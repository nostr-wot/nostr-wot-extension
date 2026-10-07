import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import browser from './helpers/browser-mock.ts';
import { PasskeyBackupStep } from '../src/screens/Wizard/PasskeyStep.tsx';
import MethodStep from '../src/screens/Wizard/MethodStep.tsx';
import UnlockSection from '../src/screens/Prompt/UnlockSection.tsx';

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  return { dom, root: createRoot(document.getElementById('root')!) };
}
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!;

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

test('first setup screen has two creation choices and direct import without specialized options', async () => {
 const { dom, root } = mount(); const selected: string[] = [];
 try {
  await act(async () => root.render(createElement(MethodStep, { hasAccounts: false, onSelect: id => selected.push(id) })));
  assert.doesNotMatch(document.body.textContent!, /passkey.restore|wizard.watchOnly|wizard.nostrConnect/);
  assert.ok(button('wizard.importExisting'));
  assert.ok(button('wizard.moreOptions'));
  await act(async () => button('wizard.importExisting').click());
  assert.deepEqual(selected, ['import']);
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});


test('more options exposes specialized methods and hides passkey restoration for existing vaults', async () => {
 const { dom, root } = mount(); const selected: string[] = [];
 try {
  await act(async () => root.render(createElement(MethodStep, { moreOptions: true, hasAccounts: false, onSelect: id => selected.push(id) })));
  assert.doesNotMatch(document.body.textContent!, /passkey.create|wizard.createWithPhrase|wizard.importExisting/);
  for (const [label, method] of [['wizard.nostrConnect', 'nip46'], ['passkey.restore', 'passkeyRestore'], ['wizard.watchOnly', 'npub']]) {
   const node = [...document.querySelectorAll('button')].find(node => node.textContent?.startsWith(label))!;
   await act(async () => node.click());
   assert.equal(selected.at(-1), method);
  }
  await act(async () => root.render(createElement(MethodStep, { moreOptions: true, hasAccounts: true, onSelect: () => {} })));
  assert.doesNotMatch(document.body.textContent!, /passkey.restore/);
 } finally { await act(async () => root.unmount()); dom.window.close(); }
});
