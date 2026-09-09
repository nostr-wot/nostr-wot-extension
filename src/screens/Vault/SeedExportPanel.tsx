import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import IconWarning from '@assets/IconWarning.tsx';
import Button from '@components/Button/Button';
import CopyButton from '@components/CopyButton/CopyButton';
import useTimedReveal from '@hooks/useTimedReveal.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import SeedWord from '@components/SeedWord/SeedWord';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import Text from '@components/Text/Text';

/** State is scoped to this action and discarded when its panel unmounts. */
export default function SeedExportPanel({ onClose }: { onClose: () => void }) {
  const seed = useTimedReveal<string[]>([], 60_000);
  const [seedEncMode, setSeedEncMode] = useState(false);
  const seedEncPair = usePasswordPair();
  const [seedEncError, setSeedEncError] = useState('');
  const [seedEncrypting, setSeedEncrypting] = useState(false);
  const handleClose = () => { seed.clear(); seedEncPair.reset(); onClose(); };
  const revealSeed = async () => {
    try {
      const result = await rpc<{ mnemonic: string }>('vault_exportSeed');
      if (result?.mnemonic) seed.reveal(result.mnemonic.split(' '));
    } catch { /* ignore */ }
  };

  const downloadSeedPlain = () => {
    downloadFile(seed.value.join(' '), 'nostr-seed-phrase.txt');
  };

  const downloadSeedEncrypted = async () => {
    setSeedEncError('');
    if (!seedEncPair.ready) return;
    setSeedEncrypting(true);
    try {
      // One implementation, in lib/crypto/keyBackup.ts, where a round-trip test
      // proves the file can be read back. This was inline here — so nothing ever
      // verified that the last copy of someone's seed phrase was decryptable.
      const payload = await encryptBackup(seed.value.join(' '), seedEncPair.password);
      downloadFile(payload, 'nostr-seed-phrase-encrypted.json');
      setSeedEncMode(false);
      seedEncPair.reset();
    } catch {
      setSeedEncError(t('key.failedExport'));
    }
    setSeedEncrypting(false);
  };

  return (
    <Container gap={5}>
      {!seed.revealed ? (
        <>
          <StatusNotice variant="callout" tone="error" icon={<IconWarning />}>
            {t('key.seedWarning')}
          </StatusNotice>
          <Container variant="row" gap={4} className="justify-end mt-2">
            <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
            <Button variant="danger" small onClick={revealSeed}>{t('key.revealKey')}</Button>
          </Container>
        </>
      ) : (
        <>
          <button type="button" className="w-full border-none bg-transparent font-[inherit] text-left cursor-pointer rounded-panel" onClick={seed.toggleBlur} aria-pressed={!seed.blurred}>
            <div className={`grid grid-cols-3 gap-1 py-5 px-6 bg-card border border-card-border rounded-panel transition-[filter] duration-slow ${seed.blurred ? 'blur-[6px] select-none' : ''}`}>
              {seed.value.map((word, i) => (
                <SeedWord key={i} index={i + 1} word={word} />
              ))}
            </div>
          </button>
          <Text variant="muted" as="div" className="text-center">{`${t(seed.blurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.seedAutoHideHint')}`}</Text>
          {seedEncMode ? (
            <>
              <PasswordPairFields
                pair={seedEncPair}
                passwordPlaceholder={t('key.seedDownloadPassword')}
                confirmPlaceholder={t('key.seedDownloadConfirm')}
                onSubmit={downloadSeedEncrypted}
                disabled={seedEncrypting}
              />
              <FormError>{seedEncError}</FormError>
              <Container variant="row" gap={4} className="justify-end mt-2">
                <Button variant="secondary" small onClick={() => { setSeedEncMode(false); seedEncPair.reset(); setSeedEncError(''); }}>{t('common.cancel')}</Button>
                <Button small onClick={downloadSeedEncrypted} disabled={seedEncrypting || !seedEncPair.ready}>
                  {seedEncrypting ? t('key.seedEncrypting') : t('common.download')}
                </Button>
              </Container>
            </>
          ) : (
            <Container variant="row" gap={3} className="flex-wrap justify-end mt-2">
              <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
              <CopyButton value={seed.value.join(' ')} label={t('common.copy')} />
              <Button variant="secondary" small onClick={downloadSeedPlain}>{t('key.downloadPlain')}</Button>
              <Button small onClick={() => setSeedEncMode(true)}>{t('key.downloadEncrypted')}</Button>
            </Container>
          )}
        </>
      )}
    </Container>
  );
}
