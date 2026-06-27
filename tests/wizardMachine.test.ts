import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, createInitialState, type WizardState, type WizardOptions } from '../src/shared/wizardMachine.ts';

// Drive the pure wizard reducer through a sequence of {type,payload} actions.
function run(start: WizardState, actions: Array<{ type: string; payload?: Record<string, unknown> }>, options: WizardOptions): WizardState {
  return actions.reduce((s, a) => reducer(s, a, options), start);
}

const fresh = () => createInitialState({ skipLang: true }); // starts at 'method'

// The WoT download (wotSync) step was removed from onboarding (#menu-only).
// These tests lock in that the flow never routes through it and lands correctly.

test('wotSync is never reachable from any onboarding path', () => {
  // create -> verify -> password -> followSuggestions -> done (no accounts yet)
  const created = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } },
    { type: 'CREATED', payload: { account: { id: 'a' }, mnemonic: 'seed words' } },
    { type: 'VERIFIED' },
    { type: 'SET', payload: { upgraded: false } },
    { type: 'DONE' }, // followSuggestions DONE
  ], { hasGeneratedAccount: false, hasAccounts: false });
  assert.equal(created.step, 'done');
});

test('create flow with existing accounts ends at permCopy (not wotSync)', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } },
    { type: 'CREATED', payload: { account: { id: 'a' }, mnemonic: 'seed' } },
    { type: 'VERIFIED' },
    { type: 'SET', payload: { upgraded: false } },
    { type: 'DONE' },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(s.step, 'permCopy');
});

test('import flow goes password -> done (no accounts), skipping wotSync', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'i' }, upgradeId: null } },
    { type: 'SET', payload: { upgraded: false } },
  ], { hasGeneratedAccount: false, hasAccounts: false });
  assert.equal(s.step, 'done');
});

test('import flow with existing accounts goes password -> permCopy', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'i' }, upgradeId: null } },
    { type: 'SET', payload: { upgraded: false } },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(s.step, 'permCopy');
});

test('upgraded import still goes straight to done', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'i' }, upgradeId: 'up1' } },
    { type: 'SET', payload: { upgraded: true } },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(s.step, 'done');
});

test('watch-only (npub) goes straight to done / permCopy, not wotSync', () => {
  const noAcct = run(fresh(), [
    { type: 'SELECT', payload: { method: 'npub' } },
    { type: 'DONE', payload: { account: { id: 'n' } } },
  ], { hasAccounts: false });
  assert.equal(noAcct.step, 'done');

  const withAcct = run(fresh(), [
    { type: 'SELECT', payload: { method: 'npub' } },
    { type: 'DONE', payload: { account: { id: 'n' } } },
  ], { hasAccounts: true });
  assert.equal(withAcct.step, 'permCopy');
});

test('subaccount flow reaches followSuggestions then done, no wotSync', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } }, // hasGeneratedAccount -> subaccount
    { type: 'CREATED', payload: { account: { id: 'sub' } } },
    { type: 'DONE' }, // followSuggestions
  ], { hasGeneratedAccount: true, hasAccounts: false });
  assert.equal(s.step, 'done');
});

test('permCopy BACK returns to the right prior step (no wotSync)', () => {
  // create method -> permCopy should go back to followSuggestions
  const createPath = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } },
    { type: 'CREATED', payload: { account: { id: 'a' }, mnemonic: 'seed' } },
    { type: 'VERIFIED' },
    { type: 'SET', payload: { upgraded: false } },
    { type: 'DONE' }, // followSuggestions -> permCopy (hasAccounts)
    { type: 'BACK' },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(createPath.step, 'followSuggestions');

  // import method -> permCopy should go back to password
  const importPath = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'i' }, upgradeId: null } },
    { type: 'SET', payload: { upgraded: false } }, // -> permCopy (hasAccounts)
    { type: 'BACK' },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(importPath.step, 'password');
});
