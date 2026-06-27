import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originMatchesActiveTab } from '../lib/originMatchesActiveTab.ts';

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
