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
import {
  countDecisions,
  filterKeysForAccountKind,
  availablePermKeys,
  buildRuleKey,
  READ_ONLY_KEYS,
} from '../src/shared/permissionRules.ts';

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
