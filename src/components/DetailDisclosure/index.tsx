import IconCode from '@assets/IconCode';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@components/Modal';
import IconButton from '@components/IconButton';
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
  const [popupOpen, setPopupOpen] = useState(false);
  const changeOpen = (value: boolean) => {
    setPopupOpen(value);
    onOpenChange?.(value);
  };
  const body = content !== undefined ? <TextBlock mono maxHeight={maxHeight}>{content}</TextBlock> : <Container gap={4}>{children}</Container>;
  if (iconOnly) return <div className={cn('flex justify-end', className)}>
    <IconButton title={typeof label === 'string' ? label : undefined} aria-label={typeof label === 'string' ? label : undefined} aria-haspopup="dialog" onClick={() => changeOpen(true)}><IconCode aria-hidden="true"/></IconButton>
    {(open ?? popupOpen) && createPortal(<Modal title={typeof label === 'string' ? label : undefined} onClose={() => changeOpen(false)}>{body}</Modal>, document.body)}
  </div>;
  return <details open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)} className={cn('text-sm text-secondary', className)}>
    <summary className="cursor-pointer font-semibold py-2">{label}</summary>
    {body}
  </details>;
}
