import { useState } from 'react';
import { t } from '@lib/i18n.js';
import { IconSettings } from '@assets';
import AccountBar from './AccountBar';
import AccountDropdown from './AccountDropdown';
import GlobeButton from './GlobeButton';
import IconButton from '@components/IconButton/IconButton';

interface TopBarProps {
  onMenuOpen: () => void;
  onAddAccount: () => void;
  onEditProfile: () => void;
}

export default function TopBar({ onMenuOpen, onAddAccount, onEditProfile }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  return (
    <div className="relative z-topbar flex items-center gap-4 mb-6 shrink-0">
      <div className="relative flex-1 min-w-0">
        <AccountBar
          dropdownOpen={dropdownOpen}
          onToggleDropdown={() => setDropdownOpen((v) => !v)}
        />
        {dropdownOpen && (
          <AccountDropdown onClose={() => setDropdownOpen(false)} onAddAccount={() => { setDropdownOpen(false); onAddAccount?.(); }} onEditProfile={() => { setDropdownOpen(false); onEditProfile(); }} />
        )}
      </div>
      <GlobeButton />
      <IconButton tone="brand" onClick={onMenuOpen} title={t('topbar.settings')} aria-label={t('topbar.settings')}>
        <IconSettings />
      </IconButton>
    </div>
  );
}
