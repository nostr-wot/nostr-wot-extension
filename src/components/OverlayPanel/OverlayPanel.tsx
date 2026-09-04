import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import IconButton from '@components/IconButton/IconButton';
import styles from './OverlayPanel.module.css';

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
      className={`${styles.overlay} ${noPadding ? styles.noPadding : ''} ${animating ? styles.exiting : ''} ${className}`}
      style={overlayStyle}
    >
      {showHeader && (
        <div className={`${styles.header} ${noPadding ? styles.headerNoPadding : ''}`}>
          {centered ? (
            <>
              {onBack ? (
                <IconButton tone="brand" size={36} onClick={onBack} aria-label={t('common.back')}>
                  <IconChevronLeft />
                </IconButton>
              ) : (
                <div className={styles.placeholder} />
              )}
              <span className={`${styles.title} ${noPadding ? styles.titleSmall : ''}`}>{title}</span>
              {/* This branch used to drop `headerRight` on the floor. It is taken
                  whenever `onBack` is passed — which MenuOverlay always does — so
                  the post-quantum panel's "How it works" button, the only way back
                  to an explainer that shows itself once, has never rendered at all.
                  Silently: passing a prop the component ignores is not a type error. */}
              {onClose || headerRight ? (
                <div className={styles.headerRight}>
                  {headerRight}
                  {onClose && (
                    <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
                      <IconClose />
                    </IconButton>
                  )}
                </div>
              ) : (
                <div className={styles.placeholder} />
              )}
            </>
          ) : (
            <>
              <span className={styles.title}>{title}</span>
              {headerRight ? (
                <div className={styles.headerRight}>
                  {headerRight}
                  <IconButton size={36} onClick={onClose} aria-label={t('common.close')}>
                    <IconClose />
                  </IconButton>
                </div>
              ) : (
                <button className={styles.closeBtn} onClick={onClose}>
                  <IconClose />
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.body}>
        {children}
      </div>
    </div>
  );
}
