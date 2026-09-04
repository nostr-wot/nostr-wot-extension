import { useState, useEffect, useRef, MouseEvent } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import { npubEncode } from '@lib/crypto/bech32.js';
import { useAccount } from '@context/AccountContext';
import { truncateNpub, getInitial } from '@utils/format/text.ts';
import { IconClose, IconCopy, IconPencil } from '@assets';
import Avatar from '@components/Avatar/Avatar';
import Button from '@components/Button/Button';
import IconButton from '@components/IconButton/IconButton';
import useOutsideClick from '@hooks/useOutsideClick.ts';
import useCopy from '@hooks/useCopy.ts';

interface AccountDropdownProps {
  onClose: () => void;
  onAddAccount: () => void;
  onEditProfile: () => void;
}

interface CopyMenuPos {
  top: number;
  right: number;
}

export default function AccountDropdown({ onClose, onAddAccount, onEditProfile }: AccountDropdownProps) {
  const { accounts, activeId, profileCache, switchAccount, reload } = useAccount();
  const ref = useRef<HTMLDivElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<boolean>(false);
  const [copyMenuId, setCopyMenuId] = useState<string | null>(null);
  const [copyMenuPos, setCopyMenuPos] = useState<CopyMenuPos | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useOutsideClick(ref, onClose);

  /**
   * The tick is per row, so this keeps its own `copiedId` rather than useCopy's
   * single boolean — but the write goes through useCopy, which catches. It was
   * an un-awaited-in-effect `writeText` with no error path, so a clipboard the
   * browser refused still showed "Copied", and the reset timer was never
   * cleared on unmount.
   */
  const { copy } = useCopy();
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const handleCopy = async (pubkey: string, format: 'npub' | 'hex') => {
    const text = format === 'npub' ? npubEncode(pubkey) : pubkey;
    setCopyMenuId(null);
    setCopyMenuPos(null);
    if (!(await copy(text))) return;
    setCopiedId(pubkey);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1500);
  };

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
    <div className={`animate-dropdown-in absolute top-full inset-x-0 mt-2 bg-elevated rounded-lg shadow-pop border border-card-border z-topbar`} ref={ref}>
      <div className="max-h-120 overflow-y-auto">
        {(accounts || []).map((account) => {
          const cached = profileCache[account.pubkey];
          const name = cached?.name || account.name;
          const isActive = account.id === activeId;

          return (
            <div
              key={account.id}
              className={`group flex items-center gap-5 py-5 px-7 cursor-pointer transition-colors duration-fast bg-transparent border-none w-full text-left hover:bg-card ${isActive ? 'bg-card' : ''}`}
            >
              <button
                className="flex items-center gap-5 flex-1 cursor-pointer min-w-0 bg-transparent border-none p-0 text-left"
                onClick={() => {
                  setCopyMenuId(null);
                  setCopyMenuPos(null);
                  void switchAccount(account.id);
                  onClose();
                }}
              >
                <div className="w-16 h-16 rounded-full bg-[rgba(99,102,241,0.15)] text-brand-hover font-bold text-md flex items-center justify-center shrink-0 overflow-hidden">
                  <Avatar
                    src={cached?.picture}
                    fallback={getInitial(name)}
                    imgClassName="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-md font-semibold text-heading whitespace-nowrap overflow-hidden text-ellipsis">{name}</span>
                    {(account.readOnly || account.type === 'npub') && (
                      <span className="text-[8px] font-semibold uppercase tracking-[0.4px] text-muted bg-brand-tint-active py-px px-2 rounded-[3px] shrink-0 leading-normal">
                        {t('account.readOnly')}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted whitespace-nowrap overflow-hidden text-ellipsis">{cached?.nip05 || truncateNpub(account.pubkey)}</span>
                </div>
                {isActive && <span className="text-body font-bold text-lg shrink-0">&#10003;</span>}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {!account.readOnly && account.type !== 'npub' && (
                  <IconButton
                    size={22}
                    className="opacity-0 group-hover:opacity-100 hover:text-brand hover:bg-brand-tint-active"
                    title={t('settings.editProfile')}
                    aria-label={t('settings.editProfile')}
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      void switchAccount(account.id);
                      onClose();
                      onEditProfile();
                    }}
                  >
                    <IconPencil size={13} />
                  </IconButton>
                )}
                <div className="relative">
                  {copiedId === account.pubkey ? (
                    <span className="text-2xs font-semibold text-success py-1 px-2 whitespace-nowrap">{t('common.copied')}</span>
                  ) : (
                    <IconButton
                      size={22}
                      className="opacity-0 group-hover:opacity-100 hover:text-brand hover:bg-brand-tint-active"
                      title={t('common.copy')}
                      aria-label={t('common.copy')}
                      onClick={(e: MouseEvent<HTMLButtonElement>) => {
                        e.stopPropagation();
                        if (copyMenuId === account.id) {
                          setCopyMenuId(null);
                          setCopyMenuPos(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setCopyMenuPos({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
                          setCopyMenuId(account.id);
                        }
                      }}
                    >
                      <IconCopy size={13} />
                    </IconButton>
                  )}
                  {copyMenuId === account.id && copyMenuPos && (
                    <div
                      className="fixed bg-card border border-card-border rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.1)] z-[calc(var(--z-topbar)+2)] overflow-hidden min-w-32"
                      style={{ top: copyMenuPos.top, right: copyMenuPos.right }}
                    >
                      <button
                        className="block w-full py-3 px-6 bg-transparent border-none text-sm font-medium text-heading cursor-pointer text-left font-mono transition-colors duration-fast hover:bg-card"
                        onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); void handleCopy(account.pubkey, 'npub'); }}
                      >
                        npub
                      </button>
                      <button
                        className="block w-full py-3 px-6 bg-transparent border-none border-t border-card-border text-sm font-medium text-heading cursor-pointer text-left font-mono transition-colors duration-fast hover:bg-card"
                        onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); void handleCopy(account.pubkey, 'hex'); }}
                      >
                        hex
                      </button>
                    </div>
                  )}
                </div>
                <IconButton
                  tone="danger"
                  size={22}
                  className="opacity-0 group-hover:opacity-100"
                  title={t('account.remove')}
                  aria-label={t('account.remove')}
                  onClick={(e: MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    setConfirmId(account.id);
                  }}
                >
                  <IconClose size={14} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>

      {confirmAccount && (
        <div className="py-7 px-7 border-t border-card-border">
          <div className="text-md font-semibold text-heading mb-3">
            {t('account.removeTitle', { name: profileCache[confirmAccount.pubkey]?.name || confirmAccount.name || '' })}
          </div>
          <div className="text-sm text-secondary leading-normal mb-2">
            {t('account.removeWarning')}
          </div>
          {isWriteAccount && (
            <div className="flex items-start gap-3 text-xs text-warning bg-[rgba(217,119,6,0.06)] py-4 px-5 rounded-md leading-normal mb-5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{t('account.removeKeyWarning')}</span>
            </div>
          )}
          <div className="flex gap-4 justify-end">
            <Button variant="secondary" small onClick={() => setConfirmId(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" small onClick={handleRemove} disabled={removing}>
              {removing ? t('common.removing') : t('common.remove')}
            </Button>
          </div>
        </div>
      )}

      <button className="block w-full py-5 px-7 border-none border-t border-card-border bg-transparent text-secondary text-md font-semibold cursor-pointer text-left transition-colors duration-fast hover:bg-brand-tint-hover" onClick={onAddAccount}>
        + {t('account.addAccount')}
      </button>
    </div>
  );
}
