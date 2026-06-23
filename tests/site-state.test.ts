import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveSiteState, shouldAutoAddDomain } from '../src/shared/siteState.ts';

const DOMAIN = 'example.com';

describe('resolveSiteState', () => {
  it('returns "connected" when the domain is in allowedDomains', () => {
    assert.strictEqual(resolveSiteState(['example.com', 'other.com'], {}, DOMAIN), 'connected');
  });

  it('returns "connected" when signer perms exist but domain is not in allowedDomains', () => {
    assert.strictEqual(resolveSiteState([], { getPublicKey: 'allow' }, DOMAIN), 'connected');
  });

  it('returns "connected" when both allowlist and signer perms match', () => {
    assert.strictEqual(
      resolveSiteState(['example.com'], { signEvent: 'allow' }, DOMAIN),
      'connected',
    );
  });

  it('returns "notConnected" when allowlist and perms are both empty', () => {
    assert.strictEqual(resolveSiteState([], {}, DOMAIN), 'notConnected');
  });

  it('returns "notConnected" when domain is absent from a non-empty allowlist and has no perms', () => {
    assert.strictEqual(resolveSiteState(['other.com'], {}, DOMAIN), 'notConnected');
  });

  it('returns "error" only when BOTH inputs failed to load (null)', () => {
    assert.strictEqual(resolveSiteState(null, null, DOMAIN), 'error');
  });

  it('does not error when only allowedDomains failed but perms exist', () => {
    assert.strictEqual(resolveSiteState(null, { getPublicKey: 'allow' }, DOMAIN), 'connected');
  });

  it('does not error when only allowedDomains failed and perms are empty -> notConnected', () => {
    assert.strictEqual(resolveSiteState(null, {}, DOMAIN), 'notConnected');
  });

  it('does not error when only perms failed but domain is allowlisted', () => {
    assert.strictEqual(resolveSiteState(['example.com'], null, DOMAIN), 'connected');
  });

  it('does not error when only perms failed and domain is not allowlisted -> notConnected', () => {
    assert.strictEqual(resolveSiteState(['other.com'], null, DOMAIN), 'notConnected');
  });
});

describe('shouldAutoAddDomain', () => {
  it('is true when signer perms exist but domain is not in allowedDomains', () => {
    assert.strictEqual(shouldAutoAddDomain([], { getPublicKey: 'allow' }, DOMAIN), true);
  });

  it('is false when domain is already in allowedDomains', () => {
    assert.strictEqual(
      shouldAutoAddDomain(['example.com'], { getPublicKey: 'allow' }, DOMAIN),
      false,
    );
  });

  it('is false when there are no signer perms', () => {
    assert.strictEqual(shouldAutoAddDomain([], {}, DOMAIN), false);
  });

  it('treats null allowedDomains as empty (auto-add when perms exist)', () => {
    assert.strictEqual(shouldAutoAddDomain(null, { signEvent: 'allow' }, DOMAIN), true);
  });

  it('is false when both inputs are null', () => {
    assert.strictEqual(shouldAutoAddDomain(null, null, DOMAIN), false);
  });
});
