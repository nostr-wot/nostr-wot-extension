import type { Option } from '@components/option.ts';
import Chip from '@components/Chip';
import { cn } from '@utils/cn.ts';

interface ChipGroupProps<T extends string | number> {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

export default function ChipGroup<T extends string | number>({ options, value, onChange, disabled = false, className = '' }: ChipGroupProps<T>) {
  return (
    <div className={cn('flex gap-3 flex-wrap', className)}>
      {options.map((opt) => (
        <Chip
          key={String(opt.value)}
          selected={value === opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
