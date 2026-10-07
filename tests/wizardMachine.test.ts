import { WizardStep } from '../src/constants/wizard.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, createInitialState, type WizardState, type WizardOptions } from '../src/domain/wizard/wizardMachine.ts';

// Drive the pure wizard reducer through a sequence of {type,payload} actions.
function run(start: WizardState, actions: Array<{ type: string; payload?: Record<string, unknown> }>, options: WizardOptions): WizardState {
  return actions.reduce((s, a) => reducer(s, a, options), start);
}

const fresh = () => createInitialState({ skipLang: true }); // starts at 'method'

// The WoT download (wotSync) step was removed from onboarding (#menu-only).
// These tests lock in that the flow never routes through it and lands correctly.

test('wotSync is never reachable from any onboarding path', () => {
  // create -> verify -> password -> followSuggestions -> archive (no accounts yet)
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

test('import flow goes password -> archive (no accounts), skipping wotSync', () => {
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

test('upgraded import still goes through completion', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'i' }, upgradeId: 'up1' } },
    { type: 'SET', payload: { upgraded: true } },
  ], { hasGeneratedAccount: false, hasAccounts: true });
  assert.equal(s.step, 'done');
});

test('watch-only (npub) goes through completion / permCopy, not wotSync', () => {
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

test('subaccount flow reaches followSuggestions then completion, no wotSync', () => {
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

for (const method of ['create', 'import', 'npub', 'nip46']) {
  test(`${method}: permissions lead directly to completion`, () => {
    const state = { ...fresh(), step: WizardStep.PermissionCopy, ctx: { ...fresh().ctx, method, account: { id: 'a' } } };
    const archive = reducer(state, { type: 'DONE' }, { hasAccounts: true });
    assert.equal(archive.step, 'done');
    assert.equal(reducer(archive, { type: 'BACK' }).step, 'done');
    assert.equal(reducer(archive, { type: 'DONE' }).step, 'done');
  });
}
test('NIP-46 reaches completion after password with no existing account', () => {
  const state = run(fresh(), [
    { type: 'SELECT', payload: { method: 'nip46' } },
    { type: 'DONE', payload: { account: { id: 'remote' } } },
    { type: 'SET' },
  ], { hasAccounts: false });
  assert.equal(state.step, 'done');
});

test('unknown restored steps and unsupported methods cannot strand the wizard', () => {
  const state = createInitialState({ skipLang: true });
  assert.equal(reducer(state, { type: 'RESTORE', payload: { step: 'missing', ctx: state.ctx } }), state);
  assert.equal(reducer(state, { type: 'SELECT', payload: { method: 'missing' } }), state);
  const restored = reducer(state, { type: 'RESTORE', payload: { step: 'archive', ctx: state.ctx } });
  assert.equal(restored.step, WizardStep.Done);
  assert.equal(reducer(restored, { type: 'DONE' }).step, WizardStep.Done);
});

test('passkey creation requires encrypted recovery backup before following or archive, without mnemonic or password steps', () => {
  const created = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkey' } },
    { type: 'CREATED', payload: { account: { id: 'passkey-account' } } },
  ], { hasAccounts: false });
  assert.equal(created.step, WizardStep.PasskeyBackup);
  assert.equal(created.ctx.mnemonic, null);
  assert.equal(reducer(created, { type: 'BACK' }).step, WizardStep.PasskeyBackup);
  const following = reducer(created, { type: 'DONE' });
  assert.equal(following.step, WizardStep.FollowSuggestions);
  assert.equal(reducer(following, { type: 'BACK' }).step, WizardStep.PasskeyBackup);
  assert.equal(reducer(following, { type: 'DONE' }).step, WizardStep.Done);
});

test('restoring a passkey vault finishes without creating another account or password', () => {
  const restored = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkeyRestore' } },
    { type: 'DONE', payload: { account: { id: 'restored' } } },
  ], { hasAccounts: false });
  assert.equal(restored.step, WizardStep.Done);
  assert.deepEqual(restored.ctx.account, { id: 'restored' });
  assert.equal(restored.ctx.mnemonic, null);
});

test('more options adds a step only for specialized account methods', () => {
  const start = fresh();
  for (const method of ['create', 'passkey', 'import']) {
    assert.equal(reducer(start, { type: 'SELECT', payload: { method } }).step, method);
  }
  const more = reducer(start, { type: 'MORE_OPTIONS' });
  assert.equal(more.step, 'moreOptions');
  for (const method of ['npub', 'nip46', 'passkeyRestore']) {
    const selected = reducer(more, { type: 'SELECT', payload: { method } });
    assert.equal(selected.step, method);
    assert.equal(reducer(selected, { type: 'BACK' }).step, 'moreOptions');
  }
  assert.equal(reducer(more, { type: 'BACK' }).step, 'method');
});
