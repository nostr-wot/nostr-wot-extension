import { useState } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { useAccount } from '@context/AccountContext';
import { getInitial } from '@utils/format/text.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import IconWarning from '@assets/IconWarning.tsx';
import IconClose from '@assets/IconClose.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import Avatar from '@components/Avatar';
import { ButtonSecondary, ButtonDanger } from '@components/Button';
import IconButton from '@components/IconButton';
import Modal from '@components/Modal';
import Container from '@components/Container';
import StatusNotice from '@components/StatusNotice';
import Text from '@components/Text';

interface AccountDropdownProps {
  onClose: () => void;
  onAddAccount: () => void;
}

export default function AccountDropdown({ onClose, onAddAccount }: AccountDropdownProps) {
  const { accounts, activeId, profileCache, switchAccount, reload } = useAccount();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<boolean>(false);
  const confirmAccount = confirmId ? (accounts || []).find((a) => a.id === confirmId) : null;
  const isWriteAccount = confirmAccount && !confirmAccount.readOnly && confirmAccount.type !== 'npub';

  const handleRemove = async () => {
    if (!confirmId) return;
    setRemoving(true);
    try {
      try { await rpc('vault_removeAccount', { accountId: confirmId }); } catch {}
      // Clean up local accounts array
      const data: any = await browser.storage.local.get(['accounts', 'activeAccountId']);
      const remaining = (data.accounts || []).filter((a: any) => a.id !== confirmId);
      const updates: Record<string, any> = { accounts: remaining };
      if (data.activeAccountId === confirmId) {
        updates.activeAccountId = remaining[0]?.id || null;
      }
      // Clear synced pubkey BEFORE updating local accounts so the migration
      // code in AccountContext.load() doesn't re-create the account
      if (remaining.length === 0) {
        await browser.storage.sync.remove('myPubkey');
      } else if (updates.activeAccountId) {
        const newActive = remaining.find((a: any) => a.id === updates.activeAccountId);
        if (newActive?.pubkey) {
          await browser.storage.sync.set({ myPubkey: newActive.pubkey });
        }
      }
      await browser.storage.local.set(updates);
      setConfirmId(null);
      onClose();
      reload();
    } catch {}
    setRemoving(false);
  };

  return (
    <Modal title={t('account.choose')} onClose={onClose} maxWidth={360}
      footer={<ButtonSecondary onClick={onAddAccount}><IconPlus size={16} />{t('account.addAccount')}</ButtonSecondary>}>
      <div className="flex flex-col gap-3">
        {(accounts || []).map((account) => {
          const cached = profileCache[account.pubkey];
          const name = cached?.name || account.name;
          const isActive = account.id === activeId;

          return <AccountPickerRow key={account.id} name={name || truncateNpub(account.pubkey)}
            subtitle={cached?.nip05 || truncateNpub(account.pubkey)} picture={cached?.picture}
            readOnly={!!account.readOnly || account.type === 'npub'} selected={isActive}
            onSelect={() => { void switchAccount(account.id); onClose(); }} onRemove={() => setConfirmId(account.id)} />;
        })}
      </div>

      {confirmAccount && (
        <div className="py-7 px-7 border-t border-card-border">
          <div className="text-md font-semibold text-heading mb-3">
            {t('account.removeTitle', { name: profileCache[confirmAccount.pubkey]?.name || confirmAccount.name || '' })}
          </div>
          <Text variant="secondary" as="div" className="text-sm mb-2">
            {t('account.removeWarning')}
          </Text>
          {isWriteAccount && (
            <StatusNotice variant="callout" tone="warn" icon={<IconWarning />} className="mb-5">
              {t('account.removeKeyWarning')}
            </StatusNotice>
          )}
          <Container variant="row" gap={4} className="justify-end">
            <ButtonSecondary small onClick={() => setConfirmId(null)}>{t('common.cancel')}</ButtonSecondary>
            <ButtonDanger small onClick={handleRemove} disabled={removing}>
              {removing ? t('common.removing') : t('common.remove')}
            </ButtonDanger>
          </Container>
        </div>
      )}

    </Modal>
  );
}

export function AccountPickerRow({ name, subtitle, picture, selected, readOnly, onSelect, onRemove }: {
  name: string; subtitle: string; picture?: string; selected: boolean; readOnly: boolean;
  onSelect: () => void; onRemove: () => void;
}) {
  return <div className={`flex items-center gap-4 rounded-md p-5 border ${selected ? 'bg-brand-light border-brand' : 'border-card-border bg-transparent'}`}>
    <button type="button" aria-pressed={selected} onClick={onSelect}
      className="flex items-center gap-4 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer rounded-md focus-visible:shadow-focus focus-visible:outline-none">
      <div className="w-18 h-18 rounded-full bg-brand-light text-brand overflow-hidden shrink-0 flex items-center justify-center">
        <Avatar src={picture} fallback={getInitial(name)} imgClassName="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <span className="text-md font-semibold text-heading truncate">{name}</span>
        <span className="text-xs text-menu-subtitle truncate">{subtitle}</span>
        {readOnly && <span className="text-xs text-muted">{t('account.readOnly')}</span>}
      </div>
      {selected && <span className="text-brand font-semibold" aria-label={t('account.selected')}>✓</span>}
    </button>
    <IconButton tone="danger" size="small" title={t('account.remove')} aria-label={t('account.remove')} onClick={onRemove}><IconClose size={14} /></IconButton>
  </div>;
}
