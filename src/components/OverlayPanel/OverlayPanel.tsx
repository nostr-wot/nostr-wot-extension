import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import IconButton from '@components/IconButton/IconButton';
import styles from './OverlayPanel.module.css';

const OVERLAY_BASE = 'absolute inset-0 bg-elevated flex flex-col p-8';
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
      className={`${styles.overlay} ${OVERLAY_BASE} ${noPadding ? 'p-0' : ''} ${animating ? styles.exiting : ''} ${className}`}
      style={overlayStyle}
    >
      {showHeader && (
        <div className={`${HEADER_BASE} ${noPadding ? HEADER_NO_PADDING : ''}`}>
          {centered ? (
            <>
              {onBack ? (
                <IconButton tone="brand" size={36} onClick={onBack} aria-label={t('common.back')}>
                  <IconChevronLeft />
                </IconButton>
              ) : (
                <div className={PLACEHOLDER} />
              )}
              <span className={`${TITLE_BASE} ${noPadding ? TITLE_SMALL : ''}`}>{title}</span>
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
                // No className here on purpose: the pre-migration CSS module
                // never defined `.closeBtn` either, so this button was
                // already rendering with no class and pure UA button chrome.
                // Preserved as-is rather than newly styled, to not change
                // what actually renders.
                <button onClick={onClose}>
                  <IconClose />
                </button>
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
