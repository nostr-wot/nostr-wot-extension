import AccountCopyDialog from './AccountCopyDialog';
import { useAccount } from '@context/AccountContext';
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
  const { active } = useAccount();
  const [copyOpen, setCopyOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  return (
    <>
    <Container variant="row" gap={4} className="relative z-topbar mb-6 shrink-0">
      <div className="relative flex-1 min-w-0">
        <AccountBar
          onCopy={() => setCopyOpen(true)}
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
    {copyOpen && active && <AccountCopyDialog key={active.id} pubkey={active.pubkey} onClose={() => setCopyOpen(false)} />}
    </>
  );
}
