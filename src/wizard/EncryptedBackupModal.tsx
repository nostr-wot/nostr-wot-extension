import { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import { validatePasswordPair } from '@shared/passwordPair.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import styles from './WizardOverlay.module.css';

interface EncryptedBackupModalProps {
  /** BackupStep exports from an already-created vault; CreateStep exports mid-onboarding,
   *  before the vault is the current account. Same dialog, different backend call. */
  rpcMethod: 'vault_exportNcryptsec' | 'onboarding_exportNcryptsec';
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Password-protected seed export, shared by BackupStep and CreateStep.
 *
 * Its two password fields and their error lived in both steps, along with a duplicate
 * `<Modal>` and a duplicate handler differing only in the RPC name. Mounting it only
 * while open makes closing it the reset, the same way AddRuleModal resets its fields.
 */
export default function EncryptedBackupModal({ rpcMethod, onClose, onSuccess }: EncryptedBackupModalProps) {
  const [encPw, setEncPw] = useState<string>('');
  const [encConfirm, setEncConfirm] = useState<string>('');
  const [encError, setEncError] = useState<string>('');

  const handleDownloadEncrypted = async () => {
    setEncError('');
    const problem = validatePasswordPair(encPw, encConfirm);
    if (problem) {
      setEncError(t(problem === 'tooShort' ? 'wizard.minChars' : 'key.passwordsNoMatch'));
      return;
    }
    try {
      const ncryptsec = await rpc<string>(rpcMethod, { password: encPw });
      if (ncryptsec) {
        downloadFile(ncryptsec, `nostr-backup-${Date.now()}.ncryptsec`);
        onSuccess();
      }
    } catch {
      setEncError(t('wizard.failedGenerateBackup'));
    }
  };

  return (
    <Modal
      title={t('wizard.encryptBackup')}
      onClose={onClose}
      footerRow
      footer={(
        <>
          <Button variant="secondary" small onClick={onClose}>{t('common.cancel')}</Button>
          <Button small onClick={handleDownloadEncrypted}>{t('common.download')}</Button>
        </>
      )}
    >
      <p>{t('wizard.encryptBackupDesc')}</p>
      <div className={styles.formGroup}>
        <Input
          type="password"
          showToggle
          placeholder={t('key.passwordMinChars')}
          value={encPw}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEncPw(e.target.value)}
        />
      </div>
      <div className={styles.formGroup}>
        <Input
          type="password"
          placeholder={t('key.confirmPassword')}
          value={encConfirm}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEncConfirm(e.target.value)}
        />
      </div>
      {encError && <div className={styles.error}>{encError}</div>}
    </Modal>
  );
}
