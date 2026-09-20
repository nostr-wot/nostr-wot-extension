import { useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconSettings from '@assets/IconSettings.tsx';
import AccountBar from './AccountBar';
import AccountDropdown from './AccountDropdown';
import GlobeButton from './GlobeButton';
import IconButton from '@components/IconButton';
import Container from '@components/Container';

interface TopBarProps {
  onMenuOpen: () => void;
  onAddAccount: () => void;
}

export default function TopBar({ onMenuOpen, onAddAccount }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  return (
    <>
    <Container variant="row" gap={4} className="relative z-topbar mb-6 shrink-0">
      <div className="relative flex-1 min-w-0">
        <AccountBar
          dropdownOpen={dropdownOpen}
          onToggleDropdown={() => setDropdownOpen((v) => !v)}
        />

      </div>
      <GlobeButton />
      <IconButton tone="brand" onClick={onMenuOpen} title={t('topbar.settings')} aria-label={t('topbar.settings')}>
        <IconSettings />
      </IconButton>
    </Container>
    {dropdownOpen && <AccountDropdown onClose={() => setDropdownOpen(false)} onAddAccount={() => { setDropdownOpen(false); onAddAccount(); }} />}
    </>
  );
}
