/**
 * Connecting a site must survive the popup being destroyed.
 *
 * `browser.permissions.request()` raises the BROWSER's own "allow access to this site"
 * dialog. On Chrome that dialog takes focus, which dismisses the extension popup — and a
 * dismissed popup's JS context is torn down, so nothing after the `await` ever runs. The
 * old handler awaited the permission first and recorded the user's consent second, so the
 * consent was exactly the part that got lost: the user clicked Connect, accepted Chrome's
 * dialog, reopened the popup and found the Connect button still there. Their second click
 * worked only because the host permission was already granted by then, so the request
 * resolved without a dialog and the popup survived to reach the second line.
 *
 * The order is therefore the whole fix: persist consent, THEN ask the browser.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { connectSite } from '../src/shared/connectSite.ts';

const DOMAIN = 'example.com';

function spyDeps(requestHostAccess: (d: string) => Promise<boolean>) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      persistConsent: async (d: string) => { calls.push(`persist:${d}`); },
      requestHostAccess: async (d: string) => { calls.push(`request:${d}`); return requestHostAccess(d); },
    },
  };
}

describe('connectSite', () => {
  it('records consent BEFORE asking the browser for host access', async () => {
    const { calls, deps } = spyDeps(async () => true);
    const result = await connectSite(DOMAIN, deps);
    assert.deepStrictEqual(calls, [`persist:${DOMAIN}`, `request:${DOMAIN}`]);
    assert.deepStrictEqual(result, { connected: true, hostAccess: true });
  });

  it('has already recorded consent by the time the browser dialog is showing', async () => {
    // The dialog is open and this promise will never settle, because the popup that was
    // awaiting it no longer exists. Consent must already be durable at this point.
    let persisted = false;
    const deps = {
      persistConsent: async () => { persisted = true; },
      requestHostAccess: () => new Promise<boolean>(() => {}),
    };

    connectSite(DOMAIN, deps);                      // deliberately not awaited
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(persisted, true, 'consent must survive a popup that never comes back');
  });

  it('keeps the consent when the user denies host access', async () => {
    const { calls, deps } = spyDeps(async () => false);
    const result = await connectSite(DOMAIN, deps);
    assert.deepStrictEqual(calls, [`persist:${DOMAIN}`, `request:${DOMAIN}`]);
    assert.deepStrictEqual(result, { connected: true, hostAccess: false },
      'the site stays connected; without host access no request can reach us anyway');
  });

  it('keeps the consent when the permission request throws', async () => {
    const { calls, deps } = spyDeps(async () => { throw new Error('user gesture required'); });
    const result = await connectSite(DOMAIN, deps);
    assert.deepStrictEqual(calls, [`persist:${DOMAIN}`, `request:${DOMAIN}`]);
    assert.deepStrictEqual(result, { connected: true, hostAccess: false });
  });

  it('reports failure when consent itself cannot be recorded', async () => {
    const deps = {
      persistConsent: async () => { throw new Error('storage unavailable'); },
      requestHostAccess: async () => true,
    };
    await assert.rejects(() => connectSite(DOMAIN, deps), /storage unavailable/);
  });

  it('does nothing without a domain', async () => {
    const { calls, deps } = spyDeps(async () => true);
    const result = await connectSite('', deps);
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(result, { connected: false, hostAccess: false });
  });
});
