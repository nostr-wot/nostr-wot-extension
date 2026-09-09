import type { ReactNode } from 'react';
import { cn } from '@utils/cn.ts';
import TextBlock from '@components/TextBlock';

interface DetailDisclosureProps {
  label: ReactNode;
  content: string;
  maxHeight?: number;
  className?: string;
  open?: boolean;
}

/** Collapsed, keyboard-accessible raw details with bounded, selectable text. */
export default function DetailDisclosure({ label, content, maxHeight = 240, className, open }: DetailDisclosureProps) {
  return <details open={open} className={cn('text-sm text-secondary', className)}>
    <summary className="cursor-pointer font-semibold py-2">{label}</summary>
    <TextBlock mono maxHeight={maxHeight}>{content}</TextBlock>
  </details>;
}
