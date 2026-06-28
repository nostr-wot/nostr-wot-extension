import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInjectBadges } from '../lib/badgeInjection.ts';

const none = new Set<string>();

// Badges are experimental / opt-in: OFF unless explicitly enabled.

test('OFF by default when the setting is unset (undefined)', () => {
  assert.equal(shouldInjectBadges(undefined, none, 'example.com'), false);
});

test('OFF when explicitly disabled (false)', () => {
  assert.equal(shouldInjectBadges(false, none, 'example.com'), false);
});

test('ON only when explicitly enabled (=== true)', () => {
  assert.equal(shouldInjectBadges(true, none, 'example.com'), true);
});

test('truthy-but-not-true values do NOT enable (no accidental opt-in)', () => {
  assert.equal(shouldInjectBadges('true', none, 'example.com'), false);
  assert.equal(shouldInjectBadges(1, none, 'example.com'), false);
  assert.equal(shouldInjectBadges({}, none, 'example.com'), false);
});

test('enabled but the domain is in the per-site disabled list -> OFF', () => {
  assert.equal(shouldInjectBadges(true, new Set(['example.com']), 'example.com'), false);
});

test('enabled and the domain is not disabled -> ON', () => {
  assert.equal(shouldInjectBadges(true, new Set(['other.com']), 'example.com'), true);
});

test('enabled with no domain (null) -> ON (global CSS/inject path)', () => {
  assert.equal(shouldInjectBadges(true, none, null), true);
});
