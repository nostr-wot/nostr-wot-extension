import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Option } from '@components/option.ts';
import IconChevronDown from '@assets/IconChevronDown.tsx';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import { cn } from '@utils/cn.ts';

interface DropdownProps {
  id?: string;
  options: readonly (Option & { disabled?: boolean })[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Theme-aware value selector. The popover top layer escapes popup scrollers. */
export default function Dropdown({ id, options, value, onChange, small = false, placeholder = '', className, disabled, 'aria-label': label }: DropdownProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const menuId = `${triggerId}-options`;
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  useOutsideClick(wrapper, () => setOpen(false), open);
  const selected = options.find(option => option.value === value);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function items() {
    return [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
  }
  function choose(next: string) {
    if (disabled || options.find(option => option.value === next)?.disabled) return;
    onChange(next);
    close();
  }

  useLayoutEffect(() => {
    const panel = menu.current;
    if (!open || disabled || !panel || !trigger.current) return;
    panel.showPopover();
    function position() {
      const anchor = trigger.current!.getBoundingClientRect();
      const width = Math.min(anchor.width, window.innerWidth - 16);
      const below = window.innerHeight - anchor.bottom - 12;
      const above = anchor.top - 12;
      const upwards = below < 200 && above > below;
      panel!.style.width = `${width}px`;
      panel!.style.maxHeight = `${Math.max(0, Math.min(240, upwards ? above : below))}px`;
      panel!.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
      panel!.style.top = `${upwards ? Math.max(8, anchor.top - panel!.getBoundingClientRect().height - 4) : anchor.bottom + 4}px`;
    }
    position();
    const choices = items();
    (choices.find(item => item.getAttribute('aria-selected') === 'true') ?? choices[0])?.focus({ preventScroll: true });
    const onScroll = (event: Event) => {
      if (!panel.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', position);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      panel.hidePopover();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, disabled]);

  return <div ref={wrapper} className={cn('relative w-full min-w-0', className)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (disabled) return;
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') { if (open) close(); return; }
      const choices = items();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!open) { setOpen(true); return; }
        const current = choices.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
        choices[index]?.focus({ preventScroll: true });
        choices[index]?.scrollIntoView?.({ block: 'nearest' });
      } else if (open && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); event.stopPropagation();
        const current = choices.find(item => item === document.activeElement);
        if (current) choose(current.dataset.value!);
      } else if (open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const now = Date.now();
        search.current = { text: (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase(), time: now };
        const match = choices.find(item => item.textContent?.toLowerCase().startsWith(search.current.text));
        match?.focus({ preventScroll: true });
        match?.scrollIntoView?.({ block: 'nearest' });
      }
    }}>
    <button ref={trigger} id={triggerId} type="button" disabled={disabled} aria-label={label}
      aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={menuId}
      onClick={() => { search.current.text = ''; setOpen(current => !current); }}
      className={cn('flex items-center justify-between gap-4 w-full min-w-0 border border-control-border rounded-md font-[inherit] leading-normal bg-input text-heading cursor-pointer transition-colors duration-150 enabled:hover:border-brand focus:outline-none focus:border-control-focus focus:shadow-focus disabled:opacity-50 disabled:cursor-not-allowed', small ? 'min-h-16 py-3 px-5 text-sm' : 'min-h-20 py-4 px-6 text-md')}>
      <span className={cn('truncate text-left', !selected && 'text-muted')}>{selected?.label ?? placeholder}</span>
      <IconChevronDown size={14} aria-hidden="true" className={cn('shrink-0 text-secondary', open && 'rotate-180')} />
    </button>
    <div ref={menu} id={menuId} role="listbox" aria-label={label} aria-labelledby={label ? undefined : triggerId}
      popover="manual" style={{ inset: 'auto', boxSizing: 'border-box' }}
      className="fixed m-0 p-2 bg-page-solid text-heading border border-control-border rounded-md shadow-[var(--shadow-pop)] overflow-y-auto">
      {options.map(option => <button type="button" key={option.value} role="option" tabIndex={-1}
        data-value={option.value} aria-selected={option.value === value} disabled={option.disabled}
        onClick={() => choose(option.value)}
        className={cn('block w-full rounded-sm border-none px-5 py-4 text-left font-[inherit] cursor-pointer hover:bg-hover focus:outline-none focus:bg-hover disabled:opacity-50 disabled:cursor-not-allowed', small ? 'text-sm' : 'text-md', option.value === value ? 'bg-brand-light text-brand font-semibold' : 'bg-transparent text-heading')}>
        {option.label}
      </button>)}
    </div>
  </div>;
}
