import Chip from '@components/Chip/Chip';
import { cn } from '@utils/cn.ts';

interface ChipOption {
  value: string | number;
  label: string;
}

interface ChipGroupProps {
  options: ChipOption[];
  value: string | number;
  onChange: (value: any) => void;
  className?: string;
}

export default function ChipGroup({ options, value, onChange, className = '' }: ChipGroupProps) {
  return (
    <div className={cn('flex gap-3 flex-wrap', className)}>
      {options.map((opt) => (
        <Chip
          key={String(opt.value)}
          selected={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}
