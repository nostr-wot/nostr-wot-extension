/**
 * `cn()` — the caller's utility has to win.
 *
 * The bug this pins, which the Tailwind migration introduced and which is
 * entirely silent: two utilities for the same property on one element are
 * resolved by their order in the *generated stylesheet*, not by their order in
 * `className`. `<Card className="p-0">` against a Card that sets `p-7` rendered
 * with 14px of padding, because Tailwind emits `.p-0` before `.p-7`. Three of
 * these were live when `cn()` was written — `p-0`, `mb-0`, and a custom card
 * background — each a layout that looked deliberate and was not.
 *
 * The half worth testing hardest is the configuration. tailwind-merge decides
 * what conflicts from Tailwind's DEFAULT scales, and ours differ: `text-md` is
 * a font size here and `text-muted` is a colour. A merger that cannot tell
 * them apart deletes one when both are present — which is the same silent
 * failure again, arriving through the thing meant to prevent it.
 *
 * Run with:
 *   node --import tsx --test tests/cn.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cn } from '../src/utils/cn.ts';

describe('cn — the conflicts it must resolve', () => {
  it('lets a caller zero the padding and margin a component sets', () => {
    // The exact regression: Home and SiteControls pass p-0 to a Card that
    // sets p-7, and ApprovalCard passes mb-0 against mb-6.
    assert.equal(cn('bg-card rounded-lg p-7 mb-6', 'p-0 mb-0'), 'bg-card rounded-lg p-0 mb-0');
  });

  it('lets a caller replace a background, including an arbitrary one', () => {
    assert.equal(cn('bg-card', 'bg-[rgba(245,158,11,0.08)]'), 'bg-[rgba(245,158,11,0.08)]');
  });

  it('keeps the last of two same-property utilities', () => {
    assert.equal(cn('text-md', 'text-xs'), 'text-xs');
    assert.equal(cn('text-muted', 'text-brand'), 'text-brand');
    assert.equal(cn('rounded-lg', 'rounded-panel'), 'rounded-panel');
    assert.equal(cn('z-topbar', 'z-lock'), 'z-lock');
  });

  it('leaves unrelated utilities alone', () => {
    assert.equal(cn('flex items-center gap-4', 'text-brand'), 'flex items-center gap-4 text-brand');
  });
});

describe('cn — the conflicts it must NOT invent', () => {
  it('a font size and a colour are different properties', () => {
    // Both start `text-`. Under Tailwind's default scale `md` is not a size,
    // so an unconfigured merger reads `text-md` as a colour and drops one of
    // these — silently removing either the size or the colour from every
    // element that sets both, which is most of them.
    assert.equal(cn('text-md', 'text-muted'), 'text-md text-muted');
    assert.equal(cn('text-muted', 'text-md'), 'text-muted text-md');
  });

  it('a font family and a font weight are different properties', () => {
    assert.equal(cn('font-mono font-semibold', 'font-code'), 'font-semibold font-code');
  });

  it('a hover state does not conflict with a resting one', () => {
    assert.equal(cn('bg-card hover:bg-elevated', 'bg-glass'), 'hover:bg-elevated bg-glass');
  });

  it('every colour name the theme maps is recognised as a colour', () => {
    // A colour missing from cn's list is not an error — it simply stops
    // conflicting with other colours, so two backgrounds both survive and the
    // one that wins is whichever Tailwind happened to emit later.
    for (const c of ['glass', 'glass-heavy', 'card-active', 'success-tint', 'brand-tint-hover']) {
      assert.equal(cn(`bg-${c}`, 'bg-brand'), 'bg-brand', `bg-${c} did not conflict with bg-brand`);
    }
  });
});
