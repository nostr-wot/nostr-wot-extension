import { useEffect, useRef, useState } from 'react';
import type { PendingRequestPreview } from '@domain/signing/types.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { LOCK_STATE_KEY } from '@constants/vault.ts';
import useStorageWatch from '@hooks/useStorageWatch';
import Container from '@components/Container';
import Text from '@components/Text';
import TextBlock from '@components/TextBlock';
import ProfileSummary from '@components/ProfileSummary';
import DetailDisclosure from '@components/DetailDisclosure';
import FormError from '@components/FormError';
import { ButtonSecondary } from '@components/Button';
import { truncateMiddle } from '@utils/format/text.ts';

export const isMessageRequest = (type: string | null) => /^(nip04|nip44)(Encrypt|Decrypt)$/.test(type || '');

/** Pending message review never approves or returns plaintext to the requesting site. */
export default function MessageRequestDetail({request}:{request:{id?:string;type:string;theirPubkey?:string|null}}) {
  const [sender,setSender] = useState<string | null>(null);
  const [decryptedEvent,setDecryptedEvent] = useState<Record<string,unknown> | null>(null);
  const peer = sender || request.theirPubkey;
  const [profile,setProfile] = useState<ProfileMetadata | null>(null);
  const [plaintext,setPlaintext] = useState<string | null>(null);
  const [raw,setRaw] = useState<PendingRequestPreview['request'] | null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const generation = useRef({version:0});
  const decrypt = request.type.endsWith('Decrypt');
  useEffect(() => {
    let current = true;
    const lifetime = generation.current;
    setProfile(null);
    if (peer) void browser.storage.local.get(`profile_${peer}`).then(data => {
      if (current) setProfile((data[`profile_${peer}`] as {metadata?:ProfileMetadata}|undefined)?.metadata || null);
    }).catch(() => {});
    return () => { current = false; lifetime.version++; };
  }, [request.id,peer]);
  const clear = () => { generation.current.version++; setPlaintext(null); setSender(null); setDecryptedEvent(null); setRaw(null); setError(''); setBusy(false); };
  useStorageWatch([{area:'local',keys:[LOCK_STATE_KEY,'activeAccountId']},{area:'session',keys:['signerPending']}],clear);
  async function load(reveal:boolean) {
    if (!request.id || busy) return;
    const current = ++generation.current.version;
    setBusy(true); setError('');
    try {
      const result = await rpc<PendingRequestPreview>('signer_previewRequest',{id:request.id,reveal});
      if (current !== generation.current.version) return;
      setRaw(result.request);
      if (reveal) {
        setPlaintext(result.plaintext ?? '');
        setSender(result.senderPubkey || null);
        setDecryptedEvent(result.decryptedEvent || null);
      }
    } catch (failure) { if (current === generation.current.version) setError(failure instanceof Error ? failure.message : t('common.error')); }
    finally { if (current === generation.current.version) setBusy(false); }
  }
  return <Container gap={4} className="min-w-0">
    <Text variant="secondary">{t(decrypt ? 'messageReview.sender' : 'event.recipient')}</Text>
    {profile && <ProfileSummary meta={{...profile,picture:undefined}} compact/>}
    {!profile && <Text variant="hint">{t('messageReview.noCachedProfile')}</Text>}
    {peer && <Text mono title={peer} className="text-xs break-all">{truncateMiddle(peer,16,12)}</Text>}
    {plaintext === null ? <ButtonSecondary small className="self-start" disabled={busy || !request.id} onClick={() => void load(true)}>
      {t(busy ? 'common.loading' : 'activity.detail.reveal')}
    </ButtonSecondary> : <Container gap={3}>
      <TextBlock>{plaintext || t('activity.detail.emptyContent')}</TextBlock>
      <ButtonSecondary small className="self-start" onClick={() => setPlaintext(null)}>{t('common.hide')}</ButtonSecondary>
    </Container>}
    <FormError>{error}</FormError>
    <DetailDisclosure label={t('common.advanced')} onOpenChange={open => {
      if (open) void load(false); else { generation.current.version++; setRaw(null); setBusy(false); }
    }}>
      {raw ? <TextBlock mono>{JSON.stringify({...raw,...(decryptedEvent ? {decryptedEvent} : {})},null,2)}</TextBlock> : busy ? <Text variant="hint">{t('common.loading')}</Text> : null}
    </DetailDisclosure>
  </Container>;
}
