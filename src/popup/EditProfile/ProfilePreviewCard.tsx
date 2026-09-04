import React from 'react';
import { t } from '@lib/i18n.js';
import Avatar from '@components/Avatar/Avatar';
import Button from '@components/Button/Button';
import { type ProfileMetadata } from '@shared/profileMetadata.ts';
import styles from './EditProfileOverlay.module.css';
import Card from '@components/Card/Card';

interface ProfilePreviewCardProps {
  meta: ProfileMetadata | null;
  displayPicture: string | null;
  initial: string;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}

/** What the profile will look like once published, and the confirm step. */
export default function ProfilePreviewCard({
  meta, displayPicture, initial, error, onBack, onConfirm,
}: ProfilePreviewCardProps) {
  return (
  <div className={styles.body}>
    <Card variant="flat" className={styles.previewCard}>
      <div className={styles.previewHeader}>
        <Avatar
          src={meta?.picture}
          fallback={initial}
          imgClassName={styles.previewAvatar}
          fallbackClassName={styles.previewAvatarPlaceholder}
        />
        <span className={styles.previewName}>{meta?.name || meta?.display_name || '\u2014'}</span>
      </div>
      {meta?.about && <div className={styles.previewAbout}>{meta.about}</div>}
      {meta?.nip05 && (
        <dl className={styles.previewField}>
          <dt>NIP-05</dt><dd>{meta.nip05}</dd>
        </dl>
      )}
      {meta?.lud16 && (
        <dl className={styles.previewField}>
          <dt>Lightning</dt><dd>{meta.lud16}</dd>
        </dl>
      )}
      {meta?.website && (
        <dl className={styles.previewField}>
          <dt>Website</dt><dd>{meta.website}</dd>
        </dl>
      )}
    </Card>

    <div className={styles.previewHint}>{t('profileEdit.previewHint')}</div>

    {error && <div className={styles.errorText}>{error}</div>}

    <div className={styles.actions}>
      <Button variant="secondary" onClick={onBack}>
        {t('common.back')}
      </Button>
      <Button onClick={onConfirm}>{t('profileEdit.confirmPublish')}</Button>
    </div>
  </div>
  );
}
