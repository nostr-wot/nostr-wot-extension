import { useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { parsePasskeyBackup, type PasskeyMetadata } from '@domain/vault/passkey.ts';
import { PASSKEY_MAX_BACKUP_BYTES } from '@constants/passkey.ts';
import PasskeySelector from '@components/PasskeySelector';
import { createPasskey, authenticatePasskey } from '@services/vault/passkeyClient.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '@constants/accounts.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import Button from '@components/Button';
import Input from '@components/Input';
import Checkbox from '@components/Checkbox';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import PasskeyBackupDownload from '@components/PasskeyBackupDownload';

export function PasskeyBackupStep({ onNext }: { onNext: () => void }) {
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t('passkey.backupDesc')}</Text>
    <PasskeyBackupDownload onDownloaded={() => setDownloaded(true)} />
    {downloaded && <label className="flex items-start gap-3 text-secondary"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t('passkey.confirmBackup')}</label>}
    <Container stickyFooter><Button disabled={!downloaded || !confirmed} onClick={onNext}>{t('common.continue')}</Button></Container>
  </Container>;
}

export default function PasskeyStep({ restore = false, onNext }: { restore?: boolean; onNext: (account: SafeAccount) => void }) {
  const [name, setName] = useState('');
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
        const metadata = credentials.find((credential) => credential.credentialId === selected) || credentials[0];
        const credential = await authenticatePasskey(metadata);
        try {
          const result = await rpc<{ accounts: SafeAccount[]; account: SafeAccount }>('vault_restorePasskeyBackup', { backup, ...credential });
          onNext(result.account);
        } finally { credential.prf = ''; }
      } else {
        // Start WebAuthn from the user's gesture before the background round trip.
        const passkey = await createPasskey(name.trim() || t('passkey.account'));
        try {
          const result = await rpc<{ account: SafeAccount }>('onboarding_generateAccount', { hideMnemonic: true });
          const account = { ...result.account, name: name.trim() || result.account.name };
          await rpc('onboarding_createVault', { account, name: name.trim() || account.name, passkey, autoLockMinutes: 15 });
          onNext(account);
        } finally { passkey.prf = ''; }
      }
    } catch (e) { setError((e as Error).message || t('common.error')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t(restore ? 'passkey.restoreDesc' : 'passkey.explanation')}</Text>
    {restore ? <><SectionLabel htmlFor="passkey-file">{t('passkey.backup')}</SectionLabel><Input id="passkey-file" type="file" accept=".json,application/json" disabled={busy} onChange={async (e) => {
      setError(''); setBackup(''); setCredentials([]); setSelected('');
      const file = e.target.files?.[0];
      if (!file) return;
      try { if (file.size > PASSKEY_MAX_BACKUP_BYTES) throw new Error(t('passkey.invalidBackup')); const text = await file.text(); const record = parsePasskeyBackup(text); setCredentials(record.passkeys); setSelected(record.passkeys[0].credentialId); setBackup(text); } catch (error) { setError((error as Error).message); }
    }} /></> : <><SectionLabel htmlFor="passkey-name">{t('wizard.accountName')}</SectionLabel><Input id="passkey-name" value={name} maxLength={MAX_ACCOUNT_NAME_LENGTH} disabled={busy} onChange={(e) => setName(e.target.value)} /></>}
    {restore && <PasskeySelector credentials={credentials} value={selected} onChange={setSelected} disabled={busy} />}
    <FormError>{error}</FormError>
    <Container stickyFooter><Button onClick={submit} disabled={busy || (restore && !backup)}>{t(busy ? 'common.loading' : restore ? 'passkey.restore' : 'passkey.create')}</Button></Container>
  </Container>;
}
