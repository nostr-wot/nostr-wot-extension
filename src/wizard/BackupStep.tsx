import { useState } from 'react';
import { downloadFile } from '@shared/downloadFile.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import { IconCopy, IconDownload, IconLock, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import ActionTile from '@components/ActionTile/ActionTile';
import styles from './WizardOverlay.module.css';
import EncryptedBackupModal from './EncryptedBackupModal';

interface BackupStepProps {
  mnemonic: string | null;
  onNext: () => void;
}

export default function BackupStep({ mnemonic, onNext }: BackupStepProps) {
  const [safetyShown, setSafetyShown] = useState<boolean>(false);
  const seedCopy = useCopy();
  const [encModalOpen, setEncModalOpen] = useState<boolean>(false);

  const handleCopy = async () => {
    // Only counts as seen if the clipboard actually took it.
    if (await seedCopy.copy(mnemonic!)) setSafetyShown(true);
  };

  const handleDownloadPlain = () => {
    downloadFile(mnemonic!, `nostr-seed-${Date.now()}.txt`);
    setSafetyShown(true);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.backUpKeys')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.chooseBackup')}
      </p>

      <div className={styles.backupActions}>
        <ActionTile
          icon={<IconCopy />}
          title={seedCopy.copied ? t('common.copied') : t('wizard.copySeed')}
          description={t('wizard.pasteIntoManager')}
          onClick={handleCopy}
        />

        <ActionTile
          icon={<IconDownload />}
          title={t('wizard.downloadPlainText')}
          description={t('wizard.saveAsTxt')}
          onClick={handleDownloadPlain}
        />

        <ActionTile
          icon={<IconLock />}
          title={t('wizard.downloadEncrypted')}
          description={t('wizard.passwordProtectedFile')}
          onClick={() => setEncModalOpen(true)}
        />
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
        <EncryptedBackupModal
          rpcMethod="vault_exportNcryptsec"
          onClose={() => setEncModalOpen(false)}
          // Marks the backup taken without closing: the dialog offers both a
          // download and a copy, and dismissing on the first makes the second
          // unreachable. Closing stays the user's decision.
          onSuccess={() => setSafetyShown(true)}
        />
      )}
    </div>
  );
}
