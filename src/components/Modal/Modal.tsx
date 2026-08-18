import React, { useEffect, useRef } from 'react';
import { IconClose } from '@assets';
import styles from './Modal.module.css';

/**
 * A dialog: a card floating over a dimmed backdrop.
 *
 * This is the shared one. The popup had grown three separate hand-rolled versions — the
 * approval overlay's own scrim, the language picker's full-bleed sheet, and whatever each
 * new feature reached for — so dialogs looked and behaved differently depending on where
 * you met them, and a new one meant copying CSS.
 *
 * Distinct from OverlayPanel, deliberately. OverlayPanel is an opaque full-screen sheet
 * for NAVIGATION: you go somewhere and come back. This is for a dialog that interrupts —
 * it dims what is behind it so the popup still reads as the thing underneath, which is
 * what makes it feel like a popup rather than another page.
 *
 * Closes on the backdrop, on Escape, and on the close button. Focus moves into the dialog
 * on open so Escape and tabbing work without the user clicking first.
 */

interface ModalProps {
  title?: string;
  onClose: () => void;
  /** Pinned below the scrollable body — actions stay reachable however long the content. */
  footer?: React.ReactNode;
  /** Dialogs that must be answered rather than dismissed. */
  dismissOnBackdrop?: boolean;
  zIndex?: number;
  children?: React.ReactNode;
}

export default function Modal({
  title,
  onClose,
  footer,
  dismissOnBackdrop = true,
  zIndex,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const style = zIndex ? ({ '--modal-z': zIndex } as React.CSSProperties) : undefined;

  return (
    <div
      className={styles.backdrop}
      style={style}
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the card and ends on the
        // backdrop should not count as dismissing it.
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={cardRef}
      >
        {title && (
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            <button className={styles.close} onClick={onClose} aria-label="Close">
              <IconClose size={16} />
            </button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
