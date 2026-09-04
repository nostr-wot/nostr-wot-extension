import { useState, useEffect } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import { IconWarning, IconEye, IconCopy, IconDownload, IconLock } from '@assets';
import Button from '@components/Button/Button';
import ActionTile from '@components/ActionTile/ActionTile';
import Card from '@components/Card/Card';
import EncryptedBackupModal from './EncryptedBackupModal';
import SeedWord from '@components/SeedWord/SeedWord';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';

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
    void (async () => {
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
      <div className="flex flex-col flex-1">
        <Heading className="mb-3">{t('wizard.generatingIdentity')}</Heading>
        <p className="text-md text-secondary leading-normal mb-8">{t('wizard.creatingKeypair')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1">
        <Heading className="mb-3">{t('common.error')}</Heading>
        <FormError>{error}</FormError>
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
    <div className="flex flex-col flex-1">
      <Heading className="mb-3">{t('wizard.recoveryTitle')}</Heading>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.recoveryDesc', { count: words.length })}
      </p>

      <div className="flex items-start gap-4 py-5 px-6 bg-[rgba(217,119,6,0.06)] rounded-panel text-sm text-warning leading-normal mb-6">
        <IconWarning className="shrink-0 mt-px" />
        <span>{t('wizard.recoveryWarning')}</span>
      </div>

      <div className="relative mb-6">
        <Card
          variant="flat"
          className={`grid gap-1 pt-5 px-7 pb-16 mb-0 transition-[filter] duration-300 ${words.length > 12 ? 'grid-cols-4 gap-y-2 gap-x-1' : 'grid-cols-3'} ${!revealed ? 'blur-[6px] select-none pointer-events-none' : ''}`}
        >
          {words.map((word, i) => (
            <SeedWord key={i} index={i + 1} word={word} compact={words.length > 12} />
          ))}
        </Card>

        {!revealed && (
          <button
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3 py-5 px-9 bg-[rgba(99,102,241,0.95)] text-on-brand border-0 rounded-panel text-md font-semibold cursor-pointer z-2 shadow-[0_2px_12px_rgba(99,102,241,0.3)] transition-all hover:bg-[rgba(99,102,241,1)] hover:scale-[1.03]"
            onClick={() => setRevealed(true)}
          >
            <IconEye size={20} />
            <span>{t('wizard.revealWords')}</span>
          </button>
        )}

        {revealed && (
          <button
            className={`absolute bottom-4 right-4 flex items-center justify-center w-14 h-14 border border-card-border bg-card rounded-sm cursor-pointer text-muted transition-all z-2 hover:text-brand hover:border-brand ${seedCopy.copied ? 'text-success border-success' : ''}`}
            onClick={handleCopy}
            title={t('common.copy')}
          >
            <IconCopy size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
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

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={handleNext} disabled={!backedUp}>
          {t('wizard.iWrittenItDown')}
        </Button>
      </div>

      {encModalOpen && (
        <EncryptedBackupModal
          rpcMethod="onboarding_exportNcryptsec"
          onClose={() => setEncModalOpen(false)}
          // See BackupStep: marking the backup taken must not close the
          // dialog, or downloading makes copying unreachable.
          onSuccess={() => setBackedUp(true)}
        />
      )}
    </div>
  );
}
