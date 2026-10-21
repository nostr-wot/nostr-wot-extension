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

test('passkey creation confirms auto-lock after recovery before following suggestions', () => {
  const created = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkey' } },
    { type: 'CREATED', payload: { account: { id: 'passkey-account' } } },
  ], { hasAccounts: false });
  assert.equal(created.step, WizardStep.PasskeyBackup);
  assert.equal(created.ctx.mnemonic, null);
  assert.equal(reducer(created, { type: 'BACK' }).step, WizardStep.PasskeyBackup);
  const protection = reducer(created, { type: 'DONE' });
  assert.equal(protection.step, WizardStep.Password);
  const following = reducer(protection, { type: 'SET' });
  assert.equal(following.step, WizardStep.FollowSuggestions);
  assert.equal(reducer(following, { type: 'BACK' }).step, WizardStep.FollowSuggestions);
  assert.equal(reducer(following, { type: 'DONE' }).step, WizardStep.Done);
});

test('restoring a passkey vault confirms auto-lock without creating another account', () => {
  const restored = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkeyRestore' } },
    { type: 'DONE', payload: { account: { id: 'restored' } } },
  ], { hasAccounts: false });
  assert.equal(restored.step, WizardStep.Password);
  assert.equal(reducer(restored, { type: 'SET' }).step, WizardStep.Done);
  assert.deepEqual(restored.ctx.account, { id: 'restored' });
  assert.equal(restored.ctx.mnemonic, null);
});

test('existing-account submenu routes all four methods and returns to its parent', () => {
  const start = fresh();
  for (const method of ['create', 'passkey', 'import', 'npub', 'nip46']) {
    const next = reducer(start, { type: 'SELECT', payload: { method } });
    assert.equal(next.step, method);
    if (['npub', 'nip46'].includes(method)) assert.equal(reducer(next, { type: 'BACK' }).step, 'moreOptions');
  }
  const importing = reducer(start, { type: 'SELECT', payload: { method: 'import' } });
  const restore = reducer(importing, { type: 'RESTORE_PASSKEY' });
  assert.equal(restore.step, 'passkeyRestore');
  assert.equal(reducer(restore, { type: 'BACK' }).step, 'moreOptions');
  assert.equal(reducer(importing, { type: 'RESTORE_PASSKEY' }, { hasAccounts: true }), importing);
  assert.equal(reducer(start, { type: 'RESTORE', payload: { step: 'moreOptions', ctx: start.ctx } }).step, 'method');
});

test('verified passkey storage survives navigation without requiring a file', () => {
  const created = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkey' } },
    { type: 'CREATED', payload: { account: { id: 'passkey-account' }, blobSupported: true } },
  ], {});
  assert.equal(created.ctx.passkeyBlobSupported, true);
  assert.equal(created.ctx.passkeyRecoverySaved, false);
  const following = reducer(created, { type: 'DONE', payload: { saved: true } });
  assert.equal(following.step, WizardStep.Password);
  const back = reducer(following, { type: 'BACK' });
  assert.equal(back.step, WizardStep.Password);
  assert.equal(back.ctx.passkeyRecoverySaved, true);
});


test('advanced passkey creation is reached only through other methods', () => {
  const start = fresh();
  const others = reducer(start, { type: 'SELECT', payload: { method: 'moreOptions' } });
  const options = others;
  assert.equal(options.step, WizardStep.MoreOptions);
  const advanced = reducer(options, { type: 'SELECT', payload: { method: 'passkeyAdvanced' } });
  assert.equal(advanced.step, WizardStep.PasskeyAdvanced);
  assert.equal(reducer(advanced, { type: 'BACK' }).step, WizardStep.MoreOptions);
  const created = reducer(advanced, { type: 'CREATED', payload: { account: { id: 'advanced' } } });
  assert.equal(created.step, WizardStep.PasskeyBackup);
  assert.equal(reducer(reducer(created, { type: 'DONE' }), { type: 'BACK' }).step, WizardStep.Password);
  assert.equal(reducer(options, { type: 'SELECT', payload: { method: 'passkeyAdvanced' } }, { hasAccounts: true }), options);
});

test('unreachable relays skip follow suggestions, and BACK does not return to them', () => {
  const password = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } },
    { type: 'CREATED', payload: { account: { id: 'a' }, mnemonic: 'seed words' } },
    { type: 'VERIFIED' },
    { type: 'SET', payload: { upgraded: false } },
  ], { hasAccounts: true });
  assert.equal(password.step, WizardStep.FollowSuggestions);
  const skipped = reducer(password, { type: 'UNAVAILABLE' }, { hasAccounts: true });
  assert.equal(skipped.step, WizardStep.PermissionCopy);
  assert.equal(skipped.ctx.followUnavailable, true);
  assert.equal(reducer(skipped, { type: 'BACK' }, { hasAccounts: true }).step, WizardStep.Password);
  // Reached normally, BACK still returns to the suggestions.
  const followed = reducer(password, { type: 'DONE' }, { hasAccounts: true });
  assert.equal(reducer(followed, { type: 'BACK' }, { hasAccounts: true }).step, WizardStep.FollowSuggestions);

  const firstRun = reducer(password, { type: 'UNAVAILABLE' }, { hasAccounts: false });
  assert.equal(firstRun.step, WizardStep.Done);
});

test('a skipped follow step sends a sub-account back to its own step', () => {
  const sub = run(fresh(), [
    { type: 'SELECT', payload: { method: 'create' } },
    { type: 'CREATED', payload: { account: { id: 'sub' } } },
    { type: 'UNAVAILABLE' },
  ], { hasAccounts: true, hasGeneratedAccount: true });
  assert.equal(sub.step, WizardStep.PermissionCopy);
  assert.equal(reducer(sub, { type: 'BACK' }, { hasAccounts: true, hasGeneratedAccount: true }).step, WizardStep.Subaccount);
});

test('a skipped follow step leaves passkey flows without a Back into created vault setup', () => {
  const skipped = run(fresh(), [
    { type: 'SELECT', payload: { method: 'passkey' } },
    { type: 'CREATED', payload: { account: { id: 'p' } } },
    { type: 'DONE' },
    { type: 'SET' },
    { type: 'UNAVAILABLE' },
  ], { hasAccounts: true });
  assert.equal(skipped.step, WizardStep.PermissionCopy);
  assert.equal(reducer(skipped, { type: 'BACK' }, { hasAccounts: true }).step, WizardStep.PermissionCopy);
});

test('passkey import from another app ends on its explanation after protection is set', () => {
  const steps = (options: WizardOptions, upgraded = false) => {
    const start = run(fresh(), [{ type: 'SELECT', payload: { method: 'moreOptions' } }, { type: 'SELECT', payload: { method: 'import' } }, { type: 'IMPORT_PASSKEY' }], options);
    assert.equal(start.step, WizardStep.PasskeyImport);
    assert.equal(start.ctx.method, 'passkeyImport');
    const imported = reducer(start, { type: 'IMPORTED', payload: { account: { id: 'a', pubkey: 'b'.repeat(64) }, upgradeId: upgraded ? 'ro' : null, host: 'beta.lawallet.io' } }, options);
    assert.equal(imported.step, WizardStep.Password);
    assert.equal(imported.ctx.passkeyImportHost, 'beta.lawallet.io');
    assert.equal(imported.ctx.upgradeId, upgraded ? 'ro' : null);
    assert.equal(reducer(imported, { type: 'BACK' }, options).step, WizardStep.PasskeyImport);
    return reducer(imported, { type: 'SET', payload: { upgraded } }, options);
  };
  const first = steps({ hasAccounts: false });
  assert.equal(first.step, WizardStep.PasskeyImported);
  assert.equal(reducer(first, { type: 'BACK' }, {}).step, WizardStep.PasskeyImported, 'no way back into a finished import');
  assert.equal(reducer(first, { type: 'DONE' }, {}).step, WizardStep.Done);
  const added = steps({ hasAccounts: true });
  assert.equal(added.step, WizardStep.PermissionCopy);
  assert.equal(reducer(added, { type: 'DONE' }, { hasAccounts: true }).step, WizardStep.PasskeyImported);
  assert.equal(steps({ hasAccounts: true }, true).step, WizardStep.PasskeyImported);
  const back = reducer(run(fresh(), [{ type: 'SELECT', payload: { method: 'import' } }, { type: 'IMPORT_PASSKEY' }], {}), { type: 'BACK' }, {});
  assert.equal(back.step, WizardStep.Import);
  assert.equal(back.ctx.method, 'import');
});

test('ordinary imports still finish without the passkey import explanation', () => {
  const s = run(fresh(), [
    { type: 'SELECT', payload: { method: 'import' } },
    { type: 'IMPORTED', payload: { account: { id: 'a' }, upgradeId: null } },
    { type: 'SET', payload: { upgraded: false } },
    { type: 'DONE' },
  ], { hasAccounts: true });
  assert.equal(s.step, WizardStep.Done);
});
