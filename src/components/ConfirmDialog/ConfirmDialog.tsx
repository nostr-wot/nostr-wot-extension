import React from 'react';
import { t } from '@lib/i18n.js';
import Modal from '@components/Modal/Modal';
import Button from '@components/Button/Button';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  title: string;
  /** What is about to happen, and what it costs. Plain text or nodes. */
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. Use for anything destructive or irreversible. */
  danger?: boolean;
  /** Disables both buttons and shows a working label while the action runs. */
  busy?: boolean;
  /** Shown inside the dialog so a failure does not close it silently. */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  zIndex?: number;
}

/**
 * The confirmation dialog. Use this for every "are you sure?" in the popup.
 *
 * It exists because the alternatives were worse in specific ways. Native
 * `confirm()` was in use on at least one destructive action; some popup contexts
 * suppress it outright, which turns a Remove button into a control that
 * sometimes silently does nothing — and it cannot be styled, translated by our
 * catalogue, or given a busy state. Hand-rolling a dialog per feature is how the
 * popup ended up with several different scrims and dismissal behaviours.
 *
 * Built on Modal, so backdrop, Escape, focus-on-open and the z tier are shared.
 * Backdrop dismissal is deliberately OFF: a confirmation is a question, and a
 * stray click on the surround is not an answer to it. Cancel and Escape are the
 * ways out, and both are the safe direction.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
  zIndex,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      dismissOnBackdrop={false}
      zIndex={zIndex}
      footer={
        <>
          <Button small variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel || t('common.cancel')}
          </Button>
          <Button
            small
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t('common.loading') : (confirmLabel || t('common.confirm'))}
          </Button>
        </>
      }
    >
      <div className={styles.message}>{message}</div>
      {error && <div className={styles.error} role="alert">{error}</div>}
    </Modal>
  );
}
