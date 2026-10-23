import { clearPasskeyPrf } from '@services/vault/passkeyClient';
import { DEFAULT_AUTO_LOCK_MS } from '@constants/vault.ts';
import browser from '@lib/browser.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { parsePasskeyBackup, type PasskeyProof, type PasskeyMetadata } from '@domain/vault/passkey.ts';
import { PASSKEY_MAX_BACKUP_BYTES, PASSKEY_RP_ID, PASSKEY_PENDING_RECOVERY_KEY } from '@constants/passkey.ts';
import PasskeySelector from '@components/PasskeySelector';
import { createPasskey, authenticatePasskey, authorizePasskeyDomain } from '@services/vault/passkeyClient.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import Button from '@components/Button';
import Input from '@components/Input';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import { restorePasskeyRecovery, discoverPasskeyRecovery, RecoveryFileRequiredError } from '@services/vault/passkeyRecovery.ts';
import LinkButton from '@components/LinkButton';
import { npubEncode } from '@lib/crypto/bech32.ts';


export default function PasskeyStep({ restore = false, advanced = false, autoStart = false, initialBackup = '', onBusyChange, onNext }: { restore?: boolean; advanced?: boolean; autoStart?: boolean; initialBackup?: string; onBusyChange?: (busy: boolean) => void; onNext: (account: SafeAccount, blobSupported?: boolean) => void }) {
  const [rpId, setRpId] = useState(PASSKEY_RP_ID);
  const [discovered, setDiscovered] = useState<PublicKeyCredential | null>(null);
  useEffect(() => () => { if (discovered) clearPasskeyPrf(discovered); }, [discovered]);
  const [checked, setChecked] = useState(false);
  const started = useRef(false);
  const [useFile, setUseFile] = useState(!!initialBackup);
  const [backup, setBackup] = useState(initialBackup);
  const [credentials, setCredentials] = useState<PasskeyMetadata[]>(() => initialBackup ? parsePasskeyBackup(initialBackup).passkeys.map(p => ({ ...p, rpId: p.rpId ?? parsePasskeyBackup(initialBackup).rpId })) : []);
  const [selected, setSelected] = useState(() => initialBackup ? parsePasskeyBackup(initialBackup).passkeys[0].credentialId : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const pending = useRef(false);
  const [preview, setPreview] = useState<SafeAccount[] | null>(null);
  const staged = useRef<{ method: string; params: Record<string, unknown>; proof: PasskeyProof; blob: boolean } | null>(null);
  const live = useRef(true);
  const discard = () => { if (staged.current) staged.current.proof.prf = ''; staged.current = null; setPreview(null); };
  useEffect(() => { live.current = true; return () => { live.current = false; if (staged.current) staged.current.proof.prf = ''; staged.current = null; }; }, []);
  const confirmRecovery = async () => {
    const current = staged.current;
    if (!current || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await rpc<{ account: SafeAccount }>(current.method, current.params);
      // Status bookkeeping must not strand a successfully restored vault on this screen.
      try { await rpc(current.blob ? 'vault_recordBlobSaved' : 'vault_recordBlobUnavailable', { credentialId: current.proof.credentialId }); } catch { /* Recovery itself is already committed. */ }
      discard();
      if (live.current) onNext(result.account);
    } catch (e) { if (live.current) setError((e as Error).message || t('common.error')); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const submit = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!useFile) await authorizePasskeyDomain(rpId);
      if (advanced && !discovered && !useFile) {
        setChecked(true);
        setDiscovered(await discoverPasskeyRecovery(rpId));
        return;
      }
      if (restore || advanced) {
        const recovered = useFile ? null : await restorePasskeyRecovery(rpId, undefined, discovered ?? undefined);
        const metadata = credentials.find((credential) => credential.credentialId === selected) || credentials[0];
        if (useFile && metadata) await authorizePasskeyDomain(metadata.rpId ?? rpId);
        const credential = recovered?.proof || await authenticatePasskey(metadata);
        try {
          const relay = recovered && 'event' in recovered;
          const params = relay ? recovered : { backup: recovered?.backup || backup, ...credential };
          const result = await rpc<{ accounts: SafeAccount[] }>(relay ? 'vault_previewRelayRecovery' : 'vault_previewPasskeyBackup', params);
          if (!live.current) return;
          staged.current = { method: relay ? 'vault_restoreRelayRecovery' : 'vault_restorePasskeyBackup', params, proof: relay ? credential : params as unknown as PasskeyProof, blob: !!recovered && 'backup' in recovered };
          setPreview(result.accounts);
        } finally { if (staged.current?.proof !== credential) credential.prf = ''; }

      } else {
        const result = await rpc<{ account: SafeAccount }>('onboarding_generateAccount', { hideMnemonic: true });
        const account = result.account;
        const passkey = await createPasskey('', { rpId, scope: 'seed', pubkey: account.pubkey });
        try {
          await rpc('onboarding_createVault', { account, name: account.name, passkey, autoLockMinutes: DEFAULT_AUTO_LOCK_MS / 60_000 });
          if (!passkey.largeBlobSupported) {
            await rpc('vault_recordBlobUnavailable', { credentialId: passkey.credentialId });
            // Recovery failure must not leave an already-created vault on the creation screen.
            try {
              const event = await rpc<SignedEvent>('vault_prepareRelayRecovery', passkey);
              await browser.storage.session.set({ [PASSKEY_PENDING_RECOVERY_KEY]: { credentialId: passkey.credentialId, event, createdAt: Date.now() } });
            } catch { await browser.storage.session.remove(PASSKEY_PENDING_RECOVERY_KEY); }
          }
          onNext(account, passkey.largeBlobSupported === true);
        } finally { passkey.prf = ''; }
      }
    } catch (e) {
      if ((restore || advanced) && e instanceof RecoveryFileRequiredError) setUseFile(true);
      setError((e as Error).message || t('common.error'));
    }
    finally { pending.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (autoStart && !advanced && !started.current) {
      started.current = true;
      void submit();
    }
  });
  if (preview) return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t('recoveryFlow.confirm')}</Text>
    {preview.map(account => <Container key={account.id} gap={2}><Text>{account.name}</Text><Text mono className="break-all text-brand">{npubEncode(account.pubkey)}</Text></Container>)}
    <FormError>{error}</FormError>
    <Button disabled={busy} onClick={confirmRecovery}>{t(busy ? 'common.loading' : 'passkey.restore')}</Button>
    <LinkButton disabled={busy} onClick={discard}>{t('common.cancel')}</LinkButton>
  </Container>;
  return <Container gap={6} className="flex-1">
    <Text variant="secondary">{t(restore ? 'passkey.restoreDesc' : 'passkey.explanation')}</Text>
    {(restore || advanced) && useFile && <><SectionLabel htmlFor="passkey-file">{t('passkey.backup')}</SectionLabel><Input id="passkey-file" type="file" accept=".json,application/json" disabled={busy} onChange={async (e) => {
      setError(''); setBackup(''); setCredentials([]); setSelected('');
      const file = e.target.files?.[0];
      if (!file) return;
      try { if (file.size > PASSKEY_MAX_BACKUP_BYTES) throw new Error(t('passkey.invalidBackup')); const text = await file.text(); const record = parsePasskeyBackup(text); setCredentials(record.passkeys.map(p => ({ ...p, rpId: p.rpId ?? record.rpId }))); setSelected(record.passkeys[0].credentialId); setBackup(text); } catch (error) { setError((error as Error).message); }
    }} /></>}
    {(restore || advanced) && useFile && <PasskeySelector credentials={credentials} value={selected} onChange={setSelected} disabled={busy} />}
    {!useFile && !busy && (restore || advanced) && <LinkButton onClick={() => { setUseFile(true); setDiscovered(null); setError(''); }}>{t('passkey.useFile')}</LinkButton>}
    {useFile && <LinkButton disabled={busy} onClick={() => { setUseFile(false); setDiscovered(null); setError(''); }}>{t('passkey.usePasskey')}</LinkButton>}
    {!useFile && (advanced || restore) && <details><summary className="text-secondary cursor-pointer">{t('recoveryFlow.advanced')}</summary><SectionLabel htmlFor="recovery-domain">{t('passkey.domain')}</SectionLabel><Input id="recovery-domain" value={rpId} disabled={busy || !!discovered} onChange={event => { setRpId(event.target.value); setChecked(false); setError(''); }} /><Text variant="muted">{t('passkey.domainDesc')}</Text></details>}
    {advanced && discovered && !useFile && <Text variant="secondary">{t('passkey.existingFound')}</Text>}
    {advanced && checked && !discovered && !useFile && !busy && <><Text variant="muted">{t('passkey.discoveryUnavailable')}</Text></>}
    {advanced && discovered && <LinkButton disabled={busy} onClick={() => { setDiscovered(null); setUseFile(false); setChecked(false); setError(''); }}>{t('common.cancel')}</LinkButton>}
    <FormError>{error}</FormError>
    <Container stickyFooter><Button onClick={() => submit()} disabled={busy || ((restore || advanced) && useFile && !backup)}>{t(busy ? 'common.loading' : error ? 'common.retry' : discovered || restore ? 'passkey.restore' : advanced ? 'passkey.checkExisting' : 'passkey.create')}</Button></Container>
  </Container>;
}
