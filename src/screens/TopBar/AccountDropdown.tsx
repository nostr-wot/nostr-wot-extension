import type { AccountRemovalInfo } from '@domain/accounts/types.ts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { useAccount } from '@context/AccountContext';
import { getInitial } from '@utils/format/text.ts';
import { accountDisplay } from '@domain/accounts/display.ts';
import AccountLabel from './AccountLabel';
import IconWarning from '@assets/IconWarning.tsx';
import IconClose from '@assets/IconClose.tsx';
import IconPlus from '@assets/IconPlus.tsx';
import IconTag from '@assets/IconTag.tsx';
import Input from '@components/Input';
import Avatar from '@components/Avatar';
import { ButtonSecondary } from '@components/Button';
import IconButton from '@components/IconButton';
import Modal from '@components/Modal';
import ConfirmDialog from '@components/ConfirmDialog';
import StatusNotice from '@components/StatusNotice';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';
import { MAX_ACCOUNT_NAME_LENGTH } from '@constants/accounts.ts';

interface AccountDropdownProps {
  onClose: () => void;
  onAddAccount: () => void;
}

export default function AccountDropdown({ onClose, onAddAccount }: AccountDropdownProps) {
  const { accounts, activeId, profileCache, labels, switchAccount, reload } = useAccount();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<boolean>(false);
  const confirmAccount = confirmId ? (accounts || []).find((a) => a.id === confirmId) : null;
  const [removalInfo, setRemovalInfo] = useState<AccountRemovalInfo | null>(null);
  const isWriteAccount = confirmAccount && !confirmAccount.readOnly && confirmAccount.type !== 'npub';

  useEffect(() => {
    let cancelled = false;
    setRemovalInfo(null);
    if (confirmAccount?.type === 'generated') {
      rpc<AccountRemovalInfo>('vault_getAccountRemovalInfo', { accountId: confirmAccount.id })
        .then(info => { if (!cancelled && info?.warning) setRemovalInfo(info); })
        .catch(() => { if (!cancelled) setError(t('common.error')); });
    }
    return () => { cancelled = true; };
  }, [confirmAccount?.id, confirmAccount?.type]);

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
          const display = accountDisplay(account, cached, labels[account.id]);
          const isActive = account.id === activeId;

          return <AccountPickerRow key={account.id} accountId={account.id} name={display.name}
            label={display.hasProfileName ? undefined : labels[account.id] ?? ''}
            onSaveLabel={(label) => rpc('setAccountLabel', { accountId: account.id, label })}
            subtitle={display.subtitle} picture={display.picture || undefined} remote={account.type === 'nip46'}
            readOnly={!!account.readOnly || account.type === 'npub'} selected={isActive}
            onSelect={() => { void switchAccount(account.id); onClose(); }} onRemove={() => { setError(''); setConfirmId(account.id); }} />;
        })}
      </div>

    </Modal>
    {confirmAccount && <ConfirmDialog
      title={t('account.removeTitle', { name: profileCache[confirmAccount.pubkey]?.name || confirmAccount.name || '' })}
      message={<>{t('account.removeWarning')}{isWriteAccount &&
        <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t(confirmAccount.type === 'generated' ? removalInfo?.warning || 'account.removeSeedWarning' : 'account.removeKeyWarning', { count: removalInfo?.relatedCount || 0 })}</StatusNotice>}
        {confirmAccount.derivationPath && <FieldDisplay mono label={t('wizard.derivationPath')} value={confirmAccount.derivationPath} />}
      </>}
      danger busy={removing} error={error} confirmLabel={t('common.remove')}
      onConfirm={handleRemove} onCancel={() => setConfirmId(null)}
    />}
    </>
  );
}

/**
 * One account in the picker. Accounts with no profile name get a tag button
 * (`label` is defined) that swaps the row's text for an inline label field:
 * Enter or leaving the field saves, Escape cancels, an empty label clears it.
 * The field replaces the select button rather than sitting inside it, so no
 * input nests in a button.
 */
export function AccountPickerRow({ name, accountId, subtitle, picture, selected, readOnly, remote = false, label, onSaveLabel, onSelect, onRemove }: {
  name: string; accountId?: string; subtitle: string; picture?: string; selected: boolean; readOnly: boolean; remote?: boolean;
  label?: string; onSaveLabel?: (label: string) => Promise<unknown>;
  onSelect: () => void; onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [labelError, setLabelError] = useState('');
  // Closing the field blurs it; this keeps that blur from saving a second time,
  // or saving at all after Escape.
  const editing = useRef(false);
  const edit = (value: string) => { editing.current = true; setDraft(value); };
  const close = () => { editing.current = false; setDraft(null); };
  const avatar = <div className="w-18 h-18 rounded-full bg-brand-light text-brand overflow-hidden shrink-0 flex items-center justify-center">
    <Avatar src={picture} fallback={getInitial(name)} imgClassName="w-full h-full object-cover" />
  </div>;

  const save = async () => {
    if (!editing.current || draft === null) return;
    const next = draft;
    close();
    if (next.trim() === (label ?? '')) return;
    try { await onSaveLabel?.(next); setLabelError(''); } catch (error) { setLabelError(error instanceof Error ? error.message : t('common.error')); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void save(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };

  return <div className={`flex flex-col gap-2 rounded-md p-5 border ${selected ? 'bg-brand-light border-brand' : 'border-card-border bg-transparent'}`}>
    <div className="flex items-center gap-4">
      {draft !== null ? <div className="flex items-center gap-4 flex-1 min-w-0">
        {avatar}
        <Input small autoFocus value={draft} maxLength={MAX_ACCOUNT_NAME_LENGTH} placeholder={t('account.labelPlaceholder')} aria-label={t('account.labelPlaceholder')}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={() => { void save(); }} />
      </div> : <button type="button" aria-pressed={selected} onClick={onSelect}
        className="flex items-center gap-4 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer rounded-md focus-visible:shadow-focus focus-visible:outline-none">
        {avatar}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <AccountLabel accountId={accountId} name={name} remote={remote} readOnly={readOnly} />
          <span className="text-xs text-menu-subtitle truncate">{subtitle}</span>
        </div>
        {selected && <span className="text-brand font-semibold" aria-label={t('account.selected')}>✓</span>}
      </button>}
      {label !== undefined && draft === null && <IconButton size="small" title={t('account.label')} aria-label={t('account.label')} onClick={() => edit(label)}><IconTag size={14} /></IconButton>}
      <IconButton tone="danger" size="small" title={t('account.remove')} aria-label={t('account.remove')} onClick={onRemove}><IconClose size={14} /></IconButton>
    </div>
    {labelError && <FormError>{labelError}</FormError>}
  </div>;
}
