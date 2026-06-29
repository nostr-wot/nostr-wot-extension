import React from 'react';
import { t } from '@lib/i18n.js';
import Toggle from '@components/Toggle/Toggle';
import Card from '@components/Card/Card';
import { IconUser, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

interface SiteControlsProps {
  identityEnabled: boolean;
  isNip46?: boolean;
  onIdentityToggle: (checked: boolean) => void;
  onManagePermissions: () => void;
  onRecentActivity: () => void;
}

export default function SiteControls({
  identityEnabled,
  isNip46,
  onIdentityToggle,
  onManagePermissions,
  onRecentActivity,
}: SiteControlsProps) {
  return (
    <Card className={styles.siteControls}>
      <div className={styles.controlRow}>
        <div className={styles.controlInfo}>
          <IconUser size={15} className={styles.controlIcon} />
          <span className={styles.controlLabel}>{t('home.allowIdentity')}</span>
        </div>
        <Toggle checked={identityEnabled} onChange={onIdentityToggle} />
      </div>

      {isNip46 ? (
        <div className={styles.managedBySigner}>
          <span>{t('perms.managedBySigner')}</span>
        </div>
      ) : (
        <button className={styles.controlLink} onClick={onManagePermissions}>
          <span>{t('home.managePermissions')}</span>
          <IconChevronRight size={14} />
        </button>
      )}

      <button className={styles.controlLink} onClick={onRecentActivity}>
        <span>{t('home.recentActivity')}</span>
        <IconChevronRight size={14} />
      </button>
    </Card>
  );
}
