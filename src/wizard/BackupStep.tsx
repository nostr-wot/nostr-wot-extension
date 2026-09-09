import { useState } from 'react';
import { downloadFile } from '@utils/downloadFile.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@services/i18n/i18n.ts';
import { IconCopy, IconDownload, IconLock, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import ActionTile from '@components/ActionTile/ActionTile';
import EncryptedBackupModal from './EncryptedBackupModal';
import Heading from '@components/Heading/Heading';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

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
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.backUpKeys')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.chooseBackup')}
      </Text>

      <Container gap={3}>
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
      </Container>

      {safetyShown && (
        <div className="py-7 px-7 bg-[rgba(217,119,6,0.06)] border border-[rgba(217,119,6,0.15)] rounded-lg mt-6">
          <IconWarning size={20} className="text-warning mb-3" />
          <Heading level={5} className="mb-2">{t('wizard.keepSafe')}</Heading>
          <Text variant="secondary" className="text-sm mb-5">
            {t('wizard.keepSafeDesc')}
          </Text>
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
    </Container>
  );
}
