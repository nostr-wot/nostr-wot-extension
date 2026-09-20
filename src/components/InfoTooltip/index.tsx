import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import IconInfo from '@assets/IconInfo.tsx';
import useOutsideClick from '@hooks/useOutsideClick.ts';

interface InfoTooltipProps {
  text: string;
  size?: number;
}

const WRAP = 'inline-flex items-center cursor-help text-muted ml-2 align-middle outline-none focus-visible:shadow-focus';
const BUBBLE = 'fixed m-0 bg-page-solid border border-card-border rounded-sm px-5 py-3 ' +
  'text-xs font-normal text-body leading-normal whitespace-normal text-left overflow-y-auto ' +
  'shadow-[0_2px_8px_rgba(0,0,0,0.12)]';

/** Shared help bubble. The native popover layer escapes scrolling/stacking containers. */
export default function InfoTooltip({ text, size = 13 }: InfoTooltipProps) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => { pinned.current = false; setOpen(false); }, []);
  useOutsideClick(trigger, close, open);

  useLayoutEffect(() => {
    const tip = bubble.current;
    if (!open || !tip || !trigger.current) return;
    tip.showPopover();
    function position() {
      const anchor = trigger.current!.getBoundingClientRect();
      const width = Math.min(240, window.innerWidth - 16);
      tip!.style.width = `${width}px`;
      tip!.style.maxHeight = `${window.innerHeight - 16}px`;
      const height = tip!.getBoundingClientRect().height;
      tip!.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
      const top = anchor.top - height - 6 >= 8 ? anchor.top - height - 6 : anchor.bottom + 6;
      tip!.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    }
    position();
    window.addEventListener('resize', position);
    const onScroll = (event: Event) => { if (!tip.contains(event.target as Node)) close(); };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      tip.hidePopover();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, text, close]);

  return <span ref={trigger} className={WRAP} tabIndex={0} role="button" aria-label={text}
    aria-expanded={open} aria-controls={id} aria-describedby={open ? id : undefined}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => { if (!pinned.current && document.activeElement !== trigger.current) setOpen(false); }}
    onFocus={() => setOpen(true)} onBlur={close}
    onClick={event => { event.preventDefault(); event.stopPropagation(); pinned.current = !pinned.current; setOpen(pinned.current); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); pinned.current = !pinned.current; setOpen(pinned.current); }
    }}>
    <IconInfo size={size}/>
    <span ref={bubble} id={id} role="tooltip" popover="manual" className={BUBBLE} style={{ inset: 'auto', boxSizing: 'border-box' }}>{text}</span>
  </span>;
}
