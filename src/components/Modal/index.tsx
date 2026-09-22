import React, { useEffect, useRef } from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconClose from '@assets/IconClose.tsx';
import IconButton from '@components/IconButton';
import { cn } from '@utils/cn.ts';
import Container from '@components/Container';

// rgba(0,0,0,0.45) is a one-off, distinct from both --scrim (0.4) and
// --scrim-heavy (0.6) — kept exact rather than snapped to a neighbour.
// z-[var(--modal-z)]: this reads the *live* --modal-z custom property the
// caller sets inline via the zIndex prop (see `style` below), not a fixed
// rung — the unlock prompt's consent ordering depends on this staying dynamic
// rather than snapping to the static z-modal token.
const BACKDROP =
  'absolute inset-0 flex items-center justify-center p-8 bg-[rgba(0,0,0,0.45)] z-[var(--modal-z)] ' +
  'animate-backdrop-in backdrop-blur-[4px]';
// [background:var(--bg-page)]: --bg-page is a gradient, and the bg-page
// *utility* only ever sets background-color — a gradient there is an invalid
// declaration and silently drops. The arbitrary property keeps the full
// `background` shorthand the gradient needs.
// max-w-[var(--modal-max-width)]: same live-custom-property mechanism as the
// backdrop's z-index — the maxWidth prop sets --modal-max-width inline.
const CARD =
  'flex flex-col w-full max-h-full max-w-[var(--modal-max-width)] border border-card-border rounded-xl ' +
  '[background:var(--bg-page)] shadow-modal outline-none animate-card-in';
const FOOTER_ROW = 'flex gap-4 [&>*]:flex-1 [&>*]:min-w-0';
const FOOTER_STACK = 'flex flex-col gap-4 [&>*]:w-full';
const HEADER = 'flex items-center justify-between gap-4 px-7 py-6 border-b border-card-border';
const TITLE = 'text-lg font-bold text-heading';
const BODY = 'flex-1 min-h-0 overflow-y-auto p-7';
const FOOTER_SHELL = 'shrink-0 px-7 py-6 border-t border-card-border';

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
  /** Narrower than full width, in px — for dialogs that would look adrift
   *  stretched across the popup (a QR code, a short filter form). */
  maxWidth?: number;
  /** Lay the footer out as equal side-by-side actions instead of one full-width
   *  button. */
  footerRow?: boolean;
  children?: React.ReactNode;
}

export default function Modal({
  title,
  onClose,
  footer,
  dismissOnBackdrop = true,
  zIndex,
  maxWidth,
  footerRow = false,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // `onClose` in a ref, and the effect keyed on nothing.
  //
  // Callers pass an inline arrow or a plain function from their body, so
  // `onClose` is a new identity on every render. With it in the dependency
  // array this effect re-ran on every render — including the one caused by
  // each keystroke — and `cardRef.focus()` pulled focus off the input the user
  // was typing into. Every password field inside a dialog dropped focus after
  // one character.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const style = {
    ...(zIndex ? { '--modal-z': zIndex } : null),
    ...(maxWidth ? { '--modal-max-width': `${maxWidth}px` } : null),
  } as React.CSSProperties;

  return (
    <div
      className={BACKDROP}
      style={style}
      onMouseDown={(e) => {
        // mousedown, not click: a drag that starts inside the card and ends on the
        // backdrop should not count as dismissing it.
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={CARD}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={cardRef}
      >
        {title && (
          <div className={HEADER}>
            <span className={TITLE}>{title}</span>
            <IconButton onClick={onClose} aria-label={t('common.close')}>
              <IconClose size={16} />
            </IconButton>
          </div>
        )}
        <div className={BODY}><Container gap={6}>{children}</Container></div>
        {/* Both action layouts own their spacing; callers need no margins. */}
        {footer && (
          <div className={cn(FOOTER_SHELL, footerRow ? FOOTER_ROW : FOOTER_STACK)}>{footer}</div>
        )}
      </div>
    </div>
  );
}
