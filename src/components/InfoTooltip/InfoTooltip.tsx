import { IconInfo } from '@assets';

interface InfoTooltipProps {
  text: string;
  size?: number;
}

// `group-hover`/`group-focus`/`group-focus-within` replace the old
// `.wrap:hover .bubble` descendant rules — Tailwind's own mechanism for
// "reveal this on the parent's state", no custom selector needed.
const WRAP = 'relative inline-flex items-center cursor-help text-muted ml-2 align-middle outline-none group';
const BUBBLE =
  // bg-page-solid, not bg-card: the old rule read the opaque --bg-card alias
  // (--bg-page-solid), and --card-bg (what bg-card maps to) is a translucent
  // brand tint — the wrong one would have made the bubble see-through again,
  // the exact failure mode theme.css's own comment on --bg-card warns about.
  'hidden absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 bg-page-solid border border-card-border ' +
  'rounded-sm px-5 py-3 text-xs font-normal text-body leading-normal w-max max-w-[240px] whitespace-normal ' +
  'text-left z-raised shadow-[0_2px_8px_rgba(0,0,0,0.12)] pointer-events-none ' +
  'group-hover:block group-focus:block group-focus-within:block';

/**
 * Small "(i)" icon that reveals an explanatory bubble on hover or keyboard
 * focus. Reusable across the popup wherever a control needs a short "what is
 * this?" hint.
 */
export default function InfoTooltip({ text, size = 13 }: InfoTooltipProps) {
  return (
    <span className={WRAP} tabIndex={0} role="note" aria-label={text}>
      <IconInfo size={size} />
      <span className={BUBBLE}>{text}</span>
    </span>
  );
}
