import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import IconCode from '@assets/IconCode';
import IconButton from '@components/IconButton';
import Modal from '@components/Modal';
import TextBlock from '@components/TextBlock';
import { t } from '@services/i18n/i18n';

/** Explicit raw-data dialog; children exist in the DOM only while open. */
export default function RawEventButton({ event, children, onOpenChange }: {
  event?: unknown;
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const changeOpen = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  const label = t('event.showRaw');
  return <div className="flex justify-end">
    <IconButton title={label} aria-label={label} aria-haspopup="dialog" onClick={() => changeOpen(true)}><IconCode aria-hidden="true" /></IconButton>
    {open && createPortal(<Modal title={label} onClose={() => changeOpen(false)}>
      {event !== undefined ? <TextBlock mono>{JSON.stringify(event, null, 2)}</TextBlock> : children}
    </Modal>, document.body)}
  </div>;
}
