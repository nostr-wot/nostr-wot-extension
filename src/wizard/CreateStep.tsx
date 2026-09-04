import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import { IconWarning, IconEye, IconCopy, IconDownload, IconLock } from '@assets';
import Button from '@components/Button/Button';
import ActionTile from '@components/ActionTile/ActionTile';
import Card from '@components/Card/Card';
import styles from './WizardOverlay.module.css';
import EncryptedBackupModal from './EncryptedBackupModal';
import SeedWord from '@components/SeedWord/SeedWord';

const CREATE_STORAGE_KEY = 'wizardCreateData';
const CREATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CreateStepProps {
  onNext: (account: any, mnemonic: string) => void;
}

export default function CreateStep({ onNext }: CreateStepProps) {
  const [account, setAccount] = useState<any>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [revealed, setRevealed] = useState<boolean>(false);
  const seedCopy = useCopy();
  const [encModalOpen, setEncModalOpen] = useState<boolean>(false);
  const [backedUp, setBackedUp] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        // Try restoring from session storage (popup was closed and reopened)
        const saved = await browser.storage.session.get(CREATE_STORAGE_KEY);
        const data = (saved as Record<string, any>)[CREATE_STORAGE_KEY];
        if (data?.account && data?.mnemonic && data?.ts && Date.now() - data.ts < CREATE_TTL_MS) {
          setAccount(data.account);
          setMnemonic(data.mnemonic);
          setRevealed(true);
          setBackedUp(true);
          setLoading(false);
          return;
        }

        // Generate new account
        const result = await rpc<{ account: any; mnemonic: string }>('onboarding_generateAccount');
        setAccount(result.account);
        setMnemonic(result.mnemonic);

        // Persist so it survives popup close (with timestamp)
        await browser.storage.session.set({
          [CREATE_STORAGE_KEY]: { account: result.account, mnemonic: result.mnemonic, ts: Date.now() },
        });
      } catch (e: any) {
        setError(e.message || t('wizard.failedGenerate'));
      }
      setLoading(false);
    })();
  }, []);

  const handleNext = () => {
    // Clear persisted create data — wizard context takes over from here
    browser.storage.session.remove(CREATE_STORAGE_KEY).catch(() => {});
    onNext(account, mnemonic!);
  };

  if (loading) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('wizard.generatingIdentity')}</h2>
        <p className={styles.stepDesc}>{t('wizard.creatingKeypair')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('common.error')}</h2>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  const words = mnemonic ? mnemonic.split(' ') : [];

  const handleCopy = async () => {
    // Only counts as backed up if the clipboard actually took it.
    if (await seedCopy.copy(mnemonic!)) setBackedUp(true);
  };

  const handleDownloadPlain = () => {
    downloadFile(mnemonic!, `nostr-seed-${Date.now()}.txt`);
    setBackedUp(true);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.recoveryTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.recoveryDesc', { count: words.length })}
      </p>

      <div className={styles.warningBox}>
        <IconWarning />
        <span>{t('wizard.recoveryWarning')}</span>
      </div>

      <div className={styles.mnemonicWrapper}>
        <Card variant="flat" className={`${styles.mnemonicDisplay} ${words.length > 12 ? styles.mnemonicDisplayWide : ''} ${!revealed ? styles.mnemonicBlurred : ''}`}>
          {words.map((word, i) => (
            <SeedWord key={i} index={i + 1} word={word} compact={words.length > 12} />
          ))}
        </Card>

        {!revealed && (
          <button className={styles.revealBtn} onClick={() => setRevealed(true)}>
            <IconEye size={20} />
            <span>{t('wizard.revealWords')}</span>
          </button>
        )}

        {revealed && (
          <button
            className={`${styles.copyBtn} ${seedCopy.copied ? styles.copyBtnDone : ''}`}
            onClick={handleCopy}
            title={t('common.copy')}
          >
            <IconCopy size={14} />
          </button>
        )}
      </div>

      <div className={styles.backupActions}>
        <ActionTile
          icon={<IconDownload />}
          title={t('wizard.downloadPlainText')}
          description={t('wizard.saveAsTxt')}
          onClick={handleDownloadPlain}
          disabled={!revealed}
        />

        <ActionTile
          icon={<IconLock />}
          title={t('wizard.downloadEncrypted')}
          description={t('wizard.passwordProtectedFile')}
          onClick={() => setEncModalOpen(true)}
          disabled={!revealed}
        />
      </div>

      <div className={styles.stepActions}>
        <Button onClick={handleNext} disabled={!backedUp}>
          {t('wizard.iWrittenItDown')}
        </Button>
      </div>

      {encModalOpen && (
        <EncryptedBackupModal
          rpcMethod="onboarding_exportNcryptsec"
          onClose={() => setEncModalOpen(false)}
          onSuccess={() => { setEncModalOpen(false); setBackedUp(true); }}
        />
      )}
    </div>
  );
}
