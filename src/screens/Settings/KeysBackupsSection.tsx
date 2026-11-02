import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '@context/AccountContext';
import { useVault } from '@context/VaultContext';
import { rpcRead } from '@services/rpc';
import { t } from '@services/i18n/i18n';
import type { PasskeyMetadata } from '@domain/vault/passkey';
import { passkeyDisplayName } from '@domain/vault/passkey';
import Container from '@components/Container';
import ListRow from '@components/ListRow';
import Button from '@components/Button';
import Text from '@components/Text';
import FormError from '@components/FormError';
import IconKey from '@assets/IconKey';
import KeyActionModal from '@screens/Vault/KeyActionModal';
import UnlockSection from '@screens/Prompt/UnlockSection';
import PasskeySection from './PasskeySection';

interface BackupKey { accountId: string; pubkey: string; name: string; type: 'seed' | 'private-key'; accountCount: number; accountIds: string[]; }

/** Public inventory only. Secret reveal/export remains in the shared vault dialogs. */
export default function KeysBackupsSection() {
  const { accounts, active, activeId, switchAccount } = useAccount();
  const vault = useVault();
  const [keys, setKeys] = useState<BackupKey[]>([]);
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [detail, setDetail] = useState<{ accountId: string; seed: boolean; credentialId?: string } | null>(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    if (vault.locked) { setKeys([]); setCredentials([]); setDetail(null); setAction(''); return; }
    setLoading(true);
    void Promise.all([rpcRead<BackupKey[]>('vault_listBackupKeys'), rpcRead<PasskeyMetadata[]>('vault_listPasskeys')])
      .then(([keys, credentials]) => { if (current) { setKeys(keys); setCredentials(credentials); } })
      .catch(e => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [vault.locked, activeId]);
  const open = async (accountId: string, seed: boolean, credentialId?: string) => {
    setBusy(true); setError('');
    try { if (accountId !== activeId) await switchAccount(accountId); setDetail({ accountId, seed, credentialId }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (vault.locked) return <UnlockSection onUnlocked={() => void vault.checkState()} />;
  const selected = detail && detail.accountId === activeId ? detail : null;
  return <Container gap={5}>
    {selected ? <>
      <Button small variant="secondary" onClick={() => { setDetail(null); setAction(''); }}>{t('common.back')}</Button>
      <Text>{active?.name}</Text>
      <ListRow variant="standalone" leading={<IconKey />} title={t(selected.seed ? 'key.exportSeed' : 'key.exportNsec')} onClick={() => setAction(selected.seed ? 'seed' : 'nsec')} />
      <ListRow variant="standalone" leading={<IconKey />} title={t('key.exportNcryptsec')} subtitle={t('key.exportNcryptsecDesc')} onClick={() => setAction('ncryptsec')} />
      {selected.seed && <ListRow variant="standalone" leading={<IconKey />} title={t('key.exportNsec')} subtitle={t('key.exportNsecDesc')} onClick={() => setAction('nsec')} />}
      {selected.seed && keys.find(key => key.accountIds.includes(selected.accountId))?.accountIds.filter(id => id !== selected.accountId).map(id => {
        const child = accounts?.find(account => account.id === id);
        return child && <ListRow key={id} variant="standalone" leading={<IconKey />} title={`${child.name} · ${t('security.privateKey')}`} onClick={() => { if (!busy) void open(id, false); }} />;
      })}
      <PasskeySection key={`${activeId}:${selected.credentialId || ''}`} locked={vault.locked} account={active} initialCredentialId={selected.credentialId} />
    </> : <>
      <Text variant="secondary">{t('security.keysBackupsHint')}</Text>
      {loading && <Text variant="hint">{t('common.loading')}</Text>}
      {keys.map(key => <ListRow key={key.accountId} variant="standalone" leading={<IconKey />} title={`${key.name} · ${t(key.type === 'seed' ? 'security.seedPhrase' : 'security.privateKey')}`} subtitle={`${key.pubkey.slice(0, 12)}…${key.pubkey.slice(-8)}`} onClick={() => { if (!busy) void open(key.accountId, key.type === 'seed'); }} />)}
      {credentials.map((credential, index) => {
        const account = credential.recoveryPubkey
          ? accounts?.find(a => a.pubkey === credential.recoveryPubkey)
          : accounts?.find(a => a.id === activeId && !a.readOnly) ?? accounts?.find(a => !a.readOnly);
        return <ListRow key={credential.credentialId} variant="standalone" leading={<IconKey />} title={passkeyDisplayName(credential, index, t('passkey.title'))} subtitle={credential.rpId} onClick={() => {
          if (busy) return;
          if (!account) { setError(t('passkey.localAccountRequired')); return; }
          void open(account.id, account.type === 'generated', credential.credentialId);
        }} />;
      })}
    </>}
    <FormError>{error}</FormError>
    {selected && action && createPortal(<KeyActionModal key={`${activeId}:${action}`} action={action} onClose={() => setAction('')} />, document.body)}
  </Container>;
}
