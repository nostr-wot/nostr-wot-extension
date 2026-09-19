import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { useAccount } from '@context/AccountContext';
import { getInitial } from '@utils/format/text.ts';
import { accountDisplay } from '@domain/accounts/display.ts';
import AccountLabel from './AccountLabel';
import IconWarning from '@assets/IconWarning.tsx';
import IconClose from '@assets/IconClose.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import Avatar from '@components/Avatar';
import { ButtonSecondary } from '@components/Button';
import IconButton from '@components/IconButton';
import Modal from '@components/Modal';
import ConfirmDialog from '@components/ConfirmDialog';
import StatusNotice from '@components/StatusNotice';
import FieldDisplay from '@components/FieldDisplay';

interface AccountDropdownProps {
  onClose: () => void;
  onAddAccount: () => void;
}

export default function AccountDropdown({ onClose, onAddAccount }: AccountDropdownProps) {
  const { accounts, activeId, profileCache, switchAccount, reload } = useAccount();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<boolean>(false);
  const confirmAccount = confirmId ? (accounts || []).find((a) => a.id === confirmId) : null;
  const isWriteAccount = confirmAccount && !confirmAccount.readOnly && confirmAccount.type !== 'npub';

  const handleRemove = async () => {
    if (!confirmId || removing) return;
    setRemoving(true);
    setError('');
    try {
      await rpc('vault_removeAccount', { accountId: confirmId });
      await reload();
      setConfirmId(null);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <><Modal title={t('account.choose')} onClose={confirmAccount ? () => {} : onClose} maxWidth={360}
      footer={<ButtonSecondary onClick={onAddAccount}><IconPlus size={16} />{t('account.addAccount')}</ButtonSecondary>}>
      <div className="flex flex-col gap-3">
        {(accounts || []).map((account) => {
          const cached = profileCache[account.pubkey];
          const display = accountDisplay(account, cached);
          const isActive = account.id === activeId;

          return <AccountPickerRow key={account.id} name={display.name}
            subtitle={display.subtitle} picture={display.picture || undefined} remote={account.type === 'nip46'}
            readOnly={!!account.readOnly || account.type === 'npub'} selected={isActive}
            onSelect={() => { void switchAccount(account.id); onClose(); }} onRemove={() => { setError(''); setConfirmId(account.id); }} />;
        })}
      </div>

    </Modal>
    {confirmAccount && <ConfirmDialog
      title={t('account.removeTitle', { name: profileCache[confirmAccount.pubkey]?.name || confirmAccount.name || '' })}
      message={<>{t('account.removeWarning')}{isWriteAccount &&
        <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t(confirmAccount.type === 'generated' ? 'account.removeSeedWarning' : 'account.removeKeyWarning')}</StatusNotice>}
        {confirmAccount.derivationPath && <FieldDisplay mono label={t('wizard.derivationPath')} value={confirmAccount.derivationPath} />}
      </>}
      danger busy={removing} error={error} confirmLabel={t('common.remove')}
      onConfirm={handleRemove} onCancel={() => setConfirmId(null)}
    />}
    </>
  );
}

export function AccountPickerRow({ name, subtitle, picture, selected, readOnly, remote = false, onSelect, onRemove }: {
  name: string; subtitle: string; picture?: string; selected: boolean; readOnly: boolean; remote?: boolean;
  onSelect: () => void; onRemove: () => void;
}) {
  return <div className={`flex items-center gap-4 rounded-md p-5 border ${selected ? 'bg-brand-light border-brand' : 'border-card-border bg-transparent'}`}>
    <button type="button" aria-pressed={selected} onClick={onSelect}
      className="flex items-center gap-4 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer rounded-md focus-visible:shadow-focus focus-visible:outline-none">
      <div className="w-18 h-18 rounded-full bg-brand-light text-brand overflow-hidden shrink-0 flex items-center justify-center">
        <Avatar src={picture} fallback={getInitial(name)} imgClassName="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <AccountLabel name={name} remote={remote} readOnly={readOnly} />
        <span className="text-xs text-menu-subtitle truncate">{subtitle}</span>
      </div>
      {selected && <span className="text-brand font-semibold" aria-label={t('account.selected')}>✓</span>}
    </button>
    <IconButton tone="danger" size="small" title={t('account.remove')} aria-label={t('account.remove')} onClick={onRemove}><IconClose size={14} /></IconButton>
  </div>;
}
