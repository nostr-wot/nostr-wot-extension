import React, { useState, useRef, useEffect } from 'react';
import { IconChevronDown } from '@assets';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import type { DropdownOption } from '@models/dropdown.ts';
import { cn } from '@utils/cn.ts';

const TRIGGER_BASE =
  'flex items-center justify-between gap-4 w-full px-6 py-5 border border-card-active rounded-md text-md ' +
  'font-medium bg-brand-tint-hover text-heading cursor-pointer transition-all duration-slow text-left ' +
  'hover:bg-brand-tint-active';
const TRIGGER_OPEN = 'border-brand bg-card shadow-[var(--focus-ring)]';
// rgba(99,102,241,0.3) is a one-off hover border, not one of the named tints.
const TRIGGER_SMALL =
  'text-sm px-5 py-4 bg-card border-card-border hover:border-[rgba(99,102,241,0.3)] hover:bg-card';
const TRIGGER_LABEL = 'flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap';
const CHEVRON = 'shrink-0 text-brand transition-transform duration-slow';
// 0.96 white and the dual shadow are one-offs specific to this floating menu.
// z-index is a fixed +2 over the top bar it floats over, not a named rung
// another surface could pick by mistake — see AccountDropdown for the same pattern.
const MENU_BASE =
  'absolute top-[calc(100%+4px)] left-0 right-0 z-[calc(var(--z-topbar)+2)] bg-[rgba(255,255,255,0.96)] ' +
  'backdrop-blur-[12px] border border-card-active rounded-md ' +
  'shadow-[var(--shadow-pop),0_2px_8px_rgba(0,0,0,0.06)] max-h-[200px] overflow-y-auto p-2';
const MENU_ENTER = 'animate-dropdown-in';
const MENU_EXIT = 'animate-dropdown-out';
const OPTION_BASE =
  'flex items-center w-full px-5 py-4 border-none rounded-sm bg-transparent text-body text-md cursor-pointer ' +
  'text-left transition-[background] duration-[0.12s] hover:bg-card';
const OPTION_ACTIVE = 'bg-brand-light text-brand font-semibold';
const OPTION_SMALL = 'text-xs px-4 py-3';

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  placeholder?: string;
  className?: string;
}

export default function Dropdown({
  options,
  value,
  onChange,
  small = false,
  placeholder = '',
  className = '',
}: DropdownProps) {
  const [open, setOpen] = useState<boolean>(false);
  const { shouldRender: menuVisible, animating: menuAnimating } = useAnimatedVisible(open, 150);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useOutsideClick(wrapperRef, () => setOpen(false), open);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : placeholder;

  const handleSelect = (val: string): void => {
    onChange(val);
    setOpen(false);
  };

  const triggerCls = [
    TRIGGER_BASE,
    small && TRIGGER_SMALL,
    open && TRIGGER_OPEN,
  ].filter(Boolean).join(' ');

  return (
    <div className={cn('relative', className)} ref={wrapperRef}>
      <button
        type="button"
        className={triggerCls}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cn(TRIGGER_LABEL, !selected ? 'text-muted' : '')}>
          {label}
        </span>
        <IconChevronDown
          size={small ? 12 : 14}
          className={cn(CHEVRON, open ? 'rotate-180' : '')}
        />
      </button>

      {menuVisible && (
        <div className={cn(MENU_BASE, menuAnimating ? MENU_EXIT : MENU_ENTER)}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={[
                OPTION_BASE,
                opt.value === value && OPTION_ACTIVE,
                small && OPTION_SMALL,
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
