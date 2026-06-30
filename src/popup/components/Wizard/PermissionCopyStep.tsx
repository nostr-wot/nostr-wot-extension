import { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import styles from './WizardOverlay.module.css';

interface EnrichedAccount {
  id: string;
  name?: string;
  pubkey?: string;
  displayName: string;
}

interface PermissionCopyAccount {
  id?: string;
}

interface PermissionCopyStepProps {
  onNext: () => void;
  account: PermissionCopyAccount | null;
}

export default function PermissionCopyStep({ onNext, account }: PermissionCopyStepProps) {
  const [accounts, setAccounts] = useState<EnrichedAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [copying, setCopying] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const data: any = await browser.storage.local.get(['accounts']);
      const existing = (data.accounts || []).filter((a: any) => a.id !== account?.id);

      // No other accounts — nothing to copy, skip this step
      if (existing.length === 0) { onNext(); return; }

      // Check if any other account actually has permissions set
      let hasPerms = false;
      for (const a of existing) {
        try {
          const perms = await rpc<Record<string, unknown>>('signer_getPermissions', { accountId: a.id });
          if (perms && Object.keys(perms).length > 0) { hasPerms = true; break; }
        } catch { /* ignore */ }
      }
      if (!hasPerms) { onNext(); return; }

      // Try to get profile names
      const enriched: EnrichedAccount[] = await Promise.all(existing.map(async (a: any) => {
        let displayName: string = a.name || a.pubkey?.slice(0, 16) + '...';
        try {
          const meta = await rpc<{ name?: string }>('getProfileMetadata', { pubkey: a.pubkey });
          if (meta?.name) displayName = meta.name;
        } catch { /* ignore */ }
        return { ...a, displayName };
      }));

      setAccounts(enriched);
      if (enriched.length > 0) setSelectedId(enriched[0].id);
    })();
  }, [account?.id, onNext]);

  // Start fresh: isolate the new account's permissions (switches to per-account
  // mode if the app was in shared "all accounts" mode, preserving existing
  // accounts' perms) and leave the new account empty.
  const handleFresh = async () => {
    if (!account?.id) { onNext(); return; }
    setCopying(true);
    try {
      await rpc('signer_setupNewAccountPermissions', { newAccountId: account.id, copyFromAccountId: null });
    } catch {}
    setCopying(false);
    onNext();
  };

  const handleCopy = async () => {
    if (!selectedId || !account?.id) return;
    setCopying(true);
    try {
      await rpc('signer_setupNewAccountPermissions', { newAccountId: account.id, copyFromAccountId: selectedId });
    } catch {}
    setCopying(false);
    onNext();
  };

  const options = accounts.map((a) => ({ value: a.id, label: a.displayName }));

  return (
    <div className={styles.step}>
      <div className={styles.stepTitle}>{t('wizard.copyPermissions')}</div>
      <p className={styles.stepDesc}>{t('wizard.copyPermissionsDesc')}</p>

      {accounts.length > 0 && (
        <div className={styles.permCopyPicker}>
          <Dropdown
            options={options}
            value={selectedId}
            onChange={setSelectedId}
          />
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={handleFresh} disabled={copying}>
          {t('wizard.startFresh')}
        </Button>
        {accounts.length > 0 && (
          <Button onClick={handleCopy} disabled={copying || !selectedId}>
            {copying ? t('common.loading') : t('wizard.copyFrom')}
          </Button>
        )}
      </div>
    </div>
  );
}
