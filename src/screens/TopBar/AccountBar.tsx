import { t } from '@services/i18n/i18n.ts';
import IconChevronDown from '@assets/IconChevronDown.tsx';
import IconLockOpen from '@assets/IconLockOpen.tsx';
import AccountCopyMenu from './AccountCopyMenu';
import { useAccount } from '@context/AccountContext';
import { useVault } from '@context/VaultContext';
import Avatar from '@components/Avatar';
import IconButton from '@components/IconButton';
import Container from '@components/Container';
import AccountLabel from './AccountLabel';

interface AccountBarProps {
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
}

export default function AccountBar({ dropdownOpen, onToggleDropdown }: AccountBarProps) {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, isNip46, active } = useAccount();
  const vault = useVault();

  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial;

  return (
    <Container variant="row" gap={2} className="relative flex-1 min-w-0 bg-transparent rounded-lg py-4 px-5 transition-colors hover:bg-card">
      <button className="flex items-center gap-5 flex-1 cursor-pointer min-w-0 bg-transparent border-none p-0 text-left" onClick={onToggleDropdown} aria-haspopup="dialog" aria-expanded={dropdownOpen}>
        <div className="w-18 h-18 rounded-full overflow-hidden shrink-0">
          <Avatar
            src={avatarUrl}
            fallback={fallbackText}
            imgClassName="w-full h-full object-cover"
            fallbackClassName="w-full h-full flex items-center justify-center bg-[rgba(99,102,241,0.15)] text-brand-hover font-bold text-xl"
          />
        </div>
        <Container className="flex-1 min-w-0">
          <AccountLabel name={displayName} remote={isNip46} readOnly={isReadOnly} />
          <span className="text-xs text-muted font-mono whitespace-nowrap overflow-hidden text-ellipsis">{displaySub}</span>
        </Container>
        <IconChevronDown className={`text-muted shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      <AccountCopyMenu key={active?.id || 'none'} pubkey={active?.pubkey}/>
      {vault.exists && !isReadOnly && vault.autoLockEnabled && !vault.locked && (
        <IconButton
          tone="brand"
          title={t('topbar.vaultUnlocked')}
          aria-label={t('topbar.vaultUnlocked')}
          onClick={(e) => {
            e.stopPropagation();
            void vault.lock();
          }}
        >
          <IconLockOpen />
        </IconButton>
      )}
    </Container>
  );
}
