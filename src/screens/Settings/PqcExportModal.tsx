import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import FormError from '@components/FormError/FormError';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

/**
 * Save the post-quantum key file, plain or encrypted.
 *
 * Its five state atoms lived in PqcSection for a dialog that is closed almost
 * always. Mounted only while open, so closing it is the reset.
 */
export default function PqcExportModal({ onClose }: { onClose: () => void }) {
  const exportPair = usePasswordPair();
  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string>('');

/**
 * Save the key file, optionally encrypted under a password.
 *
 * Same two options and the same envelope as the seed-phrase export — one
 * implementation now, in lib/crypto/keyBackup.ts, where a test proves the file
 * can be read back. Producing a backup nobody has ever decrypted is not a
 * thing to do twice.
 *
 * The exported shape is what our own importer accepts, so a file saved here
 * can be imported here. That round trip is the format's only real spec.
 */
const handleExport = async (encrypted: boolean) => {
  setExportError('');
  if (encrypted && !exportPair.ready) return;
  setExportBusy(true);
  try {
    const res = await rpc<{ keyfile: string; filename: string }>('pqc_exportKeys');
    if (encrypted) {
      downloadFile(await encryptBackup(res.keyfile, exportPair.password), res.filename.replace(/\.json$/, '-encrypted.json'));
    } else {
      downloadFile(res.keyfile, res.filename);
    }
    onClose();
  } catch (e: any) {
    setExportError(e?.message || t('common.error'));
  } finally {
    setExportBusy(false);
  }
};

  return (
      <Modal
        title={t('pqc.exportKeys')}
        onClose={onClose}
        zIndex={720}
      >
        <Text variant="secondary" as="p" className="text-sm my-4 mb-6">{t('pqc.exportDesc')}</Text>
        <StatusNotice
          tone="warn"
          icon={<IconWarning size={18} />}
          label={t('pqc.exportWarnShort')}
          info={t('pqc.exportWarn')}
        />

        <SectionLabel className="mb-6 mt-4 font-normal leading-loose">{t('key.encryptionPassword')}</SectionLabel>
        <Container gap={4} className="mb-4">
          <PasswordPairFields
            pair={exportPair}
            confirmPlaceholder={t('key.confirmPassword')}
            onSubmit={() => handleExport(true)}
            disabled={exportBusy}
          />
        </Container>

        <FormError>{exportError}</FormError>

        <Container variant="row" gap={4} className="flex-wrap mt-7">
          <Button onClick={() => handleExport(true)} disabled={exportBusy || !exportPair.ready}>
            {exportBusy ? t('common.loading') : t('key.downloadEncrypted')}
          </Button>
          {/* Plain stays available — the generator writes plaintext key files
              and some people keep them on hardware that has no password. It is
              second, and not the default. */}
          <Button variant="secondary" onClick={() => handleExport(false)} disabled={exportBusy}>
            {t('key.downloadPlain')}
          </Button>
        </Container>
      </Modal>
  );
}
