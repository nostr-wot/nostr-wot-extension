import { useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { DERIVED_PARAMETER_SETS, DERIVED_PASSKEY_APPS, type DerivedParameterSet } from '@constants/passkey.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { readNosskeyPasskey, readDerivedPasskey, clearDerivedPasskey, derivedPasskeySecretHex, type DerivedPasskeyCandidate } from '@services/vault/derivedPasskeyImport.ts';
import IconWarning from '@assets/IconWarning.tsx';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import Dropdown from '@components/Dropdown';
import Input from '@components/Input';
import Checkbox from '@components/Checkbox';
import Container from '@components/Container';
import Text from '@components/Text';
import StatusNotice from '@components/StatusNotice';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';

const CUSTOM = 'custom';
const NOSSKEY = 'nosskey';

interface PasskeyImportStepProps {
  onNext: (account: SafeAccount, upgradeId: string | null, host: string) => void;
}

/**
 * Import a key that another app derives from a passkey (derived mode). The browser
 * request starts only from the Continue click; the key is imported only after the user
 * has seen its npub and confirmed it. Secret bytes are zeroed on cancel, import or unmount.
 */
export default function PasskeyImportStep({ onNext }: PasskeyImportStepProps) {
  const [app, setApp] = useState<string>(DERIVED_PASSKEY_APPS[0]?.id ?? CUSTOM);
  const [host, setHost] = useState('');
  const [backup, setBackup] = useState('');
  const [parameterSet, setParameterSet] = useState<DerivedParameterSet>(1);
  const [candidate, setCandidate] = useState<DerivedPasskeyCandidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const target = preset ? { host: preset.rpId, parameterSet: preset.parameterSet } : { host, parameterSet };
  const appOptions = [...DERIVED_PASSKEY_APPS.map(item => ({ value: item.id, label: `${item.name} · ${item.rpId}` })), { value: NOSSKEY, label: 'Nosskey' }, { value: CUSTOM, label: t('passkeyImport.custom') }];
  const setOptions = (Object.keys(DERIVED_PARAMETER_SETS).map(Number) as DerivedParameterSet[]).map(id => ({ value: String(id), label: `0x${id.toString(16).padStart(2, '0')} · ${DERIVED_PARAMETER_SETS[id].saltLabel}` }));

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
      const found = app === NOSSKEY ? await readNosskeyPasskey(host || 'nosskey.app', backup) : await readDerivedPasskey(target.host, target.parameterSet);
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

  if (candidate) return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t(candidate.confidence === 'backup' ? 'passkeyImport.backupConfirm' : 'passkeyImport.confirmDesc', { host: candidate.rpId })}</Text>
    <Container gap={2}>
      <SectionLabel>{t('passkeyImport.npub')}</SectionLabel>
      <Text mono className="break-all text-brand">{candidate.npub}</Text>
    </Container>
    {candidate.confidence === 'ambiguous' && <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t('passkeyImport.ambiguous')}</StatusNotice>}
    <label className="flex items-start gap-3 text-secondary"><Checkbox checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{t('passkeyImport.confirmCheck')}</label>
    <FormError>{error}</FormError>
    <Container stickyFooter gap={3}>
      <Button onClick={importAccount} disabled={busy || !confirmed}>{t(busy ? 'wizard.importing' : 'passkeyImport.import')}</Button>
      <LinkButton disabled={busy} onClick={() => { discard(); setError(''); }}>{t('common.cancel')}</LinkButton>
    </Container>
  </Container>;

  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t('passkeyImport.intro')}</Text>
    <Container gap={2}>
      <SectionLabel htmlFor="passkey-import-app">{t('passkeyImport.app')}</SectionLabel>
      <Dropdown id="passkey-import-app" options={appOptions} value={app} disabled={busy} onChange={value => { setApp(value); fileVersion.current++; setBackup(''); setError(''); }} />
    </Container>
    {app === NOSSKEY && <Container gap={2}><Text>{t('passkeyImport.backupNotice')}</Text><input aria-label={t('passkeyImport.backupFile')} type="file" accept="application/json,.json" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; const version = ++fileVersion.current; setBackup(''); if (!file) return; if (file.size > 8192) { setError(t('passkeyImport.backupInvalid')); return; } try { const text = await file.text(); if (live.current && version === fileVersion.current) setBackup(text); } catch { if (live.current) setError(t('passkeyImport.backupInvalid')); } }} /><Input label={t('passkeyImport.host')} placeholder="nosskey.app" value={host} disabled={busy} onChange={e => setHost(e.target.value)} /></Container>}
    {!preset && app !== NOSSKEY && <>
      <Input id="passkey-import-host" label={t('passkeyImport.host')} hint={t('passkeyImport.hostDesc')} placeholder="example.com" value={host} disabled={busy} autoComplete="off" onChange={e => { setHost(e.target.value); setError(''); }} />
      <Container gap={2}>
        <SectionLabel htmlFor="passkey-import-set">{t('passkeyImport.parameterSet')}</SectionLabel>
        <Dropdown id="passkey-import-set" options={setOptions} value={String(parameterSet)} disabled={busy} onChange={value => { setParameterSet(Number(value) as DerivedParameterSet); setError(''); }} />
      </Container>
    </>}
    <Text variant="muted">{t('passkeyImport.permissionNote')}</Text>
    <FormError>{error}</FormError>
    <Container stickyFooter><Button onClick={choose} disabled={busy || (app === NOSSKEY ? !backup : !preset && !host.trim())}>{t(busy ? 'common.loading' : error ? 'common.retry' : 'passkeyImport.continue')}</Button></Container>
  </Container>;
}
