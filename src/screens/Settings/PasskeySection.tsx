import { useEffect, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey, createPasskey } from '@services/vault/passkeyClient.ts';
import type { PasskeyMetadata } from '@domain/vault/passkey.ts';
import PasskeySelector from '@components/PasskeySelector';
import Card from '@components/Card';
import Button from '@components/Button';
import Text from '@components/Text';
import Container from '@components/Container';
import InfoTooltip from '@components/InfoTooltip';
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
  const selectedId = selected || credentials[0]?.credentialId;
  return <Container gap={6}>
    <Card>
      <Container gap={5}>
        <SectionLabel>{t('security.recovery')}<InfoTooltip text={t('passkey.recoverySnapshot')} /></SectionLabel>
        <Text variant="secondary">{t('security.recoveryHint')}</Text>
        {!locked && <><PasskeySelector credentials={credentials} value={selectedId || ''} onChange={value => { setSelected(value); setSaveNewCredential(false); }} disabled={busy} /><Button small variant="secondary" onClick={add} disabled={busy || !credentials.length} className="self-start">{t(busy ? 'common.loading' : 'passkey.add')}</Button><PasskeyRecoverySave compact autoStart={saveNewCredential} credentialId={selectedId} disabled={busy} /><PasskeyBackupDownload compact /></>}
      </Container>
    </Card>
    {added && <Text variant="secondary" role="status">{t('passkey.added')}</Text>}
    <FormError>{error}</FormError>
  </Container>;
}
