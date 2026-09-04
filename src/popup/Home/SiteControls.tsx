import React from 'react';
import { t } from '@lib/i18n.js';
import Toggle from '@components/Toggle/Toggle';
import Card from '@components/Card/Card';
import { IconUser, IconChevronRight } from '@assets';
import { useNavigate } from './NavigationContext';
import styles from './SiteControls.module.css';

interface SiteControlsProps {
  identityEnabled: boolean;
  isNip46?: boolean;
  onIdentityToggle: (checked: boolean) => void;
  // The site these rows act on — not itself a destination, so it is a plain
  // prop rather than something NavigationContext should know about.
  domain: string | null;
}

export default function SiteControls({
  identityEnabled,
  isNip46,
  onIdentityToggle,
  domain,
}: SiteControlsProps) {
  const navigate = useNavigate();
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
        <button className={styles.controlLink} onClick={() => navigate.managePermissions(domain!)}>
          <span>{t('home.managePermissions')}</span>
          <IconChevronRight size={14} />
        </button>
      )}

      <button className={styles.controlLink} onClick={() => navigate.viewAllActivity(domain)}>
        <span>{t('home.recentActivity')}</span>
        <IconChevronRight size={14} />
      </button>
    </Card>
  );
}
