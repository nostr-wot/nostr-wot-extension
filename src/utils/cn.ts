import { extendTailwindMerge } from 'tailwind-merge';

/*
 * Joining class lists, so that the caller's utility actually wins.
 *
 * The bug this exists to stop, which the move to Tailwind introduced and which
 * is entirely silent: two utilities for the same property on one element are
 * resolved by their order in the *generated stylesheet*, not by their order in
 * `className`. `<Card className="p-0">` against a Card that sets `p-7` gave
 * 14px of padding, because Tailwind emits `.p-0` before `.p-7`. Measured, not
 * guessed — `mb-0`, `p-0` and a custom background were all losing to the
 * component's own class at the time this was written.
 *
 * `twMerge` fixes it by dropping the earlier of two conflicting utilities
 * before the string ever reaches the DOM, so the last one written wins the way
 * everyone expects. Components must therefore build their class list as
 * `cn(OWN_CLASSES, className)` — own first, caller's last.
 *
 * The configuration below is not optional. tailwind-merge decides whether two
 * classes conflict from its knowledge of Tailwind's DEFAULT scales, and ours
 * are deliberately different: `text-md` is our font size and `text-muted` is a
 * colour, and a merger that does not know which is which will happily delete
 * one when both are present. Every scale that `tailwind.css` redefines has to
 * be declared here too.
 *
 * Keep this in step with `src/styles/tailwind.css` — `tests/theme-tokens.test.ts`
 * fails if the two disagree.
 */

export const cn = extendTailwindMerge({
  override: {
    classGroups: {
      'font-size': [{ text: ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'display'] }],
      'font-weight': [{ font: ['normal', 'medium', 'semibold', 'bold', 'heavy'] }],
      leading: [{ leading: ['none', 'tight', 'normal', 'loose'] }],
      rounded: [{ rounded: ['xs', 'sm', 'md', 'panel', 'lg', 'xl', 'full'] }],
      'shadow': [{ shadow: ['card', 'card-hover', 'pop', 'modal', 'focus'] }],
      z: [{ z: ['raised', 'topbar', 'panel', 'sheet', 'modal', 'lock', 'splash'] }],
      duration: [{ duration: ['fast', 'slow'] }],
      'font-family': [{ font: ['sans', 'mono', 'mono-alt', 'code'] }],
    },
  },
  extend: {
    theme: {
      // Every colour `tailwind.css` maps. Without these, `bg-glass-heavy` and
      // `bg-glass` are not recognised as the same property and both survive.
      color: [
        'brand', 'brand-hover', 'brand-light', 'brand-tint-hover', 'brand-tint-active',
        'on-brand', 'heading', 'body', 'secondary', 'muted',
        'page-solid', 'surface', 'sunken', 'elevated', 'card', 'card-border',
        'card-active', 'input', 'divider', 'glass', 'glass-heavy', 'scrim', 'scrim-heavy',
        'success', 'success-strong', 'success-bright', 'success-tint',
        'error', 'error-bright', 'error-tint', 'error-tint-hover',
        'warning', 'warning-strong', 'warning-bright', 'warning-tint', 'warning-tint-heavy',
        'info', 'info-tint',
      ],
    },
  },
});

export default cn;
