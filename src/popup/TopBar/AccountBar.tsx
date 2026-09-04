import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronDown, IconLockOpen } from '@assets';
import { useAccount } from '@popup/context/AccountContext';
import { useVault } from '@popup/context/VaultContext';
import Avatar from '@components/Avatar/Avatar';
import IconButton from '@components/IconButton/IconButton';
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
    <div className="relative flex items-center gap-2 flex-1 min-w-0 bg-transparent rounded-lg py-4 px-5 transition-colors hover:bg-card">
      <button className="flex items-center gap-5 flex-1 cursor-pointer min-w-0 bg-transparent border-none p-0 text-left" onClick={onToggleDropdown}>
        <div className="w-18 h-18 rounded-full overflow-hidden shrink-0">
          <Avatar
            src={avatarUrl}
            fallback={fallbackText}
            imgClassName="w-full h-full object-cover"
            fallbackClassName="w-full h-full flex items-center justify-center bg-[rgba(99,102,241,0.15)] text-brand-hover font-bold text-xl"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-semibold text-md text-heading whitespace-nowrap overflow-hidden text-ellipsis">{displayName}</span>
            {isReadOnly && (
              <span className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted bg-brand-tint-active py-px px-2.5 rounded-xs shrink-0 leading-normal">
                {t('account.readOnly')}
              </span>
            )}
          </div>
          <span className="text-xs text-muted font-mono whitespace-nowrap overflow-hidden text-ellipsis">{displaySub}</span>
        </div>
        <IconChevronDown className={`text-muted shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      {vault.exists && !isReadOnly && vault.autoLockEnabled && !vault.locked && (
        <IconButton
          className={styles.lockBtn}
          title={t('topbar.vaultUnlocked')}
          aria-label={t('topbar.vaultUnlocked')}
          onClick={(e) => {
            e.stopPropagation();
            vault.lock();
          }}
        >
          <IconLockOpen />
        </IconButton>
      )}
    </div>
  );
}
