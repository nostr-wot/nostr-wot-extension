import Select from '@components/Select';
import type { Option } from '@components/option.ts';

interface DropdownProps {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** The same selection control for value-based callers. Native menus cannot be
 * clipped by the popup's scrolling panels and support keyboard/type-ahead. */
export default function Dropdown({ options, value, onChange, placeholder = '', ...rest }: DropdownProps) {
  const selected = options.some(option => option.value === value);
  return <Select
    {...rest}
    value={selected ? value : ''}
    options={selected ? options : [{ value: '', label: placeholder, disabled: true }, ...options]}
    onChange={event => onChange(event.target.value)}
  />;
}
