import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originMatchesActiveTab, requestIsFromActiveTab } from '../lib/originMatchesActiveTab.ts';

// The popup must only auto-open for the tab the user is actually looking at —
// a background/inactive tab making (or polling) nostr requests must not pop it.

test('matches when the active tab hostname equals the origin', () => {
  assert.equal(originMatchesActiveTab('https://example.com/some/path', 'example.com'), true);
  assert.equal(originMatchesActiveTab('https://example.com', 'example.com'), true);
  assert.equal(originMatchesActiveTab('http://localhost:3000/app', 'localhost'), true);
});

test('does NOT match a different active-tab host (inactive/other tab requesting)', () => {
  assert.equal(originMatchesActiveTab('https://other.com', 'example.com'), false);
});

test('subdomain of the origin does not match the bare origin', () => {
  assert.equal(originMatchesActiveTab('https://sub.example.com', 'example.com'), false);
});

test('no active tab url -> false (e.g. no active tab / new-tab page)', () => {
  assert.equal(originMatchesActiveTab(undefined, 'example.com'), false);
  assert.equal(originMatchesActiveTab(null, 'example.com'), false);
  assert.equal(originMatchesActiveTab('', 'example.com'), false);
});

test('empty origin -> false', () => {
  assert.equal(originMatchesActiveTab('https://example.com', ''), false);
});

test('malformed active-tab url -> false (no throw)', () => {
  assert.equal(originMatchesActiveTab('not a url', 'example.com'), false);
});

// ── Matching by tab id, because the URL is often invisible to us ──
//
// tabs.query() strips url/title/favIconUrl unless the extension holds the "tabs"
// permission or an explicit host permission for that tab. Content-script `matches`
// are *scriptable* hosts — they are what Chrome's "On all sites" display reflects,
// and they grant nothing to the tabs API. So on a site the user has not connected
// yet, the active tab arrives with url: undefined, the hostname comparison fails
// closed, and the connect popup never opens: the exact bug where a site's first
// window.nostr call produced no prompt at all.
//
// The requesting tab's id is never stripped, so when we know it, it is both a
// stronger signal (it identifies the tab, not just its host) and one that survives
// having no host permission.

test('matches when the requesting tab IS the active tab, even with no visible URL', () => {
  assert.equal(requestIsFromActiveTab({ id: 7, url: undefined }, 'example.com', 7), true);
});

test('does NOT match when the request came from a different tab', () => {
  assert.equal(requestIsFromActiveTab({ id: 7, url: undefined }, 'example.com', 9), false);
});

test('a known tab id decides it — a mismatched URL cannot override it', () => {
  // Same tab, and the URL disagrees (e.g. the tab navigated meanwhile). The id wins.
  assert.equal(requestIsFromActiveTab({ id: 7, url: 'https://other.com' }, 'example.com', 7), true);
  // Different tab, and the URL happens to agree. Still not the requesting tab.
  assert.equal(requestIsFromActiveTab({ id: 9, url: 'https://example.com' }, 'example.com', 7), false);
});

test('falls back to the hostname when no tab id is available', () => {
  assert.equal(requestIsFromActiveTab({ id: 7, url: 'https://example.com' }, 'example.com', undefined), true);
  assert.equal(requestIsFromActiveTab({ id: 7, url: 'https://other.com' }, 'example.com', undefined), false);
  // No id and no readable URL: nothing to verify, so stay closed.
  assert.equal(requestIsFromActiveTab({ id: 7, url: undefined }, 'example.com', undefined), false);
});

test('no active tab at all -> false', () => {
  assert.equal(requestIsFromActiveTab(undefined, 'example.com', 7), false);
});
