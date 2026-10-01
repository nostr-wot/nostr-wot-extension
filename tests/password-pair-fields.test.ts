/**
 * `PasswordPairFields`'s live-checklist half: both requirement booleans at
 * once, not just the first one `validatePasswordPair` would report.
 *
 * This is the piece worth its own test. Six call sites hand-rolled
 * `longEnough` / `matches` / `ready` before this refactor, and five of them
 * never got as far as `ready` at all — they refused only once the button was
 * already pressed. `usePasswordPair` is a thin `useState` wrapper this repo
 * has no harness to render, so the derivation is pulled out pure and tested
 * here instead.
 *
 * Run with:
 *   node --import tsx --test tests/password-pair-fields.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePasswordPairState } from '../src/domain/vault/passwordPair.ts';
import { MIN_PASSWORD_LENGTH } from '@constants/vault.ts';

describe('derivePasswordPairState', () => {
  it('is not ready while too short, even if the two already match', () => {
    const state = derivePasswordPairState('short', 'short');
    assert.equal(state.longEnough, false);
    assert.equal(state.matches, true);
    assert.equal(state.ready, false);
  });

  it('is not ready while mismatched, even once long enough', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, `${long}x`);
    assert.equal(state.longEnough, true);
    assert.equal(state.matches, false);
    assert.equal(state.ready, false);
  });

  it('is ready exactly when both requirements hold', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, long);
    assert.equal(state.longEnough, true);
    assert.equal(state.matches, true);
    assert.equal(state.ready, true);
  });

  it('does not treat an empty confirm as a match', () => {
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    const state = derivePasswordPairState(long, '');
    assert.equal(state.matches, false);
  });

  it('carries validatePasswordPair\'s code for a caller with the checklist off', () => {
    assert.equal(derivePasswordPairState('short', 'short').problem, 'tooShort');
    const long = 'a'.repeat(MIN_PASSWORD_LENGTH);
    assert.equal(derivePasswordPairState(long, `${long}x`).problem, 'mismatch');
    assert.equal(derivePasswordPairState(long, long).problem, null);
  });

  it('honours a caller-supplied minimum, same as validatePasswordPair', () => {
    assert.equal(derivePasswordPairState('abcd', 'abcd', 4).ready, true);
    assert.equal(derivePasswordPairState('abc', 'abc', 4).ready, false);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NsecExportPanel from '../src/screens/Vault/NsecExportPanel';
import SeedExportPanel from '../src/screens/Vault/SeedExportPanel';
import ChangePasswordPanel from '../src/screens/Vault/ChangePasswordPanel';

it('secret panels start at the reveal warning without rendering export or copy values', () => {
  for (const Panel of [NsecExportPanel, SeedExportPanel]) {
    const html=renderToStaticMarkup(createElement(Panel,{onClose(){}}));
    assert.match(html,/key.revealKey/);
    assert.match(html,/key\.(nsecWarning|seedWarning)/);
    assert.doesNotMatch(html,/common.copy|key.downloadPlain|aria-pressed/);
  }
});

it('change-password panel starts with an invalid pair and disabled save action', () => {
  const html=renderToStaticMarkup(createElement(ChangePasswordPanel,{onClose(){}}));
  assert.match(html,/key.currentPw/);
  assert.match(html,/key.confirmNewPw/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>common.save<\/button>/);
});

it('change-password panel recognizes the vault RPC result and keeps errors retryable', async t => {
  const { JSDOM } = await import('jsdom');
  const { act } = await import('react');
  const { default: browser } = await import('./helpers/browser-mock');
  const dom = new JSDOM('<div id="root"></div>');
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const prior = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root')!);
  let fail = true, closed = 0;
  const calls: unknown[] = [];
  t.mock.method(browser.runtime, 'sendMessage', async (message: unknown) => {
    calls.push(message);
    return fail ? { error: 'Current password is incorrect' } : { result: { ok: true } };
  });
  try {
    await act(async () => root.render(createElement(ChangePasswordPanel, { onClose() { closed++; } })));
    const edit = async (placeholder: string, value: string) => act(async () => {
      const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await edit('key.currentPw', 'old-password');
    await edit('key.newPwMinChars', 'new-password');
    await edit('key.confirmNewPw', 'new-password');
    const save = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'common.save')!;
    assert.equal(save().disabled, false);
    await act(async () => save().click());
    assert.match(document.body.textContent!, /key.failedChangePassword/);
    assert.equal(closed, 0);
    fail = false;
    await act(async () => save().click());
    assert.match(document.body.textContent!, /key.passwordChanged/);
    assert.doesNotMatch(document.body.textContent!, /key.failedChangePassword/);
    assert.deepEqual(calls.at(-1), { method: 'vault_changePassword', params: { currentPassword: 'old-password', newPassword: 'new-password' } });
    await new Promise(resolve => setTimeout(resolve, 1550));
    assert.equal(closed, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
