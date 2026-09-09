/**
 * The permission-screen decision helpers.
 *
 * These lived inline in PermissionsSection, which is where the popup decides
 * what rules to *offer* — getting the narrowing wrong offers a read-only account
 * a signing rule that can never fire, and getting the counting wrong misreports
 * what a site is allowed to do on the summary line people actually read.
 *
 * Run with:
 *   node --import tsx --test tests/permissions-ui.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countDecisions, filterKeysForAccountKind, availablePermKeys, buildRuleKey } from '../src/domain/permissions/permissionRules.ts';
import { READ_ONLY_KEYS } from '@constants/permissions.ts';

describe('countDecisions', () => {
  it('counts allow and deny separately', () => {
    const c = countDecisions({ a: 'allow', b: 'allow', c: 'deny' });
    assert.deepEqual(c, { allow: 2, deny: 1 });
  });

  it('does not count "ask" as either', () => {
    // `ask` is the absence of a rule, not a third kind of rule. Counting it
    // would tell the user a site has permissions it does not have.
    assert.deepEqual(countDecisions({ a: 'ask', b: 'ask' }), { allow: 0, deny: 0 });
  });

  it('handles an empty bucket', () => {
    assert.deepEqual(countDecisions({}), { allow: 0, deny: 0 });
  });
});

describe('filterKeysForAccountKind', () => {
  const keys = ['getPublicKey', 'signEvent:1', 'sendMessages'];

  it('leaves a normal signing account alone', () => {
    assert.deepEqual(filterKeysForAccountKind(keys, {}), keys);
  });

  it('narrows a read-only account to what it can actually do', () => {
    // An npub account has no private key: every other rule could never fire.
    assert.deepEqual(filterKeysForAccountKind(keys, { readOnly: true }), READ_ONLY_KEYS);
  });

  it('narrows a NIP-46 account the same way', () => {
    // Signing is delegated to the remote signer, which holds its own policy.
    assert.deepEqual(filterKeysForAccountKind(keys, { nip46: true }), READ_ONLY_KEYS);
  });

  it('does not narrow in global mode, where rules span all accounts', () => {
    assert.deepEqual(filterKeysForAccountKind(keys, { readOnly: true }, true), keys);
  });
});

describe('availablePermKeys', () => {
  it('offers only keys with no rule yet', () => {
    assert.deepEqual(
      availablePermKeys(['getPublicKey', 'signEvent:1'], { 'signEvent:1': 'allow' }),
      ['getPublicKey'],
    );
  });

  it('excludes a key even when its rule is "ask"', () => {
    // It already has a row on the detail screen; offering to add it again
    // would produce a duplicate the user cannot tell apart.
    assert.deepEqual(availablePermKeys(['signEvent:1'], { 'signEvent:1': 'ask' }), []);
  });
});

describe('buildRuleKey', () => {
  it('uses the preset when not in custom mode', () => {
    assert.equal(buildRuleKey('signEvent:1', '30023', false), 'signEvent:1');
  });

  it('prefixes and trims a hand-typed kind', () => {
    assert.equal(buildRuleKey('signEvent:1', ' 30023 ', true), 'signEvent:30023');
  });
});

import { validCustomKind } from '../src/domain/permissions/permissionRules.ts';
it('custom rule kinds must be complete non-negative integer identifiers', () => {
  for (const value of ['', ' ', '-1', '1.5', '1e3', 'abc', '65536', '9007199254740992']) assert.equal(validCustomKind(value), false);
  for (const value of ['0', '1', '30023', '65535']) assert.equal(validCustomKind(value), true);
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PermissionRulesList from '../src/screens/Settings/PermissionRulesList';

it('permission rules render only the supplied account-filtered keys and their decisions', () => {
  const html=renderToStaticMarkup(createElement(PermissionRulesList,{
    keys:['getPublicKey'],permissions:{getPublicKey:'deny',hidden:'allow'},async onChange(){},
  }));
  assert.match(html,/perms.deny/);
  assert.doesNotMatch(html,/hidden|perms.allow/);
  const fallback=renderToStaticMarkup(createElement(PermissionRulesList,{keys:['getPublicKey'],permissions:{},async onChange(){}}));
  assert.match(fallback,/perms.ask/);
});

import DeclinedSites from '../src/screens/Settings/DeclinedSites';
it('declined-site duration reuses native selection with all supported durations', () => {
  const html=renderToStaticMarkup(createElement(DeclinedSites));
  assert.match(html,/<select/);
  assert.match(html,/border-control-border/);
  for (const duration of ['0','86400000','604800000','2592000000']) assert.match(html,new RegExp(`value="${duration}"`));
  assert.match(html,/perm.dismissDurationLabel/);
});

import DecisionRow from '../src/screens/Prompt/DecisionRow';
import PromptApp from '../src/entrypoints/prompt/PromptApp';
it('prompt choices use shared button styling and disable the entire decision form', () => {
  const html=renderToStaticMarkup(createElement(DecisionRow,{disabled:true,onDecision(){}}));
  assert.equal((html.match(/<button/g)||[]).length,4);
  assert.equal((html.match(/disabled=""/g)||[]).length,5);
  assert.match(html,/focus-visible:shadow-focus/);
  assert.doesNotMatch(html,/37,99,235|5,150,105|hover:-translate-y/);
  for (const choice of ['deny','once','session','always']) assert.match(html,new RegExp(`prompt.${choice}`));
});
it('prompt entry shell mounts the approval screen with its loading state', () => {
  const html=renderToStaticMarkup(createElement(PromptApp));
  assert.match(html,/common.loading/);
});
