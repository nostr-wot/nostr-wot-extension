import React from 'react';
import Chip from '@components/Chip/Chip';
import styles from './ChipGroup.module.css';

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
    <div className={`${styles.chipGroup} ${className}`}>
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
