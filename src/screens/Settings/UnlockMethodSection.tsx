import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { rpc, rpcRead } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey } from '@services/vault/passkeyClient.ts';
import type { PasskeyMetadata } from '@domain/vault/passkey.ts';
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

export default function UnlockMethodSection({ passkey, locked, neverLock, onChanged }: { passkey: boolean; locked: boolean; neverLock: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
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
  const close = () => { if (!busy) { setOpen(false); setPassword(''); pair.reset(); setError(''); } };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!passkey && !await rpc<boolean>('vault_unlock', { password })) throw new Error(t('key.wrongPassword'));
      if (!live.current) return;
      const proof = await authenticatePasskey(credentials.find(c => c.credentialId === selected)!);
      try {
        if (!live.current) return;
        await rpc('vault_changeProtection', { currentPasskey: proof, currentPassword: password, password: pair.password, usePasskey: !passkey });
        if (live.current) { pair.reset(); setPassword(''); setOpen(false); onChanged(); }
      } finally { proof.prf = ''; }
    } catch (e) { if (live.current) setError((e as Error).message); }
    finally { if (live.current) setBusy(false); }
  };
  return <>
    <Container gap={3} className="mt-6 pt-6 border-t border-card-border">
      <Container variant="row" gap={4} className="justify-between">
        <Text>{t('security.usePasskey')}</Text>
        <Toggle checked={passkey} onChange={() => setOpen(true)} disabled={locked || !credentials.length} aria-label={t('security.usePasskey')} />
      </Container>
      <Text variant="hint">{t(credentials.length ? 'security.unlockMethodHint' : 'security.noRegisteredPasskey')}</Text>
    </Container>
    {open && createPortal(<Modal title={t('security.usePasskey')} onClose={close} dismissOnBackdrop={false}>
      <Container gap={6}>
        <Text variant="secondary">{t(passkey ? 'security.switchToPassword' : 'security.switchToPasskey')}</Text>
        {!passkey && !neverLock && <Input type="password" showToggle autoComplete="current-password" aria-label={t('security.currentPassword')} placeholder={t('security.currentPassword')} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />}
        <PasskeySelector credentials={credentials} value={selected} onChange={setSelected} disabled={busy} />
        {passkey && <PasswordPairFields passwordPlaceholder={t("wizard.minEightChars")} confirmPlaceholder={t('wizard.reEnterPw')} pair={pair} disabled={busy} onSubmit={submit} />}
        <FormError>{error}</FormError>
        <Button onClick={submit} disabled={busy || !credentials.length || (passkey ? !pair.ready : !neverLock && !password)}>{t(busy ? 'common.loading' : 'common.confirm')}</Button>
      </Container>
    </Modal>, document.body)}
  </>;
}
