/**
 * A site's connection state comes from the allowlist, and from nothing else.
 *
 * This file previously asserted the opposite: that leftover signer permissions made a site
 * "connected" and should be auto-added back to the allowlist. That turned Disconnect into a
 * suggestion — `removeAllowedDomain` never cleared signer permissions, so the next popup
 * render silently re-added the domain and the pubkey was released again through the
 * allowlist shortcut in lib/signer.ts.
 *
 * It was worse than it looks: the check counted ANY non-empty permission map, including one
 * whose only entry is an explicit `deny`. A site the user had specifically refused was
 * therefore auto-connected. The tests asserting that behaviour are why nothing caught it.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveSiteState } from '../src/shared/siteState.ts';

const DOMAIN = 'example.com';

describe('resolveSiteState', () => {
  it('returns "connected" only when the domain is in allowedDomains', () => {
    assert.strictEqual(resolveSiteState(['example.com', 'other.com'], {}, DOMAIN), 'connected');
  });

  it('returns "notConnected" when signer perms exist but the domain is not allowed', () => {
    // Leftover permissions from a previous connection are not consent. Disconnect must
    // stick until the user connects again.
    assert.strictEqual(
      resolveSiteState([], { 'signEvent:1': 'allow' }, DOMAIN),
      'notConnected',
      'stale permissions must not resurrect a disconnected site',
    );
  });

  it('returns "notConnected" when the only record is an explicit deny', () => {
    assert.strictEqual(
      resolveSiteState([], { 'signEvent:1': 'deny' }, DOMAIN),
      'notConnected',
      'a refusal must never read as a connection',
    );
  });

  it('returns "connected" when both the allowlist and signer perms agree', () => {
    assert.strictEqual(resolveSiteState(['example.com'], { getPublicKey: 'allow' }, DOMAIN), 'connected');
  });

  it('returns "notConnected" for an unknown domain', () => {
    assert.strictEqual(resolveSiteState(['other.com'], {}, DOMAIN), 'notConnected');
  });

  it('returns "notConnected" when the allowlist loaded but is empty', () => {
    assert.strictEqual(resolveSiteState([], {}, DOMAIN), 'notConnected');
  });

  it('returns "error" only when the allowlist itself could not be read', () => {
    // Without the allowlist there is no way to answer the question, and guessing
    // "connected" would release the identity on a failed read.
    assert.strictEqual(resolveSiteState(null, null, DOMAIN), 'error');
    assert.strictEqual(resolveSiteState(null, {}, DOMAIN), 'error');
  });

  it('does not depend on the signer-permission read succeeding', () => {
    assert.strictEqual(resolveSiteState(['example.com'], null, DOMAIN), 'connected');
    assert.strictEqual(resolveSiteState([], null, DOMAIN), 'notConnected');
  });
});
