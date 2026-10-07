import { useEffect, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey, createPasskey } from '@services/vault/passkeyClient.ts';
import type { PasskeyMetadata } from '@domain/vault/passkey.ts';
import PasskeySelector from '@components/PasskeySelector';
import Card from '@components/Card';
import Button from '@components/Button';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import PasskeyRecoverySave from '@components/PasskeyRecoverySave';
import PasskeyBackupDownload from '@components/PasskeyBackupDownload';

export default function PasskeySection({ locked }: { locked: boolean }) {
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const refresh = () => rpc<PasskeyMetadata[]>('vault_listPasskeys').then(setCredentials);
  useEffect(() => { void refresh().catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [saveNewCredential, setSaveNewCredential] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    if (busy) return;
    setBusy(true); setError(''); setAdded(false);
    try {
      const metadata = credentials.find((credential) => credential.credentialId === selected) || credentials[0];
      const existing = await authenticatePasskey(metadata);
      try {
        const passkey = await createPasskey(t('passkey.account'));
        try {
          await rpc('vault_addPasskey', { existing, passkey });
          setSelected(passkey.credentialId);
          setSaveNewCredential(passkey.largeBlobSupported === true);
          setAdded(true);
          await refresh();
        }
        finally { passkey.prf = ''; }
      } finally { existing.prf = ''; }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <Card>
    <SectionLabel>{t('passkey.title')}</SectionLabel>
    <Text variant="secondary" className="mb-6">{t('passkey.recoverySnapshot')}</Text>
    {!locked && <><PasskeySelector credentials={credentials} value={selected || credentials[0]?.credentialId || ''} onChange={(value) => { setSelected(value); setSaveNewCredential(false); }} disabled={busy} /><Button small onClick={add} disabled={busy || !credentials.length} className="mb-6">{t(busy ? 'common.loading' : 'passkey.add')}</Button><PasskeyRecoverySave autoStart={saveNewCredential} credentialId={selected || credentials[0]?.credentialId} disabled={busy} /><PasskeyBackupDownload /></>}
    {added && <Text variant="secondary" role="status" className="mt-4">{t('passkey.added')}</Text>}
    <FormError>{error}</FormError>
  </Card>;
}
