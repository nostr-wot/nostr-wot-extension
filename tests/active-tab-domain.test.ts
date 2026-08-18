/**
 * Naming the current site without being allowed to read its URL.
 *
 * The browser strips `tab.url` unless the extension holds "tabs" or an explicit host
 * permission for that tab, and this extension holds neither by design. `activeTab` covers
 * the popup when the user opens it, but not necessarily when the background opens it for
 * an incoming request — which is precisely when the popup needs to name the site.
 *
 * Two things went wrong when the URL was missing: the home view showed an empty state, so
 * the Connect card never appeared and the site could not be connected at all; and the
 * approval overlay fell back to listing EVERY origin's pending requests, so one site's
 * popup showed another site's pending signature, event kind and content.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// activeTabDomain imports @shared/browser.ts, which prefers globalThis.browser over the
// (undefined in Node) chrome global — install the stub BEFORE importing it, as tests/rpc
// does for the same reason.
let tabs: unknown[] = [];
let origins: Record<number, string> = {};
let session: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).browser = {
  tabs: { query: () => Promise.resolve(tabs) },
  storage: { session: { get: (k: string) => Promise.resolve({ [k]: session[k] }) } },
  runtime: {
    sendMessage: (msg: { method?: string; params?: { tabId?: number } }) =>
      Promise.resolve({ result: msg?.method === 'getTabOrigin' ? (origins[msg.params?.tabId ?? -1] ?? null) : null }),
    lastError: undefined,
  },
};

const { resolveActiveTabDomain } = await import('../src/shared/activeTabDomain.ts');

function activeTab(tab: unknown) { tabs = tab ? [tab] : []; }
function backgroundKnows(map: Record<number, string>) { origins = map; }
function openedFor(ctx: unknown) { session = ctx ? { popupContext: ctx } : {}; }

describe('resolveActiveTabDomain', () => {
  beforeEach(() => { backgroundKnows({}); openedFor(null); });

  it('uses the URL when the browser gives us one', async () => {
    activeTab({ id: 3, url: 'https://example.com/feed' });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: 'example.com', restricted: false });
  });

  it('asks the background when the URL is withheld', async () => {
    activeTab({ id: 3 });                       // no url — the real shape without host permissions
    backgroundKnows({ 3: 'example.com' });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: 'example.com', restricted: false });
  });

  it('reports a browser page as restricted, not as a site', async () => {
    activeTab({ id: 3, url: 'chrome://extensions' });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: null, restricted: true });
  });

  it('returns null when neither source knows — callers must fail closed', async () => {
    activeTab({ id: 9 });
    backgroundKnows({ 3: 'example.com' });      // a different tab
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: null, restricted: false });
  });

  it('uses the site the background opened the popup for', async () => {
    // The popup was opened BY the background for an incoming request. `activeTab` does not
    // cover that case, so there is no URL to read — but the background knew the site, and
    // said so. Without this the popup showed "Navigate to a website to connect" and the
    // user had to close and reopen it by hand.
    activeTab({ id: 3 });
    openedFor({ origin: 'asking.example', tabId: 3, at: Date.now() });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: 'asking.example', restricted: false });
  });

  it('ignores a popup context left for a different tab', async () => {
    activeTab({ id: 9 });
    openedFor({ origin: 'asking.example', tabId: 3, at: Date.now() });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: null, restricted: false });
  });

  it('ignores a stale popup context', async () => {
    activeTab({ id: 3 });
    openedFor({ origin: 'asking.example', tabId: 3, at: Date.now() - 120_000 });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: null, restricted: false },
      'an old context must not mislabel a popup the user opened later by hand');
  });

  it('prefers the real URL over the popup context', async () => {
    activeTab({ id: 3, url: 'https://actual.example/x' });
    openedFor({ origin: 'stale.example', tabId: 3, at: Date.now() });
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: 'actual.example', restricted: false });
  });

  it('survives there being no active tab', async () => {
    activeTab(null);
    assert.deepStrictEqual(await resolveActiveTabDomain(), { domain: null, restricted: false });
  });
});
