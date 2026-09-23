import React from 'react';

interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * `input:checked + .slider` becomes Tailwind's `peer` / `peer-checked:` pair
 * — the exact pattern that combinator exists for — so the whole component
 * moves to utilities with no CSS module left. `18px` (knob travel) and `11px`
 * (track radius) are one-off geometry with no matching token, per
 * docs/component-standards.md §7.
 */
export default function Toggle({ checked, onChange, ...rest }: ToggleProps) {
  return (
    <label className="relative inline-block w-20 h-11 m-0 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.checked)}
        className="peer absolute w-0 h-0 opacity-0"
        {...rest}
      />
      <span
        className={
          'absolute inset-0 cursor-pointer bg-control-border rounded-[11px] transition-all duration-slow ' +
          'peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand ' +
          "before:content-[''] before:absolute before:h-8 before:w-8 before:left-1.5 before:bottom-1.5 " +
          'before:bg-white before:rounded-full before:transition-all before:duration-slow ' +
          'peer-checked:before:translate-x-9 peer-checked:before:bg-elevated'
        }
      />
    </label>
  );
}
