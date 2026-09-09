import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import IconButton from '@components/IconButton/IconButton';
import { cn } from '@utils/cn.ts';

// z-[var(--overlay-z)]: reads the live --overlay-z custom property the
// zIndex prop overrides inline (see `overlayStyle` below) — the z-panel
// *named* utility would resolve --z-panel directly and bypass that override.
const OVERLAY_BASE = 'absolute inset-0 z-[var(--overlay-z)] bg-elevated flex flex-col p-8';
// Chosen as an either/or below, never both at once — two `animate-*`
// utilities on the same element are one `animation` property, and whichever
// is later in the *generated* stylesheet wins regardless of prop state.
const OVERLAY_ENTER = 'animate-overlay-slide-in';
const OVERLAY_EXIT = 'animate-overlay-slide-out';
const HEADER_BASE = 'flex items-center justify-between mb-8 pb-5 border-b border-card-border';
const HEADER_NO_PADDING = 'px-8 py-6 mb-0';
const TITLE_BASE = 'text-3xl font-bold text-heading';
const TITLE_SMALL = 'text-2xl';
const PLACEHOLDER = 'w-[36px]';
const HEADER_RIGHT = 'flex items-center gap-4';
const BODY = 'flex-1 min-h-0 flex flex-col';

interface OverlayPanelProps {
  title?: string;
  onClose?: () => void;
  onBack?: (() => void) | null;
  headerRight?: React.ReactNode;
  zIndex?: number;
  noPadding?: boolean;
  showHeader?: boolean;
  animating?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function OverlayPanel({
  title,
  onClose,
  onBack,
  headerRight,
  zIndex,
  noPadding = false,
  showHeader = true,
  animating = false,
  className = '',
  children,
}: OverlayPanelProps) {
  const overlayStyle = zIndex ? { '--overlay-z': zIndex } as React.CSSProperties : undefined;
  // centered layout when onBack is explicitly passed (function or null)
  const centered = onBack !== undefined;

  return (
    <div
      className={cn(OVERLAY_BASE, animating ? OVERLAY_EXIT : OVERLAY_ENTER, noPadding ? 'p-0' : '', className)}
      style={overlayStyle}
    >
      {showHeader && (
        <div className={cn(HEADER_BASE, noPadding ? HEADER_NO_PADDING : '')}>
          {centered ? (
            <>
              {onBack ? (
                <IconButton tone="brand" size={36} onClick={onBack} aria-label={t('common.back')}>
                  <IconChevronLeft />
                </IconButton>
              ) : (
                <div className={PLACEHOLDER} />
              )}
              <span className={cn(TITLE_BASE, noPadding ? TITLE_SMALL : '')}>{title}</span>
              {/* This branch used to drop `headerRight` on the floor. It is taken
                  whenever `onBack` is passed — which MenuOverlay always does — so
                  the post-quantum panel's "How it works" button, the only way back
                  to an explainer that shows itself once, has never rendered at all.
                  Silently: passing a prop the component ignores is not a type error. */}
              {onClose || headerRight ? (
                <div className={HEADER_RIGHT}>
                  {headerRight}
                  {onClose && (
                    <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
                      <IconClose />
                    </IconButton>
                  )}
                </div>
              ) : (
                <div className={PLACEHOLDER} />
              )}
            </>
          ) : (
            <>
              <span className={TITLE_BASE}>{title}</span>
              {headerRight ? (
                <div className={HEADER_RIGHT}>
                  {headerRight}
                  <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
                    <IconClose />
                  </IconButton>
                </div>
              ) : (
                <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
                  <IconClose />
                </IconButton>
              )}
            </>
          )}
        </div>
      )}

      <div className={BODY}>
        {children}
      </div>
    </div>
  );
}
