import { t } from '@services/i18n/i18n.ts';
import { IconChevronDown, IconLockOpen, IconCopy } from '@assets';
import { useAccount } from '@context/AccountContext';
import { useVault } from '@context/VaultContext';
import Avatar from '@components/Avatar/Avatar';
import IconButton from '@components/IconButton/IconButton';
import Container from '@components/Container/Container';

interface AccountBarProps {
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
  onCopy: () => void;
}

export default function AccountBar({ dropdownOpen, onToggleDropdown, onCopy }: AccountBarProps) {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, active } = useAccount();
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
          <Container variant="row" gap={3} className="min-w-0">
            <span className="font-semibold text-md text-heading whitespace-nowrap overflow-hidden text-ellipsis">{displayName}</span>
            {isReadOnly && (
              <span className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted bg-brand-tint-active py-px px-2.5 rounded-xs shrink-0 leading-normal">
                {t('account.readOnly')}
              </span>
            )}
          </Container>
          <span className="text-xs text-muted font-mono whitespace-nowrap overflow-hidden text-ellipsis">{displaySub}</span>
        </Container>
        <IconChevronDown className={`text-muted shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      <IconButton onClick={onCopy} disabled={!active} title={t('common.copy')} aria-label={t('common.copy')}><IconCopy size={16} /></IconButton>
      {vault.exists && !isReadOnly && vault.autoLockEnabled && !vault.locked && (
        <IconButton
          className="text-success hover:text-success hover:bg-[rgba(5,150,105,0.1)]"
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
