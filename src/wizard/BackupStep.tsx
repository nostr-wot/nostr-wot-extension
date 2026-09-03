import { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import useCopy from '@shared/hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import { IconCopy, IconDownload, IconLock, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import styles from './WizardOverlay.module.css';

interface BackupStepProps {
  mnemonic: string | null;
  onNext: () => void;
}

export default function BackupStep({ mnemonic, onNext }: BackupStepProps) {
  const [safetyShown, setSafetyShown] = useState<boolean>(false);
  const seedCopy = useCopy();
  const [encModalOpen, setEncModalOpen] = useState<boolean>(false);
  const [encPw, setEncPw] = useState<string>('');
  const [encConfirm, setEncConfirm] = useState<string>('');
  const [encError, setEncError] = useState<string>('');

  const handleCopy = async () => {
    // Only counts as seen if the clipboard actually took it.
    if (await seedCopy.copy(mnemonic!)) setSafetyShown(true);
  };

  const handleDownloadPlain = () => {
    downloadFile(mnemonic!, `nostr-seed-${Date.now()}.txt`);
    setSafetyShown(true);
  };

  const handleDownloadEncrypted = async () => {
    setEncError('');
    if (encPw.length < 8) { setEncError(t('wizard.minChars')); return; }
    if (encPw !== encConfirm) { setEncError(t('key.passwordsNoMatch')); return; }
    try {
      const ncryptsec = await rpc<string>('vault_exportNcryptsec', { password: encPw });
      if (ncryptsec) {
        downloadFile(ncryptsec, `nostr-backup-${Date.now()}.ncryptsec`);
        setEncModalOpen(false);
        setSafetyShown(true);
      }
    } catch {
      setEncError(t('wizard.failedGenerateBackup'));
    }
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.backUpKeys')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.chooseBackup')}
      </p>

      <div className={styles.backupActions}>
        <button className={styles.backupBtn} onClick={handleCopy}>
          <IconCopy />
          <div className={styles.backupBtnText}>
            <strong>{seedCopy.copied ? t('common.copied') : t('wizard.copySeed')}</strong>
            <span>{t('wizard.pasteIntoManager')}</span>
          </div>
        </button>

        <button className={styles.backupBtn} onClick={handleDownloadPlain}>
          <IconDownload />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadPlainText')}</strong>
            <span>{t('wizard.saveAsTxt')}</span>
          </div>
        </button>

        <button className={styles.backupBtn} onClick={() => setEncModalOpen(true)}>
          <IconLock />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadEncrypted')}</strong>
            <span>{t('wizard.passwordProtectedFile')}</span>
          </div>
        </button>
      </div>

      {safetyShown && (
        <div className={styles.safetyDrawer}>
          <IconWarning size={20} className={styles.safetyIcon} />
          <h3>{t('wizard.keepSafe')}</h3>
          <p>
            {t('wizard.keepSafeDesc')}
          </p>
          <Button small onClick={onNext}>{t('wizard.gotItVerify')}</Button>
        </div>
      )}

      {encModalOpen && (
        <Modal
          title={t('wizard.encryptBackup')}
          onClose={() => setEncModalOpen(false)}
          footerRow
          footer={(
            <>
              <Button variant="secondary" small onClick={() => setEncModalOpen(false)}>{t('common.cancel')}</Button>
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
      )}
    </div>
  );
}
