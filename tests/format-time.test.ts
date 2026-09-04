/**
 * `classifyDay` — the "Today" / "Yesterday" boundary the activity log's day
 * headers are built on.
 *
 * Pulled out of `ActivityOverlay` where it was inline and untested; the
 * boundary itself (what counts as "yesterday" relative to `now`) is exactly
 * the kind of off-by-one that is easy to get wrong and easy to miss by eye,
 * since a wrong header only shows up once a day actually rolls over.
 *
 * Run with:
 *   node --import tsx --test tests/format-time.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDay } from '../src/utils/format/time.ts';

const NOW = new Date('2026-03-15T12:00:00Z');

describe('classifyDay', () => {
  it('matches today', () => {
    assert.equal(classifyDay(NOW.toDateString(), NOW), 'today');
  });

  it('matches yesterday', () => {
    const yesterday = new Date(NOW.getTime() - 86400000);
    assert.equal(classifyDay(yesterday.toDateString(), NOW), 'yesterday');
  });

  it('falls back to "other" for anything further back', () => {
    const lastWeek = new Date(NOW.getTime() - 7 * 86400000);
    assert.equal(classifyDay(lastWeek.toDateString(), NOW), 'other');
  });

  it('falls back to "other" for a date in the future', () => {
    const tomorrow = new Date(NOW.getTime() + 86400000);
    assert.equal(classifyDay(tomorrow.toDateString(), NOW), 'other');
  });

  it('defaults `now` to the real clock when omitted', () => {
    assert.equal(classifyDay(new Date().toDateString()), 'today');
  });
});
