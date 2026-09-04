import React, { useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import { downloadFile } from '@shared/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import styles from './PqcSection.module.css';
import { validatePasswordPair } from '@shared/passwordPair.ts';

/**
 * Save the post-quantum key file, plain or encrypted.
 *
 * Its five state atoms lived in PqcSection for a dialog that is closed almost
 * always. Mounted only while open, so closing it is the reset.
 */
export default function PqcExportModal({ onClose }: { onClose: () => void }) {
  const [exportPw, setExportPw] = useState<string>('');
  const [exportConfirmPw, setExportConfirmPw] = useState<string>('');
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
  if (encrypted) {
    const problem = validatePasswordPair(exportPw, exportConfirmPw);
    if (problem) {
      setExportError(t(problem === 'tooShort' ? 'key.passwordMin8' : 'key.passwordsNoMatch'));
      return;
    }
  }
  setExportBusy(true);
  try {
    const res = await rpc<{ keyfile: string; filename: string }>('pqc_exportKeys');
    if (encrypted) {
      downloadFile(await encryptBackup(res.keyfile, exportPw), res.filename.replace(/\.json$/, '-encrypted.json'));
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
        <p className={styles.desc}>{t('pqc.exportDesc')}</p>
        <StatusNotice
          tone="warn"
          icon={<IconWarning size={18} />}
          label={t('pqc.exportWarnShort')}
          info={t('pqc.exportWarn')}
        />

        <label className={styles.desc} htmlFor="pqc-export-pw">{t('key.encryptionPassword')}</label>
        <input
          id="pqc-export-pw"
          type="password"
          className={styles.pqcInput}
          value={exportPw}
          autoComplete="new-password"
          onChange={(e) => setExportPw(e.target.value)}
          disabled={exportBusy}
        />
        <input
          type="password"
          className={styles.pqcInput}
          placeholder={t('key.confirmPassword')}
          value={exportConfirmPw}
          autoComplete="new-password"
          onChange={(e) => setExportConfirmPw(e.target.value)}
          disabled={exportBusy}
        />

        {exportError && <div className={styles.error}>{exportError}</div>}

        <div className={styles.pqcActions}>
          <Button onClick={() => handleExport(true)} disabled={exportBusy}>
            {exportBusy ? t('common.loading') : t('key.downloadEncrypted')}
          </Button>
          {/* Plain stays available — the generator writes plaintext key files
              and some people keep them on hardware that has no password. It is
              second, and not the default. */}
          <Button variant="secondary" onClick={() => handleExport(false)} disabled={exportBusy}>
            {t('key.downloadPlain')}
          </Button>
        </div>
      </Modal>
  );
}
