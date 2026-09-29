import type { ReactNode } from 'react';
import { cn } from '@utils/cn.ts';
import TextBlock from '@components/TextBlock';
import Container from '@components/Container';

interface DetailDisclosureProps {
  label: ReactNode;
  content?: string;
  children?: ReactNode;
  maxHeight?: number;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Collapsed, keyboard-accessible details: raw text or a group of controls. */
export default function DetailDisclosure({ label, content, children, maxHeight = 240, className, open, onOpenChange }: DetailDisclosureProps) {
  return <details open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)} className={cn('text-sm text-secondary', className)}>
    <summary className="cursor-pointer font-semibold py-2">{label}</summary>
    {content !== undefined ? <TextBlock mono maxHeight={maxHeight}>{content}</TextBlock> : <Container gap={4}>{children}</Container>}
  </details>;
}
