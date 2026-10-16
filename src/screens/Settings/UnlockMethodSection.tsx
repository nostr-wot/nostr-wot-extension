import PasskeyRecoverySetup from '@components/PasskeyRecoverySetup';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { PASSKEY_RP_ID } from '@constants/passkey.ts';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { rpc, rpcRead } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey, createPasskey } from '@services/vault/passkeyClient.ts';
import { passkeyRecoveryAccount, type PasskeyMetadata } from '@domain/vault/passkey.ts';
import Toggle from '@components/Toggle';
import Modal from '@components/Modal';
import Container from '@components/Container';
import Button from '@components/Button';
import Input from '@components/Input';
import Text from '@components/Text';
import FormError from '@components/FormError';
import PasswordPairFields from '@components/PasswordPairFields';
import PasskeySelector from '@components/PasskeySelector';
import usePasswordPair from '@hooks/usePasswordPair';

export default function UnlockMethodSection({ passkey, locked, neverLock, onChanged, setupOnly = false }: { passkey: boolean; locked: boolean; neverLock: boolean; onChanged: () => void; setupOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [recovery, setRecovery] = useState<{ blobSupported: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>([]);
  const [selected, setSelected] = useState('');
  const pair = usePasswordPair();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void rpcRead<PasskeyMetadata[]>('vault_listPasskeys').then(value => {
      if (live.current) { setCredentials(value); setSelected(value[0]?.credentialId || ''); }
    }).catch(() => {});
    return () => { live.current = false; };
  }, []);
  const close = () => { if (!busy && !recovery) { setOpen(false); setPassword(''); pair.reset(); setError(''); } };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!passkey && !await rpc<boolean>('vault_unlock', { password })) throw new Error(t('key.wrongPassword'));
      if (!live.current) return;
      const enrolling = !passkey && !credentials.length;
      let account: SafeAccount | undefined;
      if (enrolling) {
        const accounts = await rpc<SafeAccount[]>('vault_listAccounts');
        const activePubkey = await rpcRead<string>('vault_getActivePubkey');
        account = passkeyRecoveryAccount(accounts, activePubkey);
      }
      if (!live.current) return;
      const proof = enrolling
        ? await createPasskey('', { rpId: PASSKEY_RP_ID, ...(account ? { scope: 'vault' as const, pubkey: account.pubkey } : {}) })
        : await authenticatePasskey(credentials.find(c => c.credentialId === selected)!);
      try {
        if (!live.current) return;
        await rpc('vault_changeProtection', { currentPasskey: proof, currentPassword: password, password: pair.password, usePasskey: !passkey, ...(enrolling ? { newPasskey: proof } : {}) });
        if (live.current) {
          pair.reset(); setPassword('');
          if (enrolling) setRecovery({ blobSupported: 'largeBlobSupported' in proof && proof.largeBlobSupported === true });
          else { setOpen(false); onChanged(); }
        }
      } finally { proof.prf = ''; }
    } catch (e) { if (live.current) setError((e as Error).message); }
    finally { if (live.current) setBusy(false); }
  };
  return <>
    {setupOnly ? <Button small variant="secondary" className="self-start" disabled={locked} onClick={() => setOpen(true)}>{t('security.setupPasskey')}</Button> : <Container gap={3} className="mt-6 pt-6 border-t border-card-border">
      <Container variant="row" gap={4} className="justify-between">
        <Text>{t('security.usePasskey')}</Text>
        <Toggle checked={passkey} onChange={() => setOpen(true)} disabled={locked || !credentials.length} aria-label={t('security.usePasskey')} />
      </Container>
      <Text variant="hint">{t(credentials.length ? 'security.unlockMethodHint' : 'security.noRegisteredPasskey')}</Text>
      {!passkey && !credentials.length && <Button small variant="secondary" className="self-start" disabled={locked} onClick={() => setOpen(true)}>{t('security.setupPasskey')}</Button>}
    </Container>}
    {open && createPortal(<Modal title={t('security.usePasskey')} onClose={close} dismissOnBackdrop={false}>
      {recovery ? <PasskeyRecoverySetup blobSupported={recovery.blobSupported} onNext={() => { setRecovery(null); setOpen(false); onChanged(); }} /> : <Container gap={6}>
        <Text variant="secondary">{t(passkey ? 'security.switchToPassword' : 'security.switchToPasskey')}</Text>
        {!passkey && !neverLock && <Input type="password" showToggle autoComplete="current-password" aria-label={t('security.currentPassword')} placeholder={t('security.currentPassword')} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />}
        {!!credentials.length && <PasskeySelector credentials={credentials} value={selected} onChange={setSelected} disabled={busy} />}
        {passkey && <PasswordPairFields passwordPlaceholder={t("wizard.minEightChars")} confirmPlaceholder={t('wizard.reEnterPw')} pair={pair} disabled={busy} onSubmit={submit} />}
        <FormError>{error}</FormError>
        <Button onClick={submit} disabled={busy || (passkey ? !pair.ready : !neverLock && !password)}>{t(busy ? 'common.loading' : 'common.confirm')}</Button>
      </Container>}
    </Modal>, document.body)}
  </>;
}
