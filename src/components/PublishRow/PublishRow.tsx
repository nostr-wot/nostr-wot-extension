import React from 'react';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import styles from './PublishRow.module.css';

interface PublishRowLabels {
  idle: string;
  unsaved: string;
  success: string;
  error: string;
  publishing: string;
}

interface PublishRowProps {
  publishing: boolean;
  status: 'success' | 'error' | null;
  dirty: boolean;
  labels: PublishRowLabels;
  onPublish: () => void;
}

/**
 * Shared "publish status text + spinner + Publish button" row used by the
 * relay list (NetworkSection) and the mute list (FiltersModal). The status
 * text is a 4-way choice: publishing → success → error → (dirty ? unsaved :
 * idle). The `idle` label is precomputed by the caller (it may itself depend
 * on last-published time / never-published state).
 */
export default function PublishRow({ publishing, status, dirty, labels, onPublish }: PublishRowProps) {
  const infoClass = [
    styles.publishInfo,
    dirty ? styles.publishUnsaved : '',
    status === 'success' ? styles.publishSuccess : '',
    status === 'error' ? styles.publishError : '',
  ].filter(Boolean).join(' ');

  const statusText = publishing
    ? labels.publishing
    : status === 'success'
      ? labels.success
      : status === 'error'
        ? labels.error
        : dirty
          ? labels.unsaved
          : labels.idle;

  return (
    <div className={styles.publishRow}>
      <span className={infoClass}>{statusText}</span>
      {publishing && <div className={styles.publishSpinner} />}
      <Button small variant="secondary" onClick={onPublish} disabled={publishing}>{t('common.publish')}</Button>
    </div>
  );
}
