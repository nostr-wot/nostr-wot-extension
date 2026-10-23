import { detectRecoveryBackup } from '@domain/vault/recoveryBackup.ts';
import { PASSKEY_MAX_BACKUP_BYTES } from '@constants/passkey.ts';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { DERIVED_PASSKEY_APPS } from '@constants/passkey.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { readNosskeyPasskey, readDerivedPasskey, clearDerivedPasskey, derivedPasskeySecretHex, type DerivedPasskeyCandidate } from '@services/vault/derivedPasskeyImport.ts';
import PasskeyStep from './PasskeyStep';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import Dropdown from '@components/Dropdown';
import Input from '@components/Input';
import Checkbox from '@components/Checkbox';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';

const CUSTOM = 'custom';
const NOSSKEY = 'nosskey';

interface PasskeyImportStepProps {
  initialBackup?: string;
  onRestore?: (account: SafeAccount) => void;
  onNext: (account: SafeAccount, upgradeId: string | null, host: string) => void;
}

/**
 * Import a key that another app derives from a passkey (derived mode). The browser
 * request starts only from the Continue click; the key is imported only after the user
 * has seen its npub and confirmed it. Secret bytes are zeroed on cancel, import or unmount.
 */
export default function PasskeyImportStep({ onNext, onRestore, initialBackup = '' }: PasskeyImportStepProps) {
  const [app, setApp] = useState<string>(DERIVED_PASSKEY_APPS[0]?.id ?? CUSTOM);
  const [host, setHost] = useState('');
  const [backup, setBackup] = useState('');
  const [vaultBackup, setVaultBackup] = useState('');
  const [source, setSource] = useState<'choice' | 'own' | 'other'>(onRestore ? 'choice' : 'other');
  const [candidate, setCandidate] = useState<DerivedPasskeyCandidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const fileVersion = useRef(0);
  const live = useRef(true);
  const held = useRef<DerivedPasskeyCandidate | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; fileVersion.current++; clearDerivedPasskey(held.current); held.current = null; };
  }, []);

  const preset = DERIVED_PASSKEY_APPS.find(item => item.id === app);
  const target = preset?.rpId ?? host;
  const appOptions = [...DERIVED_PASSKEY_APPS.map(item => ({ value: item.id, label: `${item.name} · ${item.rpId}` })), { value: CUSTOM, label: t('passkeyImport.custom') }];

  const discard = () => {
    clearDerivedPasskey(held.current);
    held.current = null;
    setCandidate(null);
    setConfirmed(false);
  };

  const choose = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const found = app === NOSSKEY ? await readNosskeyPasskey(host || 'nosskey.app', backup) : await readDerivedPasskey(target);
      if (!live.current) { clearDerivedPasskey(found); return; }
      held.current = found;
      setCandidate(found);
      setConfirmed(false);
    } catch (e) {
      if (live.current) setError((e as Error).message || t('common.error'));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };

  const importAccount = async () => {
    const current = held.current;
    if (pending.current || !current || !confirmed) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await rpc<{ account: SafeAccount; upgradeFromReadOnly?: string }>('onboarding_validateNsec', { input: derivedPasskeySecretHex(current) });
      if (result.account?.pubkey !== current.pubkey) throw new Error(t('wizard.importFailed'));
      const rpId = current.rpId;
      discard();
      if (live.current) onNext(result.account, result.upgradeFromReadOnly || null, rpId);
    } catch (e) {
      if (live.current) setError((e as Error).message || t('wizard.importFailed'));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };

  const detectBackup = (text: string) => {
    const kind = detectRecoveryBackup(text);
    if (!kind) throw new Error(t('passkeyImport.backupInvalid'));
    if (kind === 'vault') {
      if (!onRestore) throw new Error(t('recoveryFlow.existingVault'));
      setVaultBackup(text); setSource('own'); return;
    }
    setBackup(text); setApp(NOSSKEY); setSource('other');
  };
  useEffect(() => { if (initialBackup) { try { detectBackup(initialBackup); } catch (e) { setError((e as Error).message); } } }, [initialBackup]);
  const backupPicker = <Input label={t('passkeyImport.backupFile')} type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
    const file = event.target.files?.[0]; const version = ++fileVersion.current;
    if (!file) return;
    setError('');
    try {
      if (file.size > PASSKEY_MAX_BACKUP_BYTES) throw new Error(t('passkeyImport.backupInvalid'));
      const text = await file.text();
      if (live.current && version === fileVersion.current) detectBackup(text);
    } catch (e) { if (live.current && version === fileVersion.current) setError((e as Error).message || t('passkeyImport.backupInvalid')); }
  }} />;
  if (source === 'choice') return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t('recoveryFlow.intro')}</Text>
    <Button onClick={() => setSource('own')}>{t('passkey.usePasskey')}</Button>
    {backupPicker}
    <FormError>{error}</FormError>
    <LinkButton onClick={() => setSource('other')}>{t('recoveryFlow.otherApp')}</LinkButton>
  </Container>;
  if (source === 'own' && onRestore) return <Container gap={4} className="flex-1">
    <PasskeyStep restore initialBackup={vaultBackup} onBusyChange={setRestoring} onNext={onRestore} />
    <LinkButton disabled={restoring} onClick={() => setSource('choice')}>{t('common.back')}</LinkButton>
  </Container>;

  if (candidate) return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t(candidate.confidence === 'backup' ? 'passkeyImport.backupConfirm' : 'passkeyImport.confirmDesc', { host: candidate.rpId })}</Text>
    <Container gap={2}>
      <SectionLabel>{t('passkeyImport.npub')}</SectionLabel>
      <Text mono className="break-all text-brand">{candidate.npub}</Text>
    </Container>
    <label className="flex items-start gap-3 text-secondary"><Checkbox checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t('passkeyImport.confirmCheck')}</label>
    <FormError>{error}</FormError>
    <Container stickyFooter gap={3}>
      <Button onClick={importAccount} disabled={busy || !confirmed}>{t(busy ? 'wizard.importing' : 'passkeyImport.import')}</Button>
      <LinkButton disabled={busy} onClick={() => { discard(); setError(''); }}>{t('common.cancel')}</LinkButton>
    </Container>
  </Container>;

  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t('passkeyImport.intro')}</Text>
    {app !== NOSSKEY && <Container gap={2}>
      <SectionLabel htmlFor="passkey-import-app">{t('passkeyImport.app')}</SectionLabel>
      <Dropdown id="passkey-import-app" options={appOptions} value={app} disabled={busy} onChange={value => { setApp(value); fileVersion.current++; setBackup(''); setError(''); }} />
    </Container>}
    {app === NOSSKEY && <Input label={t('passkeyImport.host')} hint={t('passkeyImport.hostDesc')} placeholder="nosskey.app" value={host} disabled={busy} onChange={e => setHost(e.target.value)} />}
    {backupPicker}
    {!preset && app !== NOSSKEY && <>
      <Input id="passkey-import-host" label={t('passkeyImport.host')} hint={t('passkeyImport.hostDesc')} placeholder="example.com" value={host} disabled={busy} autoComplete="off" onChange={e => { setHost(e.target.value); setError(''); }} />

    </>}
    <Text variant="muted">{t('passkeyImport.permissionNote')}</Text>
    <FormError>{error}</FormError>
    <Container stickyFooter><Button onClick={choose} disabled={busy || (app === NOSSKEY ? !backup : !preset && !host.trim())}>{t(busy ? 'common.loading' : error ? 'common.retry' : 'passkeyImport.continue')}</Button></Container>
  </Container>;
}
