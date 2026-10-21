import { useState, useEffect, useRef } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import { scrollIntoViewGently } from '@utils/scroll.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@services/i18n/i18n.ts';
import IconWarning from '@assets/IconWarning.tsx';
import IconEye from '@assets/IconEye.tsx';
import IconCopy from '@assets/IconCopy.tsx';
import IconDownload from '@assets/IconDownload.tsx';
import IconLock from '@assets/IconLock.tsx';
import IconDice from '@assets/IconDice.tsx';
import Button from '@components/Button';
import ActionTile from '@components/ActionTile';
import Card from '@components/Card';
import EncryptedBackupModal from './EncryptedBackupModal';
import SeedWord from '@components/SeedWord';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import Container from '@components/Container';
import StatusNotice from '@components/StatusNotice';
import Text from '@components/Text';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { clearEntropyProgress } from './EntropyGame/progress';
import { CREATE_STORAGE_KEY, persistCreated, readCreated, type CreatedPhrase } from './createdPhrase';
import type { PhysicalEntropyKind } from '@domain/accounts/physicalEntropy.ts';

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
  const [physicalSource, setPhysicalSource] = useState<PhysicalEntropyKind | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // A restored phrase was already shown (popup closed and reopened); one handed
  // over by the dice tab has not been, so it starts hidden and un-backed-up.
  const apply = (saved: CreatedPhrase) => {
    setAccount(saved.account);
    setMnemonic(saved.mnemonic);
    setPhysicalSource(saved.physical);
    setRevealed(!saved.pendingBackup);
    setBackedUp(!saved.pendingBackup);
  };

  useEffect(() => {
    void (async () => {
      try {
        const saved = await readCreated();
        if (saved) {
          apply(saved);
          setLoading(false);
          return;
        }

        // Generate new account
        const result = await rpc<{ account: any; mnemonic: string }>('onboarding_generateAccount');
        setAccount(result.account);
        setMnemonic(result.mnemonic);

        await persistCreated(result.account, result.mnemonic);
      } catch (e: any) {
        setError(e.message || t('wizard.failedGenerate'));
      }
      setLoading(false);
    })();
  }, []);

  // The dice tab finished while this step is open (the wizard runs in a tab, or
  // the popup was reopened first).
  const mnemonicRef = useRef(mnemonic);
  mnemonicRef.current = mnemonic;
  useStorageWatch([{ area: 'session', keys: [CREATE_STORAGE_KEY] }], () => {
    void readCreated().then((saved) => {
      if (!saved?.pendingBackup || saved.mnemonic === mnemonicRef.current) return;
      apply(saved);
      scrollIntoViewGently(topRef.current, 'start');
    });
  });

  // Once the new phrase is backed up, a reopened popup must not hide it again.
  useEffect(() => {
    if (backedUp && physicalSource && account && mnemonic) void persistCreated(account, mnemonic, physicalSource);
  }, [backedUp]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEntropyGame = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('src/entrypoints/entropy/index.html') });
  };

  const handleNext = () => {
    // Clear persisted create data — wizard context takes over from here
    browser.storage.session.remove(CREATE_STORAGE_KEY).catch(() => {});
    clearEntropyProgress();
    onNext(account, mnemonic!);
  };

  if (loading) {
    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('wizard.generatingIdentity')}</Heading>
        <Text variant="secondary" className="mb-8">{t('wizard.creatingKeypair')}</Text>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('common.error')}</Heading>
        <FormError>{error}</FormError>
      </Container>
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
    <Container className="flex-1">
      <div ref={topRef} />
      <Heading className="mb-3">{t('wizard.recoveryTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.recoveryDesc', { count: words.length })}
      </Text>

      <StatusNotice variant="callout" tone="warn" icon={<IconWarning />} className="mb-6">
        {t('wizard.recoveryWarning')}
      </StatusNotice>

      {physicalSource && (
        <StatusNotice tone="ok" icon={<IconDice />} className="mb-6">
          {t(physicalSource === 'coin' ? 'entropyGame.usedCoin' : 'entropyGame.usedDice')}
        </StatusNotice>
      )}

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

      <Container gap={3}>
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
      </Container>

      <Container gap={3} className="mt-8">
        <Text as="div" className="text-md font-semibold text-heading">{t('entropyGame.title')}</Text>
        <Text variant="secondary" as="div" className="text-sm">{t('entropyGame.intro')}</Text>
        <ActionTile icon={<IconDice />} title={t('entropyGame.open')} description={t('entropyGame.openDesc')} onClick={openEntropyGame} />
      </Container>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleNext} disabled={!backedUp}>
          {t('wizard.iWrittenItDown')}
        </Button>
      </Container>

      {encModalOpen && (
        <EncryptedBackupModal
          rpcMethod="onboarding_exportNcryptsec"
          onClose={() => setEncModalOpen(false)}
          // See BackupStep: marking the backup taken must not close the
          // dialog, or downloading makes copying unreachable.
          onSuccess={() => setBackedUp(true)}
        />
      )}
    </Container>
  );
}
