import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronDown, IconLockOpen } from '@assets';
import { useAccount } from '../../context/AccountContext';
import { useVault } from '../../context/VaultContext';
import Avatar from '@components/Avatar/Avatar';
import styles from './TopBar.module.css';

interface AccountBarProps {
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
}

export default function AccountBar({ dropdownOpen, onToggleDropdown }: AccountBarProps) {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, active } = useAccount();
  const vault = useVault();

  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial;

  return (
    <div className={styles.accountBar}>
      <button className={styles.accountBarToggle} onClick={onToggleDropdown}>
        <div className={styles.avatarWrap}>
          <Avatar
            src={avatarUrl}
            fallback={fallbackText}
            imgClassName={styles.avatar}
            fallbackClassName={styles.avatarFallback}
          />
        </div>
        <div className={styles.barInfo}>
          <div className={styles.barNameRow}>
            <span className={styles.barName}>{displayName}</span>
            {isReadOnly && <span className={styles.readOnlyBadge}>{t('account.readOnly')}</span>}
          </div>
          <span className={styles.barSub}>{displaySub}</span>
        </div>
        <IconChevronDown className={`${styles.chevron} ${dropdownOpen ? styles.chevronOpen : ''}`} />
      </button>

      {vault.exists && !isReadOnly && vault.autoLockEnabled && !vault.locked && (
        <button
          className={`${styles.lockBtn} ${styles.lockUnlocked}`}
          title={t('topbar.vaultUnlocked')}
          onClick={(e) => {
            e.stopPropagation();
            vault.lock();
          }}
        >
          <IconLockOpen />
        </button>
      )}
    </div>
  );
}
