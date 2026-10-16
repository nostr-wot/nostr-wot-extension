import { createPortal } from 'react-dom';
import Modal from '@components/Modal';
import IconButton from '@components/IconButton';
import IconCloud from '@assets/IconCloud';
import IconSync from '@assets/IconSync';
import IconPlus from '@assets/IconPlus';
import Input from '@components/Input';
import { recoveryContextFromEvent } from '@services/vault/recoveryCodec.ts';
import { useCallback, useEffect, useRef, useState, useId } from 'react';
import { rpc, rpcRead } from '@services/rpc.ts';
import browser from '@lib/browser.ts';
import { t } from '@services/i18n/i18n.ts';
import { authenticatePasskey } from '@services/vault/passkeyClient.ts';
import type { PasskeyRecoveryStatus, RelayRecoveryHealth, PasskeyMetadata } from '@domain/vault/passkey.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import Button from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { PASSKEY_RP_ID, PASSKEY_PENDING_RECOVERY_KEY, PASSKEY_PENDING_RECOVERY_TTL_MS } from '@constants/passkey.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';

export default function RelayRecoverySave({ credentialId, onSaved, usePrepared = false, iconOnly = false, hasLocator = true, canPublish = true }: { hasLocator?: boolean; canPublish?: boolean; iconOnly?: boolean; credentialId?: string; onSaved?: () => void; usePrepared?: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState('');
  const [health, setHealth] = useState<RelayRecoveryHealth[]>([]);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<PasskeyRecoveryStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [relay, setRelay] = useState('');
  const suggestions = useId();
  const generation = useRef({ version: 0 });
  const check = useCallback(async () => {
    if (!credentialId) return;
    const run = ++generation.current.version;
    setChecking(true);
    try {
      const [results, stored] = await Promise.all([hasLocator ? rpcRead<typeof health>('vault_checkRelayRecovery', { credentialId }) : Promise.resolve([]), rpcRead<PasskeyRecoveryStatus>('vault_getRecoveryStatus', { credentialId })]);
      if (generation.current.version === run) { setHealth(results); setStatus(stored); }
    } catch (e) { if (generation.current.version === run) setError((e as Error).message); }
    finally { if (generation.current.version === run) setChecking(false); }
  }, [credentialId, hasLocator]);
  useEffect(() => {
    const tracker = generation.current;
    if (!usePrepared) void check();
    return () => { tracker.version++; };
  }, [check, usePrepared]);
  async function save() {
    if (busy || !hasLocator || !canPublish) return; setBusy(true); setError('');
    try {
      const credentials = await rpc<PasskeyMetadata[]>('vault_listPasskeys');
      const metadata = credentials.find(p => p.credentialId === credentialId) ?? credentials[0];
      if (!metadata?.recoveryPubkey) throw new Error(t('passkey.newEnrollmentRequired'));
      const pending = usePrepared ? (await browser.storage.session.get(PASSKEY_PENDING_RECOVERY_KEY))[PASSKEY_PENDING_RECOVERY_KEY] as { credentialId: string; event: SignedEvent; createdAt: number } | undefined : undefined;
      let event: SignedEvent;
      if (pending?.credentialId === metadata.credentialId && Date.now() - pending.createdAt < PASSKEY_PENDING_RECOVERY_TTL_MS) event = pending.event;
      else {
        const proof = await authenticatePasskey(metadata);
        try { event = await rpc<SignedEvent>('vault_prepareRelayRecovery', proof); }
        finally { proof.prf = ''; }
      }
      const results = await rpc<{ accepted: boolean }[]>('vault_publishRelayRecovery', { event, context: { credentialId: metadata.credentialId, rpId: metadata.rpId ?? PASSKEY_RP_ID, pubkey: metadata.recoveryPubkey, scope: recoveryContextFromEvent(event, { credentialId: metadata.credentialId, rpId: metadata.rpId ?? PASSKEY_RP_ID, pubkey: metadata.recoveryPubkey }).scope } });
      await browser.storage.session.remove(PASSKEY_PENDING_RECOVERY_KEY);
      setSaved(`${results.filter(r => r.accepted).length}/${results.length}`); onSaved?.(); void check();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const tone = health.some(item => item.status === 'found') ? 'success' : status?.blobSaved !== false || checking ? 'muted' : 'warning';
  const description = t(tone === 'success' ? 'passkey.relaySynced' : tone === 'warning' ? 'passkey.relayManualOnly' : status?.blobSaved ? 'passkey.relayOptional' : 'passkey.relayUnknown');
  const content = <Container gap={3}>
    <Text variant="secondary">{t('passkey.relayRecoveryDesc')}</Text>
    {credentialId && hasLocator && !usePrepared && <>
      <Container variant="row" className="justify-between" gap={3}>
        <Text variant="muted" role="status">{checking ? t('common.loading') : `${health.filter(item => item.status === 'found').length}/${health.length || status?.relays?.length || DEFAULT_RELAYS.length} · ${t('passkey.relayCopies')}`}</Text>
        <Container variant="row" gap={2}>
          <IconButton aria-label={t('common.refresh')} disabled={checking || busy} onClick={() => { setError(''); void check(); }}><IconSync size={18} /></IconButton>
          <IconButton aria-label={t('passkey.addRelay')} disabled={busy} onClick={() => setAdding(!adding)}><IconPlus size={18} /></IconButton>
        </Container>
      </Container>
      {adding && <Container gap={3}>
        <Input label={t('passkey.addRelay')} list={suggestions} value={relay} onChange={event => setRelay(event.target.value)} placeholder="wss://" />
        <datalist id={suggestions}>{DEFAULT_RELAYS.filter(url => !status?.relays?.includes(new URL(url).toString())).map(url => <option key={url} value={url} />)}</datalist>
        <Button small disabled={busy || !relay.trim()} onClick={async () => {
          setBusy(true); setError('');
          try { await rpc('vault_addRecoveryRelay', { credentialId, relay }); setRelay(''); setAdding(false); await check(); }
          catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        }}>{t('common.add')}</Button>
      </Container>}
      {health.map(item => <Container key={item.relay} gap={1} className="py-3 border-b border-card-border">
        <Container variant="row" gap={3} className="justify-between">
          <Text variant="muted">{new URL(item.relay).hostname}</Text>
          <Text variant="muted" className={item.status === 'found' ? 'text-success' : item.status === 'missing' ? 'text-warning' : 'text-error'}>{t(`passkey.relayStatus.${item.status}`)}</Text>
        </Container>
        {status?.accepted?.[item.relay] && <Text variant="muted">{t('passkey.relayAccepted')} {new Date(status.accepted[item.relay].acceptedAt).toLocaleString()}</Text>}
        {item.createdAt && <Text variant="muted">{t('passkey.snapshotDate')} {new Date(item.createdAt * 1000).toLocaleString()}</Text>}
      </Container>)}
      {!!health.length && <Text variant="muted">{t('passkey.lastChecked')} {new Date(Math.max(...health.map(item => item.checkedAt))).toLocaleTimeString()}</Text>}
    </>}
    {(!credentialId || usePrepared) && <Text variant="muted">{DEFAULT_RELAYS.map(url => new URL(url).hostname).join(', ')}</Text>}
    {!hasLocator && <Text variant="muted">{t('passkey.newEnrollmentRequired')}</Text>}
    {hasLocator && !canPublish && <Text variant="muted">{t('passkey.selectRecoveryAccount')}</Text>}
    <Button variant="secondary" onClick={save} disabled={busy || !hasLocator || !canPublish}>{t(busy ? 'common.loading' : 'passkey.saveToRelays')}</Button>
    {saved && <Text role="status">{t('passkey.relaySaved')} ({saved})</Text>}<FormError>{error}</FormError>
  </Container>;
  if (!iconOnly) return content;
  return <>
    <IconButton tone={tone} aria-label={t('passkey.relayRecovery')} title={description} onClick={() => setOpen(true)}><IconCloud size={18} /></IconButton>
    {open && createPortal(<Modal title={t('passkey.relayRecovery')} onClose={() => { if (!busy) setOpen(false); }}><Text variant="muted">{description}</Text>{content}</Modal>, document.body)}
  </>;
}
