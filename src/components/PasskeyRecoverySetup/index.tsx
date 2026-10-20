import { useEffect, useRef, useState } from 'react';
import RelayRecoverySave from '@components/PasskeyRecoverySave/RelayRecoverySave';
import PasskeyRecoverySave from '@components/PasskeyRecoverySave';
import PasskeyBackupDownload from '@components/PasskeyBackupDownload';
import Button from '@components/Button';
import Checkbox from '@components/Checkbox';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { t } from '@services/i18n/i18n.ts';

export default function PasskeyRecoverySetup({ credentialId, onNext, blobSupported = false, saved = false }: { credentialId?: string; onNext: (saved?: boolean) => void; blobSupported?: boolean; saved?: boolean }) {
  const [recoveryError, setRecoveryError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [providerSaved, setProviderSaved] = useState(saved);
  const [providerUnavailable, setProviderUnavailable] = useState(!blobSupported && !saved);
  const completed = useRef(false);
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(() => {
    if (providerSaved && !completed.current) {
      completed.current = true;
      next.current(true);
    }
  }, [providerSaved]);
  if (providerSaved) return null;
  return <Container gap={6} className="flex-1">
    {blobSupported && !providerSaved && <PasskeyRecoverySave credentialId={credentialId} autoStart onSaved={() => setProviderSaved(true)} onUnavailable={message => { setProviderUnavailable(true); setRecoveryError(message || ''); }} />}
    {providerUnavailable && <>
    <FormError>{recoveryError}</FormError>
    <Text variant="secondary">{t('passkey.backupDesc')}</Text>
    <PasskeyBackupDownload onDownloaded={() => setDownloaded(true)} />
    {downloaded && !providerSaved && <label className="flex items-start gap-3 text-secondary"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t('passkey.confirmBackup')}</label>}
    {!providerSaved && providerUnavailable && <RelayRecoverySave credentialId={credentialId} usePrepared />}
    <Container stickyFooter><Button disabled={!downloaded || !confirmed} onClick={() => onNext(false)}>{t('common.continue')}</Button></Container>
    </>}
  </Container>;
}
