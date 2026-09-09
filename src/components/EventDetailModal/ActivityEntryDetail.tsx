import { truncateMiddle } from '@utils/format/text.ts';
import { useEffect, useRef, useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { LOCK_STATE_KEY } from '@domain/vault/constants.ts';
import { activityEncryption, activityEntryKey, type ActivityEntry } from '@domain/activity/activity.ts';
import { rpc } from '@services/rpc.ts';
import useStorageWatch from '@hooks/useStorageWatch';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import FormError from '@components/FormError/FormError';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import StatusDot from '@components/StatusDot/StatusDot';
import EventPreview from '@components/EventPreview/EventPreview';

/** Activity-only reveal controls; approval requests never gain a decrypt action. */
export default function ActivityEntryDetail({ entry, hideAccount = false, hidePeer = false }: { entry: ActivityEntry; hideAccount?: boolean; hidePeer?: boolean }) {
  const encrypted = activityEncryption(entry);
  const [peer, setPeer] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef({ version: 0 });
  const key = activityEntryKey(entry);
  useEffect(() => {
    const lifetime = generation.current;
    setPlaintext(null); setError(''); setPeer(''); setBusy(false);
    return () => { lifetime.version++; };
  }, [key]);
  useStorageWatch([{ area: 'local', keys: [LOCK_STATE_KEY] }], () => {
    generation.current.version++; setPlaintext(null); setError(''); setBusy(false);
  });

  async function decrypt() {
    if (!encrypted || busy || (!encrypted.peerPubkey && !/^[a-f0-9]{64}$/i.test(peer.trim()))) return;
    const current = ++generation.current.version;
    setBusy(true); setError('');
    try {
      const result = await rpc<{ plaintext: string }>('activity_decrypt', { entryKey: key, peerPubkey: peer.trim() });
      if (current === generation.current.version) setPlaintext(result.plaintext);
    } catch (err) {
      if (current === generation.current.version) setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      if (current === generation.current.version) setBusy(false);
    }
  }

  const decision = entry.decision === 'approved' || entry.decision === 'allow' ? 'allowed'
    : entry.decision === 'rejected' || entry.decision === 'deny' ? 'rejected'
      : entry.decision === 'blocked' ? 'blocked' : 'pending';
  const oldCrypto = /^(nip04|nip44)(Encrypt|Decrypt)$/.test(entry.method) && !encrypted;
  return <div className="flex flex-col gap-5 min-w-0">
    <div className="flex items-center justify-between gap-4 text-xs text-secondary">
      <time dateTime={new Date(entry.timestamp ?? 0).toISOString()}>{new Date(entry.timestamp ?? 0).toLocaleString()}</time>
      <span className="inline-flex items-center gap-3">{t(`activity.${decision}`)}<StatusDot status={entry.decision || ''} /></span>
    </div>
    {entry.pubkey && !hideAccount && <FieldDisplay label={t('activity.detail.account')} value={<span title={entry.pubkey}>{truncateMiddle(entry.pubkey)}</span>} mono />}
    {encrypted ? <div className="flex flex-col gap-5 rounded-md border border-card-border bg-page-solid p-6 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-md font-semibold text-heading">{t('activity.detail.encrypted')}</span>
        <span className="text-xs text-secondary font-mono">{encrypted.scheme.toUpperCase().replace('NIP', 'NIP-')}</span>
      </div>
      {encrypted.peerPubkey && !hidePeer && <FieldDisplay label={t('activity.detail.peer')} value={<span title={encrypted.peerPubkey}>{truncateMiddle(encrypted.peerPubkey)}</span>} mono />}
      {!encrypted.peerPubkey && <Input label={t('activity.detail.peer')} mono value={peer} onChange={e => setPeer(e.target.value)} disabled={busy} placeholder="64-character hex public key" />}
      {plaintext === null ? <Button small disabled={busy || (!encrypted.peerPubkey && !/^[a-f0-9]{64}$/i.test(peer.trim()))} onClick={() => void decrypt()}>
        {busy ? t('common.loading') : t('activity.detail.reveal')}
      </Button> : <div className="flex flex-col gap-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-heading">{t('activity.detail.decrypted')}</span>
          <Button small variant="secondary" onClick={() => setPlaintext(null)}>{t('common.hide')}</Button>
        </div>
        <pre className="m-0 text-md font-[inherit] leading-loose whitespace-pre-wrap break-all text-heading select-text">{plaintext || t('activity.detail.emptyContent')}</pre>
      </div>}
      <FormError>{error}</FormError>
      <details className="text-sm text-secondary">
        <summary className="cursor-pointer font-semibold py-2">{t('activity.detail.ciphertext')}</summary>
        <pre className="text-xs whitespace-pre-wrap break-all max-h-[180px] overflow-y-auto select-text">{encrypted.ciphertext}</pre>
      </details>
      {entry.event && <details className="text-sm text-secondary">
        <summary className="cursor-pointer font-semibold py-2">{t('approval.detail.moreDetails')}</summary>
        <pre className="text-xs whitespace-pre-wrap break-all max-h-[240px] overflow-y-auto select-text">{JSON.stringify(entry.event, null, 2)}</pre>
      </details>}
    </div> : <>
      <EventPreview type={entry.method} event={entry.event || null} theirPubkey={hidePeer ? undefined : entry.theirPubkey} compact />
      {oldCrypto && <p className="text-sm text-secondary leading-loose">{t('activity.detail.notSaved')}</p>}
    </>}
  </div>;
}
