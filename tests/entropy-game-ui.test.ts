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
  const { default: EntropyGame } = await import('../src/screens/Wizard/EntropyGame');
  const { resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const { dom, root } = await mount();
  const completed: Array<[string, number[]]> = [];
  try {
    await act(async () => root.render(createElement(EntropyGame, { onComplete: (kind: string, results: number[]) => { completed.push([kind, results]); } })));
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
    await act(async () => button('entropyGame.useSeed').click());
    assert.equal(completed.length, 1);
    assert.equal(completed[0][0], 'dice');
    assert.equal(completed[0][1].length, 100);
    assert.deepEqual(completed[0][1].slice(0, 2), [1, 1]);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

it('coin mode flips the coin and records heads as 1 and tails as 0', async () => {
  const { default: EntropyGame } = await import('../src/screens/Wizard/EntropyGame');
  const { resetMockStorage } = await import('./helpers/browser-mock');
  resetMockStorage();
  const { dom, root } = await mount();
  try {
    await act(async () => root.render(createElement(EntropyGame, { onComplete() {} })));
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
