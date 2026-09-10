/**
 * A site's connection state comes from the allowlist, and from nothing else.
 *
 * This file previously asserted the opposite: that leftover signer permissions made a site
 * "connected" and should be auto-added back to the allowlist. That turned Disconnect into a
 * suggestion — `removeAllowedDomain` never cleared signer permissions, so the next popup
 * render silently re-added the domain and the pubkey was released again through the
 * allowlist shortcut in services/signing/signer.ts.
 *
 * It was worse than it looks: the check counted ANY non-empty permission map, including one
 * whose only entry is an explicit `deny`. A site the user had specifically refused was
 * therefore auto-connected. The tests asserting that behaviour are why nothing caught it.
 *
 * The permissions argument is now gone from the signature entirely — it had been kept,
 * ignored via `void`, behind a comment claiming callers loaded it anyway, which was untrue:
 * the one caller fetched it for this call and nothing else, so every popup open paid for a
 * round trip whose result was discarded on the next line. The property those cases guarded
 * is structural now rather than asserted, which is why they are not replaced below.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveSiteState } from '../src/domain/site/siteState.ts';

const DOMAIN = 'example.com';

describe('resolveSiteState', () => {
  it('returns "connected" only when the domain is in allowedDomains', () => {
    assert.strictEqual(resolveSiteState(['example.com', 'other.com'], DOMAIN), 'connected');
  });

  it('returns "notConnected" for a domain absent from the allowlist', () => {
    // Whatever else is stored about a site — signer permissions from a previous
    // connection, an explicit deny — Disconnect must stick until the user
    // connects again. The allowlist is the only thing consulted.
    assert.strictEqual(
      resolveSiteState([], DOMAIN),
      'notConnected',
      'nothing outside the allowlist may resurrect a disconnected site',
    );
  });

  it('returns "notConnected" for an unknown domain', () => {
    assert.strictEqual(resolveSiteState(['other.com'], DOMAIN), 'notConnected');
  });

  it('returns "notConnected" when the allowlist loaded but is empty', () => {
    assert.strictEqual(resolveSiteState([], DOMAIN), 'notConnected');
  });

  it('returns "error" when the allowlist could not be read', () => {
    // Without the allowlist there is no way to answer the question. Guessing
    // "notConnected" shows the Connect card to a connected site; guessing
    // "connected" would release the identity on a failed read, which is worse.
    assert.strictEqual(resolveSiteState(null, DOMAIN), 'error');
  });
});

import { siteScopes, sitePermissionBucket } from '../src/domain/site/siteScope.ts';
it('legacy connection scope remains visible while new connections are origin isolated', () => {
  assert.equal(resolveSiteState(['legacy.test'], 'https://legacy.test:8443'), 'connected');
  assert.equal(resolveSiteState(['https://new.test'], 'https://new.test:8443'), 'notConnected');
  assert.deepEqual(siteScopes('https://legacy.test:8443'), ['https://legacy.test:8443', 'legacy.test']);
  assert.deepEqual(siteScopes('data:text/plain,x'), ['data:text/plain,x']);
  assert.deepEqual(siteScopes('https://legacy.test/path'), ['https://legacy.test/path']);
  assert.deepEqual(sitePermissionBucket({
    'legacy.test': { A: {getPublicKey:'allow', signEvent:'deny'}, B:{getPublicKey:'deny'} },
    'https://legacy.test': { A: {signEvent:'allow', webln_getBalance:'allow'} },
  }, 'https://legacy.test', 'A'), {getPublicKey:'allow', signEvent:'allow', webln_getBalance:'allow'});
});
