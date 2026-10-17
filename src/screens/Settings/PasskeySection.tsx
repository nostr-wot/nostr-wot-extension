import UnlockMethodSection from './UnlockMethodSection';
import LinkButton from '@components/LinkButton';
import type { Account } from '@domain/accounts/account.ts';
import RelayRecoverySave from '@components/PasskeyRecoverySave/RelayRecoverySave';
import { PASSKEY_MAX_NAME_LENGTH, PASSKEY_RP_ID, LEGACY_PASSKEY_RP_ID } from '@constants/passkey.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { useEffect, useState } from 'react';
import { rpc, rpcRead } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey, createPasskey, authorizePasskeyDomain } from '@services/vault/passkeyClient.ts';
import { defaultPasskeyName, passkeyDisplayName, type PasskeyMetadata } from '@domain/vault/passkey.ts';
import { createPortal } from 'react-dom';
import Modal from '@components/Modal';
import IconButton from '@components/IconButton';
import IconPencil from '@assets/IconPencil';
import Input from '@components/Input';
import IconPlus from '@assets/IconPlus';
import Card from '@components/Card';
import Button from '@components/Button';
import Text from '@components/Text';
import Container from '@components/Container';
import InfoTooltip from '@components/InfoTooltip';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import PasskeyRecoverySetup from '@components/PasskeyRecoverySetup';
import PasskeyBackupDownload from '@components/PasskeyBackupDownload';

export default function PasskeySection({ locked, account }: { locked: boolean; account?: Pick<Account, 'pubkey' | 'type' | 'readOnly'> | null }) {
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState<number | null>(null);
  const refresh = () => rpcRead<PasskeyMetadata[]>('vault_listPasskeys').then(value => { setCredentials(value); setCredentialsLoaded(true); });
  useEffect(() => {
    void refresh().catch(() => {});
    void rpcRead<number>('vault_getAutoLock').then(value => { if (typeof value === 'number') setAutoLockMs(value); }).catch(() => {});
  }, []);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [saveNewCredential, setSaveNewCredential] = useState(false);
  const [error, setError] = useState('');
  const [draftName, setDraftName] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const rename = async () => {
    if (busy || draftName === null) return;
    setBusy(true); setError('');
    try {
      await rpc('vault_renamePasskey', { credentialId: selectedId, name: draftName });
      await refresh();
      setDraftName(null);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const add = async () => {
    if (busy) return;
    setBusy(true); setError(''); setAdded(false);
    try {
      const current = await rpcRead<PasskeyMetadata[]>('vault_listPasskeys');
      await authorizePasskeyDomain(PASSKEY_RP_ID);
      const metadata = current.find((credential) => credential.credentialId === selected) || current[0];
      const existing = await authenticatePasskey(metadata);
      try {
        const accounts = await rpc<SafeAccount[]>('vault_listAccounts');
        const activePubkey = await rpcRead<string>('vault_getActivePubkey');
        const account = accounts.find(a => a.pubkey === activePubkey && !a.readOnly && (a.type === 'generated' || a.type === 'nsec'));
        if (!account) throw new Error(t('passkey.localAccountRequired'));
        const passkey = await createPasskey(newName?.trim() || defaultPasskeyName(current.length), { rpId: PASSKEY_RP_ID, scope: account.type === 'generated' ? 'seed' : 'private-key', pubkey: account.pubkey, excludeCredentials: current });
        try {
          await rpc('vault_addPasskey', { existing, passkey });
          if (!passkey.largeBlobSupported) await rpc('vault_recordBlobUnavailable', { credentialId: passkey.credentialId });
          setSelected(passkey.credentialId);
          setDraftName(null);
          setSaveNewCredential(passkey.largeBlobSupported === true);
          setAdded(true);
          setNewName(null);
          await refresh();
        }
        finally { passkey.prf = ''; }
      } finally { existing.prf = ''; }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const selectedId = selected || credentials[0]?.credentialId;
  const metadata = credentials.find(p => p.credentialId === selectedId);
  const localAccount = !!account && !account.readOnly && (account.type === 'generated' || account.type === 'nsec');

  return <Container gap={6}>
    <Text variant="secondary">{t('passkey.multipleDesc')}</Text>
    <Card className="mb-0"><Container gap={5}>
      <SectionLabel>{t('passkey.registered')}</SectionLabel>
      <Container gap={3} role="group" aria-label={t('passkey.registered')}>
        {credentials.map((credential, index) => <Card key={credential.credentialId} variant="flat" className="group flex items-center gap-3 mb-0 p-4"><LinkButton className="flex-1" tone={credential.credentialId === selectedId ? 'brand' : 'muted'} aria-pressed={credential.credentialId === selectedId} disabled={busy || added} onClick={() => { setSelected(credential.credentialId); setDraftName(null); setError(''); }}>
          <Container gap={1} className="flex-1 min-w-0 text-left">
            <span className="break-words">{passkeyDisplayName(credential, index, t('passkey.title'))}</span>
            <Text as="span" variant="muted" className="break-all">{credential.rpId ?? LEGACY_PASSKEY_RP_ID}</Text>
          </Container>
        </LinkButton>
          {!locked && !added && <span className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 transition-opacity">
            <IconButton aria-label={`${t('passkey.name')}: ${passkeyDisplayName(credential, index, t('passkey.title'))}`} disabled={busy} onClick={() => { setSelected(credential.credentialId); setDraftName(credential.name ?? ''); setError(''); }}><IconPencil size={16} /></IconButton>
          </span>}
          {!locked && <RelayRecoverySave credentialId={credential.credentialId} iconOnly hasLocator={!!credential.recoveryPubkey && !!credential.rpId} canPublish={localAccount && credential.recoveryPubkey === account?.pubkey} />}
        </Card>)}
      </Container>
      {!metadata && <Text variant="secondary">{t('security.noRegisteredPasskey')}</Text>}
      {credentialsLoaded && !credentials.length && localAccount && !locked && autoLockMs !== null && <UnlockMethodSection setupOnly passkey={false} locked={locked} neverLock={autoLockMs === 0} onChanged={() => { void refresh().catch(error => setError((error as Error).message)); }} />}
      {metadata && localAccount && !locked && !added && <Button onClick={() => { setNewName(defaultPasskeyName(credentials.length)); setError(''); }} disabled={busy} small><IconPlus size={16} />{t(busy ? 'common.loading' : 'passkey.add')}</Button>}
    </Container></Card>
    {added ? <PasskeyRecoverySetup key={selectedId} credentialId={selectedId} blobSupported={saveNewCredential} onNext={() => { setAdded(false); setSaveNewCredential(false); }} /> : metadata && !locked && <Card className="mb-0"><Container gap={5}>
      <SectionLabel>{t('security.recovery')}<InfoTooltip text={t('passkey.recoverySnapshot')} /></SectionLabel>
      <Text variant="secondary">{t('passkey.accountRecovery')}</Text>
      <PasskeyBackupDownload compact />
    </Container></Card>}
    {newName !== null && createPortal(<Modal title={t('passkey.add')} onClose={() => { if (!busy) setNewName(null); }} footer={<Button disabled={busy} onClick={add}>{t(busy ? 'common.loading' : 'common.continue')}</Button>}>
      <Input small label={t('passkey.name')} placeholder={defaultPasskeyName(credentials.length)} value={newName} maxLength={PASSKEY_MAX_NAME_LENGTH} disabled={busy} onChange={event => setNewName(event.target.value)} />
      <FormError>{error}</FormError>
    </Modal>, document.body)}
    {metadata && draftName !== null && createPortal(<Modal title={t('passkey.name')} onClose={() => { if (!busy) setDraftName(null); }} footer={<Button disabled={busy} onClick={rename}>{t('common.save')}</Button>}>
      <Input small label={t('passkey.name')} placeholder={passkeyDisplayName({ ...metadata, name: undefined }, credentials.indexOf(metadata), t('passkey.title'))} value={draftName} maxLength={PASSKEY_MAX_NAME_LENGTH} disabled={busy} onChange={event => setDraftName(event.target.value)} />
      <FormError>{error}</FormError>
    </Modal>, document.body)}
    <FormError>{error}</FormError>
  </Container>;
}
