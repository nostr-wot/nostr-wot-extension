/**
 * Mounted onboarding UI: the dice/coin entropy game and the follow step's
 * escape hatch when relays are unreachable.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/entropy-game-ui.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';

async function mount() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://extension.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  return { dom, root: createRoot(document.getElementById('root')!) };
}

const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;

it('records dice rolls, replays the roll each time, and hands over exactly 100 results', async () => {
  const { default: EntropyGame } = await import('../src/screens/EntropyGame');
  const { resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const { dom, root } = await mount();
  const completed: Array<[string, number[]]> = [];
  try {
    await act(async () => root.render(createElement(EntropyGame, { onComplete: async (kind: string, results: number[]) => { completed.push([kind, results]); return completed.length > 1; } })));
    assert.equal(document.querySelector('.animate-die-roll'), null);
    await act(async () => button('entropyGame.record').click());
    const firstRoll = document.querySelector('.animate-die-roll');
    assert.ok(firstRoll, 'recording a result rolls the die');
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '6' })); });
    assert.notEqual(document.querySelector('.animate-die-roll'), firstRoll, 'each new result remounts the animation');
    assert.equal(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), '5');
    // Faces outside a die are ignored; Backspace undoes.
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '7' })); });
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace' })); });
    for (let i = 0; i < 99; i++) await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: String((i % 6) + 1) })); });
    assert.equal(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), '256');
    // The tab switch is locked while results exist, so kinds cannot mix.
    assert.equal(document.querySelector<HTMLButtonElement>('[role="tab"]')!.disabled, true);
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3' })); });
    // A failed build keeps every roll for a retry; success clears them.
    await act(async () => button('entropyGame.useSeed').click());
    assert.equal(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), '256');
    await act(async () => button('entropyGame.useSeed').click());
    assert.equal(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), '0');
    assert.equal(completed.length, 2);
    assert.equal(completed[0][0], 'dice');
    assert.equal(completed[0][1].length, 100);
    assert.deepEqual(completed[0][1].slice(0, 2), [1, 1]);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

it('coin mode flips the coin and records heads as 1 and tails as 0', async () => {
  const { default: EntropyGame } = await import('../src/screens/EntropyGame');
  const { resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const { dom, root } = await mount();
  try {
    await act(async () => root.render(createElement(EntropyGame, { onComplete: async () => true })));
    const coinTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === 'entropyGame.coin')!;
    await act(async () => coinTab.click());
    const [heads, tails] = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="entropyGame.record"]')];
    await act(async () => heads.click());
    assert.ok(document.querySelector('.animate-coin-flip'));
    await act(async () => tails.click());
    const log = [...document.querySelectorAll('.animate-result-pop, .bg-card.mono')].map((n) => n.textContent);
    assert.deepEqual(log, ['1', '0']);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

it('follow suggestions skip themselves when no relay returns a profile', async (t) => {
  const { default: Step } = await import('../src/screens/Wizard/FollowSuggestionsStep');
  const { resetFollowSuggestionsPreload } = await import('../src/screens/Wizard/followSuggestionsPreload');
  const { default: browser, resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  resetFollowSuggestionsPreload();
  t.mock.method(browser.runtime, 'sendMessage', async () => ({ result: null }));
  const { dom, root } = await mount();
  let unavailable = 0;
  try {
    await act(async () => root.render(createElement(Step, { onNext() {}, onUnavailable() { unavailable++; } })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    assert.equal(unavailable, 1);
  } finally { await act(async () => root.unmount()); dom.window.close(); resetFollowSuggestionsPreload(); }
});

it('the dice tab hands a phrase back without any words reaching session storage', async (t) => {
  const { persistCreated, restoreCreated, keepWizardOnCreate, CREATE_TTL_MS } = await import('../src/screens/Wizard/createdPhrase');
  const { WIZARD_STORAGE_KEY, WizardStep } = await import('../src/constants/wizard');
  const onboarding = await import('../src/services/background/onboarding-handlers');
  const { default: browser, resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  // Route the UI's RPCs to the real background handlers.
  t.mock.method(browser.runtime, 'sendMessage', async ({ method, params }: any) => ({ result: await onboarding.handlers.get(method)!(params) }));

  // The tab asks for the account without its words.
  const created: any = await onboarding.handlers.get('onboarding_generateAccount')!({ physical: { kind: 'coin', results: new Array(256).fill(0) }, hideMnemonic: true });
  assert.equal(created.mnemonic, undefined);
  await persistCreated(created.account.pubkey, 'coin', true);
  assert.ok(!JSON.stringify(await browser.storage.session.get(null)).includes('abandon'), 'no word of the phrase in session storage');

  // The Create step gets the words from the background, for that account only.
  assert.deepEqual(await restoreCreated(), { status: 'restored', phrase: { account: created.account, mnemonic: `${'abandon '.repeat(23)}art`, physical: 'coin', pendingBackup: true } });
  // Expired before anyone saw it: reported as lost, not silently replaced.
  assert.deepEqual(await restoreCreated(Date.now() + CREATE_TTL_MS), { status: 'lost', physical: 'coin' });
  await persistCreated('f'.repeat(64));
  assert.deepEqual(await restoreCreated(), { status: 'none' }, 'a marker for another account reveals nothing');

  await browser.storage.session.set({ [WIZARD_STORAGE_KEY]: { step: WizardStep.Create, ctx: {}, ts: 1 } });
  await keepWizardOnCreate();
  assert.ok((await browser.storage.session.get(WIZARD_STORAGE_KEY) as any)[WIZARD_STORAGE_KEY].ts > 1);
  await browser.storage.session.set({ [WIZARD_STORAGE_KEY]: { step: WizardStep.Password, ctx: {}, ts: 1 } });
  await keepWizardOnCreate();
  assert.equal((await browser.storage.session.get(WIZARD_STORAGE_KEY) as any)[WIZARD_STORAGE_KEY].ts, 1);
});

it('gentle scrolling honours reduced motion', async () => {
  const { scrollIntoViewGently } = await import('../src/utils/scroll');
  const calls: unknown[] = [];
  const element = { scrollIntoView: (options: unknown) => calls.push(options) } as unknown as Element;
  for (const reduce of [false, true]) {
    Object.assign(globalThis, { window: { matchMedia: () => ({ matches: reduce }) } });
    scrollIntoViewGently(element, 'start');
  }
  scrollIntoViewGently(null);
  assert.deepEqual(calls, [{ block: 'start', behavior: 'smooth' }, { block: 'start', behavior: 'instant' }]);
});

it('the follow check keeps a success but re-checks after a failure, reading fresh cache first', async (t) => {
  const { preloadFollowSuggestions, followSuggestions, resetFollowSuggestionsPreload } = await import('../src/screens/Wizard/followSuggestionsPreload');
  const { readFreshProfile } = await import('../src/services/profile/freshProfile');
  const { default: browser, resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  resetFollowSuggestionsPreload();
  let online = false;
  let lookups = 0;
  t.mock.method(browser.runtime, 'sendMessage', async () => { lookups++; return { result: online ? { name: 'Someone' } : null }; });

  assert.equal(await preloadFollowSuggestions(), false);
  await new Promise((r) => setTimeout(r, 0));
  online = true;
  assert.equal(await preloadFollowSuggestions(), true, 'a failure is not remembered');
  const afterSuccess = lookups;
  assert.equal(await preloadFollowSuggestions(), true);
  assert.equal(lookups, afterSuccess, 'a success is reused without asking again');

  // A fresh cached profile counts without any RPC.
  resetFollowSuggestionsPreload();
  const [first] = followSuggestions();
  await browser.storage.local.set({ [`profile_${first.hex}`]: { fetchedAt: Date.now(), metadata: { name: 'Cached' } } });
  assert.deepEqual(await readFreshProfile(first.hex), { name: 'Cached' });
  assert.equal(await readFreshProfile('ab'.repeat(32)), null);
  online = false;
  const before = lookups;
  assert.equal(await preloadFollowSuggestions(), true);
  assert.ok(lookups - before < followSuggestions().length, 'the cached profile answered without its own RPC');
  resetFollowSuggestionsPreload();
});
