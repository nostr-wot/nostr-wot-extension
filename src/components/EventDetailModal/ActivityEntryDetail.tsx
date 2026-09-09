import { truncateMiddle } from '@utils/format/text.ts';
import { useEffect, useRef, useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { LOCK_STATE_KEY } from '@constants/vault.ts';
import { activityEncryption, activityEntryKey, type ActivityEntry } from '@domain/activity/activity.ts';
import { rpc } from '@services/rpc.ts';
import useStorageWatch from '@hooks/useStorageWatch';
import Button, { ButtonSecondary } from '@components/Button';
import Input from '@components/Input';
import FormError from '@components/FormError';
import FieldDisplay from '@components/FieldDisplay';
import StatusDot from '@components/StatusDot';
import Container from '@components/Container';
import Heading from '@components/Heading';
import Text from '@components/Text';
import TextBlock from '@components/TextBlock';
import DetailDisclosure from '@components/DetailDisclosure';
import EventPreview from '@components/EventPreview';

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
  return <Container gap={5} className="min-w-0">
    <Container variant="row" gap={4} className="justify-between text-xs text-secondary">
      <time dateTime={new Date(entry.timestamp ?? 0).toISOString()}>{new Date(entry.timestamp ?? 0).toLocaleString()}</time>
      <Container as="span" variant="row" gap={3}>{t(`activity.${decision}`)}<StatusDot status={entry.decision || ''} /></Container>
    </Container>
    {entry.pubkey && !hideAccount && <FieldDisplay label={t('activity.detail.account')} value={<Text as="span" mono className="text-xs text-heading" title={entry.pubkey}>{truncateMiddle(entry.pubkey)}</Text>} mono />}
    {encrypted ? <Container variant="box" gap={5} className="min-w-0">
      <Container variant="row" gap={3} className="justify-between">
        <Heading level={5} className="m-0">{t('activity.detail.encrypted')}</Heading>
        <Text as="span" variant="secondary" mono className="text-xs">{encrypted.scheme.toUpperCase().replace('NIP', 'NIP-')}</Text>
      </Container>
      {encrypted.peerPubkey && !hidePeer && <FieldDisplay label={t('activity.detail.peer')} value={<Text as="span" mono className="text-xs text-heading" title={encrypted.peerPubkey}>{truncateMiddle(encrypted.peerPubkey)}</Text>} mono />}
      {!encrypted.peerPubkey && <Input label={t('activity.detail.peer')} mono value={peer} onChange={e => setPeer(e.target.value)} disabled={busy} placeholder="64-character hex public key" />}
      {plaintext === null ? <Button small disabled={busy || (!encrypted.peerPubkey && !/^[a-f0-9]{64}$/i.test(peer.trim()))} onClick={() => void decrypt()}>
        {busy ? t('common.loading') : t('activity.detail.reveal')}
      </Button> : <Container gap={4} aria-live="polite">
        <Container variant="row" gap={3} className="justify-between">
          <Heading level={5} as="h6" className="m-0 text-sm">{t('activity.detail.decrypted')}</Heading>
          <ButtonSecondary small onClick={() => setPlaintext(null)}>{t('common.hide')}</ButtonSecondary>
        </Container>
        <TextBlock>{plaintext || t('activity.detail.emptyContent')}</TextBlock>
      </Container>}
      <FormError>{error}</FormError>
      <DetailDisclosure label={t('activity.detail.ciphertext')} content={encrypted.ciphertext} maxHeight={180} />
      {entry.event && <DetailDisclosure label={t('approval.detail.moreDetails')} content={JSON.stringify(entry.event, null, 2)} />}
    </Container> : <>
      <EventPreview type={entry.method} event={entry.event || null} theirPubkey={hidePeer ? undefined : entry.theirPubkey} compact />
      {oldCrypto && <Text variant="secondary" className="text-sm leading-loose">{t('activity.detail.notSaved')}</Text>}
    </>}
  </Container>;
}
