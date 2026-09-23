import React, { useLayoutEffect, useRef } from 'react';
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
 * on open. The topmost dialog contains keyboard focus and restores its opener on close.
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

interface OpenModal {
  card: HTMLDivElement;
  previousFocus: HTMLElement | null;
  priority: () => number;
}
const openModals: OpenModal[] = [];

/** Match visual stacking, including nested dialogs whose effects mount first. */
function topModal(): OpenModal | undefined {
  return openModals.reduce<OpenModal | undefined>((top, modal) => {
    if (!top) return modal;
    if (top.card.contains(modal.card)) return modal;
    if (modal.card.contains(top.card)) return top;
    if (modal.priority() !== top.priority()) return modal.priority() > top.priority() ? modal : top;
    // DOCUMENT_POSITION_FOLLOWING: later siblings paint above earlier siblings.
    return top.card.compareDocumentPosition(modal.card) & 4 ? modal : top;
  }, undefined);
}

function tabStops(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, iframe, [tabindex], [contenteditable="true"]',
  )).filter(element => {
    if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = card.ownerDocument.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
      if (node === card) break;
    }
    return true;
  }).sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
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
  const zIndexRef = useRef(zIndex);
  zIndexRef.current = zIndex;

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

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const doc = card.ownerDocument;
    const modal: OpenModal = {
      card,
      previousFocus: doc.activeElement as HTMLElement | null,
      priority: () => zIndexRef.current ?? (Number.parseFloat(
        doc.defaultView?.getComputedStyle(card.parentElement!).getPropertyValue('--modal-z') || '',
      ) || 700),
    };
    // A child may have focused itself before its parent's effect runs.
    const focusedChild = openModals.find(other => card.contains(other.card) && other.card.contains(doc.activeElement));
    if (focusedChild) modal.previousFocus = focusedChild.previousFocus;
    openModals.push(modal);
    if (topModal() === modal) card.focus();
    const onKey = (e: KeyboardEvent) => {
      if (topModal() !== modal || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const stops = tabStops(card);
        const index = stops.indexOf(doc.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (index <= 0 ? stops.length - 1 : index - 1)
          : (index + 1) % stops.length;
        e.preventDefault();
        (stops[next] ?? card).focus();
      }
    };
    const onFocus = () => {
      if (topModal() === modal && !card.contains(doc.activeElement)) card.focus();
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('focusin', onFocus);
    return () => {
      const wasTop = topModal() === modal;
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('focusin', onFocus);
      openModals.splice(openModals.indexOf(modal), 1);
      // If a parent disappears before its child, preserve the original opener.
      for (const other of openModals) {
        if (other.previousFocus && card.contains(other.previousFocus)) other.previousFocus = modal.previousFocus;
      }
      if (!wasTop) return;
      const remaining = topModal();
      const previous = modal.previousFocus;
      if (previous?.isConnected && (!remaining || remaining.card.contains(previous))) previous.focus();
      else if (remaining?.card.isConnected) remaining.card.focus();
    };
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
