import IconCode from '@assets/IconCode';
import type { ReactNode } from 'react';
import { cn } from '@utils/cn.ts';
import TextBlock from '@components/TextBlock';
import Container from '@components/Container';

interface DetailDisclosureProps {
  label: ReactNode;
  iconOnly?: boolean;
  content?: string;
  children?: ReactNode;
  maxHeight?: number;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Collapsed, keyboard-accessible details: raw text or a group of controls. */
export default function DetailDisclosure({ label, iconOnly=false, content, children, maxHeight = 240, className, open, onOpenChange }: DetailDisclosureProps) {
  return <details open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)} className={cn('text-sm text-secondary', className)}>
    <summary title={iconOnly && typeof label==='string' ? label : undefined} aria-label={iconOnly && typeof label==='string' ? label : undefined} className={iconOnly ? "ml-auto w-fit cursor-pointer rounded-md p-3 text-secondary hover:text-brand list-none [&::-webkit-details-marker]:hidden [&::marker]:content-[''] focus-visible:outline focus-visible:outline-brand" : "cursor-pointer font-semibold py-2"}>{iconOnly ? <IconCode aria-hidden="true"/> : label}</summary>
    {content !== undefined ? <TextBlock mono maxHeight={maxHeight}>{content}</TextBlock> : <Container gap={4}>{children}</Container>}
  </details>;
}
