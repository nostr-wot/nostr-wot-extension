import { useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { parsePasskeyBackup, type PasskeyMetadata } from '@domain/vault/passkey.ts';
import { PASSKEY_MAX_BACKUP_BYTES } from '@constants/passkey.ts';
import PasskeySelector from '@components/PasskeySelector';
import { createPasskey, authenticatePasskey } from '@services/vault/passkeyClient.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import Button from '@components/Button';
import Input from '@components/Input';
import Checkbox from '@components/Checkbox';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import PasskeyRecoverySave from '@components/PasskeyRecoverySave';
import { restorePasskeyRecovery } from '@services/vault/passkeyRecovery.ts';
import LinkButton from '@components/LinkButton';
import PasskeyBackupDownload from '@components/PasskeyBackupDownload';

export function PasskeyBackupStep({ onNext, blobSupported = false, saved = false }: { onNext: (saved?: boolean) => void; blobSupported?: boolean; saved?: boolean }) {
  const [fileRequired, setFileRequired] = useState(!blobSupported);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  if (saved) return <Container gap={6} className="flex-1"><Text variant="secondary">{t('passkey.recoverySaved')}</Text><Container stickyFooter><Button onClick={() => onNext(true)}>{t('common.continue')}</Button></Container></Container>;
  return <Container gap={6} className="flex-1">
    {blobSupported && !fileRequired && <PasskeyRecoverySave autoStart onSaved={() => onNext(true)} onUnavailable={() => setFileRequired(true)} />}
    {fileRequired && <><Text variant="secondary">{t('passkey.recoveryFallback')}</Text>
    <Text variant="secondary">{t('passkey.backupDesc')}</Text>
    <PasskeyBackupDownload onDownloaded={() => setDownloaded(true)} />
    {downloaded && <label className="flex items-start gap-3 text-secondary"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t('passkey.confirmBackup')}</label>}
    <Container stickyFooter><Button disabled={!downloaded || !confirmed} onClick={() => onNext(false)}>{t('common.continue')}</Button></Container></>}
  </Container>;
}

export default function PasskeyStep({ restore = false, onNext }: { restore?: boolean; onNext: (account: SafeAccount, blobSupported?: boolean) => void }) {
  const [useFile, setUseFile] = useState(false);
  const [backup, setBackup] = useState('');
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (restore) {
        const recovered = useFile ? null : await restorePasskeyRecovery();
        const metadata = credentials.find((credential) => credential.credentialId === selected) || credentials[0];
        const credential = recovered?.proof || await authenticatePasskey(metadata);
        try {
          const result = await rpc<{ accounts: SafeAccount[]; account: SafeAccount }>('vault_restorePasskeyBackup', { backup: recovered?.backup || backup, ...credential });
          onNext(result.account);
        } finally { credential.prf = ''; }
      } else {
        // Start WebAuthn from the user's gesture before the background round trip.
        const passkey = await createPasskey(t('passkey.account'));
        try {
          const result = await rpc<{ account: SafeAccount }>('onboarding_generateAccount', { hideMnemonic: true });
          const account = result.account;
          await rpc('onboarding_createVault', { account, name: account.name, passkey, autoLockMinutes: 15 });
          onNext(account, passkey.largeBlobSupported === true);
        } finally { passkey.prf = ''; }
      }
    } catch (e) { setError((e as Error).message || t('common.error')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t(restore ? 'passkey.restoreDesc' : 'passkey.explanation')}</Text>
    {restore && useFile && <><SectionLabel htmlFor="passkey-file">{t('passkey.backup')}</SectionLabel><Input id="passkey-file" type="file" accept=".json,application/json" disabled={busy} onChange={async (e) => {
      setError(''); setBackup(''); setCredentials([]); setSelected('');
      const file = e.target.files?.[0];
      if (!file) return;
      try { if (file.size > PASSKEY_MAX_BACKUP_BYTES) throw new Error(t('passkey.invalidBackup')); const text = await file.text(); const record = parsePasskeyBackup(text); setCredentials(record.passkeys); setSelected(record.passkeys[0].credentialId); setBackup(text); } catch (error) { setError((error as Error).message); }
    }} /></>}
    {restore && useFile && <PasskeySelector credentials={credentials} value={selected} onChange={setSelected} disabled={busy} />}
    {restore && <LinkButton disabled={busy} onClick={() => { setUseFile(!useFile); setError(''); }}>{t(useFile ? 'passkey.usePasskey' : 'passkey.useFile')}</LinkButton>}
    <FormError>{error}</FormError>
    <Container stickyFooter><Button onClick={submit} disabled={busy || (restore && useFile && !backup)}>{t(busy ? 'common.loading' : error ? 'common.retry' : restore ? 'passkey.restore' : 'passkey.create')}</Button></Container>
  </Container>;
}
