/**
 * The "Import a passkey from another app" wizard screens, with WebAuthn mocked.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/passkey-import-ui.test.ts
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import browser from './helpers/browser-mock.ts';
import { npubEncode } from '../src/lib/crypto/bech32.ts';
import ImportStep from '../src/screens/Wizard/ImportStep.tsx';
import PasskeyImportStep from '../src/screens/Wizard/PasskeyImportStep.tsx';
import PasskeyImportedStep from '../src/screens/Wizard/PasskeyImportedStep.tsx';

const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/passkey-key-mode-vectors.json', import.meta.url), 'utf8'));
const LAWALLET = VECTORS.derived_parameter_sets.find((item: any) => item.parameter_set === 2);

const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
const originalPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
afterEach(() => {
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials); else Reflect.deleteProperty(navigator, 'credentials');
  if (originalPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
});

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  return { dom, root: createRoot(document.getElementById('root')!) };
}
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label)!;

function passkey(handle: Uint8Array | null) {
  let prompts = 0;
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => assert.fail('no credential is created'),
    get: async () => {
      prompts++;
      const output = new Uint8Array(32).fill(7);
      return { rawId: new Uint8Array([1]).buffer, response: { userHandle: handle?.buffer ?? null }, getClientExtensionResults: () => ({ prf: { results: { first: output.buffer } } }) };
    },
  } });
  return () => prompts;
}

test('the import screen offers importing a passkey from another app', async context => {
  const { dom, root } = mount(); let opened = 0;
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: { hasSeed: false } }));
  try {
    await act(async () => root.render(createElement(ImportStep, { onNext: () => {}, onImportPasskey: () => opened++ })));
    await act(async () => button('passkeyImport.entry').click());
    assert.equal(opened, 1);
    await act(async () => root.render(createElement(ImportStep, { onNext: () => {} })));
    assert.equal(button('passkeyImport.entry'), undefined);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('a derived passkey is imported only after the npub is shown and confirmed', async context => {
  const { dom, root } = mount(); const methods: any[] = []; const requested: any[] = []; const done: any[] = [];
  context.mock.method(browser.permissions, 'request', async (arg: any) => { requested.push(arg); return true; });
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => {
    methods.push(message);
    return { result: { account: { id: 'imported', name: 'Imported', type: 'nsec', pubkey: LAWALLET.public_key }, upgradeFromReadOnly: null } };
  });
  const prompts = passkey(new TextEncoder().encode('3f2b8c1e-9d4a-4e7b-b5c2-1a6f0e8d7c94'));
  try {
    await act(async () => root.render(createElement(PasskeyImportStep, { onNext: (...args: unknown[]) => done.push(args) })));
    assert.equal(prompts(), 0, 'no browser prompt on mount');
    assert.match(document.body.textContent!, /LaWallet · beta\.lawallet\.io/);
    await act(async () => button('passkeyImport.continue').click());
    assert.equal(prompts(), 1);
    assert.deepEqual(requested, [{ origins: ['https://beta.lawallet.io/*'] }]);
    assert.match(document.body.textContent!, new RegExp(npubEncode(LAWALLET.public_key)));
    assert.doesNotMatch(document.body.textContent!, /passkeyImport.ambiguous/);
    assert.equal(button('passkeyImport.import').disabled, true, 'confirmation required');
    await act(async () => button('passkeyImport.import').click());
    assert.equal(methods.length, 0);
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button('passkeyImport.import').click());
    assert.deepEqual(methods.map(message => message.method), ['onboarding_validateNsec']);
    assert.equal(methods[0].params.input, LAWALLET.secret_key);
    assert.equal(done.length, 1);
    assert.equal((done[0][0] as any).pubkey, LAWALLET.public_key);
    assert.equal(done[0][1], null);
    assert.equal(done[0][2], 'beta.lawallet.io');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('cancelling the confirmation imports nothing and returns to the app choice', async context => {
  const { dom, root } = mount(); const methods: string[] = [];
  context.mock.method(browser.permissions, 'request', async () => true);
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { methods.push(message.method); return { result: {} }; });
  passkey(null);
  try {
    await act(async () => root.render(createElement(PasskeyImportStep, { onNext: () => assert.fail('cancelled import must not continue') })));
    await act(async () => button('passkeyImport.continue').click());
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button('common.cancel').click());
    assert.ok(button('passkeyImport.continue'));
    assert.equal(document.querySelector('input[type="checkbox"]'), null);
    assert.deepEqual(methods, []);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('a stored-mode passkey is refused with a message and nothing is imported', async context => {
  const { dom, root } = mount(); const methods: string[] = [];
  context.mock.method(browser.permissions, 'request', async () => true);
  context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { methods.push(message.method); return { result: {} }; });
  passkey(Uint8Array.from(Buffer.from('4e504b010279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')));
  try {
    await act(async () => root.render(createElement(PasskeyImportStep, { onNext: () => assert.fail('refused passkey must not continue') })));
    await act(async () => button('passkeyImport.continue').click());
    assert.match(document.body.textContent!, /passkeyImport.refusedStored/);
    assert.equal(document.querySelector('input[type="checkbox"]'), null);
    assert.ok(button('common.retry'));
    assert.deepEqual(methods, []);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('an account whose key does not match the confirmed npub is not continued', async context => {
  const { dom, root } = mount(); let continued = 0;
  context.mock.method(browser.permissions, 'request', async () => true);
  context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: { account: { id: 'x', type: 'nsec', pubkey: 'ab'.repeat(32) } } }));
  passkey(null);
  try {
    await act(async () => root.render(createElement(PasskeyImportStep, { onNext: () => continued++ })));
    await act(async () => button('passkeyImport.continue').click());
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await act(async () => button('passkeyImport.import').click());
    assert.equal(continued, 0);
    assert.match(document.body.textContent!, /wizard.importFailed/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('after import the original passkey is explained and protection is only offered', async () => {
  const { dom, root } = mount(); const events: string[] = [];
  try {
    await act(async () => root.render(createElement(PasskeyImportedStep, { host: 'beta.lawallet.io', onDone: () => events.push('done'), onProtect: () => events.push('protect') })));
    assert.match(document.body.textContent!, /passkeyImport.stillValid/);
    assert.match(document.body.textContent!, /passkeyImport.protectOffer/);
    await act(async () => button('common.later').click());
    await act(async () => button('passkeyImport.protect').click());
    assert.deepEqual(events, ['done', 'protect']);
    await act(async () => root.render(createElement(PasskeyImportedStep, { host: 'beta.lawallet.io', onDone: () => events.push('done') })));
    assert.equal(button('passkeyImport.protect'), undefined);
    assert.match(document.body.textContent!, /passkeyImport.protectLater/);
    await act(async () => button('common.continue').click());
    assert.deepEqual(events, ['done', 'protect', 'done']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
