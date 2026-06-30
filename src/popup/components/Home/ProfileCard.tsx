import React from 'react';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import { IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

/**
 * Compact "Edit profile" entry on the home screen — opens EditProfileOverlay.
 * Avatar + name are already shown in the top bar, so this stays minimal; the
 * "(kind 0)" hint clarifies which Nostr event it edits.
 */
export default function ProfileCard({ onEdit }: { onEdit: () => void }) {
  return (
    <Card className={styles.linkCard} onClick={onEdit}>
      <span className={styles.linkCardLabel}>
        {t('home.editProfile')} <span className={styles.kindHint}>(kind 0)</span>
      </span>
      <IconChevronRight size={16} />
    </Card>
  );
}
