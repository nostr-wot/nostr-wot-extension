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
import { Button } from '@components/Button';
import useTimedReveal from '@hooks/useTimedReveal.ts';
import { truncateMiddle } from '@utils/format/text.ts';

export const isMessageRequest = (type: string | null) => /^(nip04|nip44)(Encrypt|Decrypt)$/.test(type || '');

/** Pending message review never approves or returns plaintext to the requesting site. */
export default function MessageRequestDetail({request}:{request:{id?:string;type:string;theirPubkey?:string|null}}) {
  const [sender,setSender] = useState<string | null>(null);
  const message = useTimedReveal<{plaintext:string;decryptedEvent?:Record<string,unknown>} | null>(null,30_000);
  const decryptedEvent = message.value?.decryptedEvent;
  const peer = sender || request.theirPubkey;
  const [profileLoading,setProfileLoading] = useState(false);
  const [profile,setProfile] = useState<ProfileMetadata | null>(null);
  const plaintext = message.value?.plaintext ?? null;
  const [raw,setRaw] = useState<PendingRequestPreview['request'] | null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const generation = useRef({version:0});
  const decrypt = request.type.endsWith('Decrypt');
  useEffect(() => {
    let current = true;
    const lifetime = generation.current;
    setProfile(null);
    setProfileLoading(false);
    if (peer) void (async () => {
      const data = await browser.storage.local.get(`profile_${peer}`);
      if (!current) return;
      const cached = (data[`profile_${peer}`] as {metadata?:ProfileMetadata}|undefined)?.metadata;
      if (cached) { setProfile(cached); return; }
      // NIP-44 can name a temporary wrapping key. Reveal identifies its author.
      if (request.type === 'nip44Decrypt' && !sender) return;
      setProfileLoading(true);
      const metadata = await rpc<ProfileMetadata | null>('getProfileMetadata',{pubkey:peer,directory:true});
      if (current) setProfile(metadata);
    })().catch(() => {}).finally(() => { if (current) setProfileLoading(false); });
    return () => { current = false; lifetime.version++; };
  }, [request.id,request.type,peer,sender]);
  const clear = () => { generation.current.version++; message.clear(); setSender(null); setRaw(null); setError(''); setBusy(false); };
  useStorageWatch([{area:'local',keys:[LOCK_STATE_KEY,'activeAccountId']},{area:'session',keys:['signerPending']}],clear);
  async function load(reveal:boolean) {
    if (!request.id || busy) return;
    const current = ++generation.current.version;
    setBusy(true); setError('');
    try {
      const result = await rpc<PendingRequestPreview>('signer_previewRequest',{id:request.id,reveal});
      if (current !== generation.current.version) return;
      // Outgoing plaintext shares the timed preview lifetime, including Advanced.
      setRaw({...result.request,params:{...result.request.params,...('plaintext' in result.request.params ? {plaintext:null} : {})}});
      if (reveal) {
        message.reveal({plaintext:result.plaintext ?? '',decryptedEvent:result.decryptedEvent});
        setSender(result.senderPubkey || request.theirPubkey || null);
      }
    } catch (failure) { if (current === generation.current.version) setError(failure instanceof Error ? failure.message : t('common.error')); }
    finally { if (current === generation.current.version) setBusy(false); }
  }
  return <Container gap={4} className="min-w-0">
    <Text variant="secondary">{t(decrypt ? 'messageReview.sender' : 'event.recipient')}</Text>
    {profile && <ProfileSummary meta={{...profile,picture:undefined}} compact/>}
    {profileLoading && <Text variant="hint">{t('common.loading')}</Text>}
    {peer && !profile && <Text mono title={peer} className="text-xs break-all">{truncateMiddle(peer,16,12)}</Text>}
    <Text variant="secondary">{t('approval.detail.content')}</Text>
    <Button outline className="w-full" disabled={busy || !request.id}
      aria-label={t(plaintext === null ? 'key.clickToReveal' : 'key.clickToBlur')}
      aria-pressed={plaintext !== null}
      onClick={() => plaintext === null ? void load(true) : message.clear()}>
      <span className="relative block w-full min-w-0">
      <span aria-hidden={plaintext === null} className={`block w-full text-left font-normal whitespace-pre-wrap break-words max-h-48 overflow-y-auto ${plaintext === null ? 'blur-[6px] select-none min-h-16' : 'pb-7'}`}>
        {plaintext === null ? '•••••••• •••••••••••• ••••••••' : plaintext || t('activity.detail.emptyContent')}
      </span>
      {plaintext === null && <Text as="span" variant="muted" className="absolute inset-0 flex items-center justify-center text-center">{`${t(busy ? 'common.loading' : 'key.clickToReveal')} · ${t('key.autoHideHint')}`}</Text>}
        {plaintext !== null && <svg data-reveal-countdown aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" className="absolute bottom-0 right-0">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" pathLength="30" strokeDasharray={`${message.remainingSeconds} 30`} transform="rotate(-90 10 10)"/>
        </svg>}
      </span>
    </Button>
    <FormError>{error}</FormError>
    <DetailDisclosure label={t('common.advanced')} onOpenChange={open => {
      if (open) void load(false); else { generation.current.version++; setRaw(null); setBusy(false); }
    }}>
      {raw ? <TextBlock mono>{JSON.stringify({...raw,params:{...raw.params,...('plaintext' in raw.params ? {plaintext:plaintext ?? t('key.clickToReveal')} : {})},...(decryptedEvent ? {decryptedEvent} : {})},null,2)}</TextBlock> : busy ? <Text variant="hint">{t('common.loading')}</Text> : null}
    </DetailDisclosure>
  </Container>;
}
