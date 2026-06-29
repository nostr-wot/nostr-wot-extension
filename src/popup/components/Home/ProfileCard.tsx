import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import { IconChevronRight } from '@assets';
import { useAccount } from '../../context/AccountContext';
import styles from './HomeTab.module.css';

/**
 * Persistent profile card on the home screen. Shows the active account's
 * avatar + name (or a "set up your profile" prompt when kind:0 is empty) and
 * opens the EditProfileOverlay on click. Only rendered for signing accounts.
 */
export default function ProfileCard({ onEdit }: { onEdit: () => void }) {
  const { displayName, displaySub, avatarUrl, initial, cachedProfile } = useAccount();
  const [imgError, setImgError] = useState<boolean>(false);
  const hasProfile = !!cachedProfile?.name;
  const showAvatar = avatarUrl && !imgError;

  return (
    <Card className={styles.profileCard} onClick={onEdit}>
      <div className={styles.profileCardAvatar}>
        {showAvatar
          ? <img src={avatarUrl!} alt="" onError={() => setImgError(true)} />
          : <span>{initial}</span>}
      </div>
      <div className={styles.profileCardText}>
        <strong>{hasProfile ? displayName : t('home.setupProfile')}</strong>
        <span>{hasProfile ? displaySub : t('home.setupProfileHint')}</span>
      </div>
      <IconChevronRight size={16} />
    </Card>
  );
}
