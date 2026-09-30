import SenderProfile from './SenderProfile';
import { useEffect, useState, type ReactNode } from 'react';
import type { PendingRequestPreview } from '@domain/signing/types';
import { rpc } from '@services/rpc';
import { t, getLanguage } from '@services/i18n/i18n';
import useStorageWatch from '@hooks/useStorageWatch';
import { LOCK_STATE_KEY } from '@constants/vault';

type Message = {id?:string;type:string;theirPubkey?:string|null};
type Metadata = NonNullable<PendingRequestPreview['messageMetadata']>;

/** Only sender/date enter this list; plaintext stays behind each timed reveal. */
export default function GroupedMessageRequests<T extends Message>({requests,renderRequest}:{requests:T[];renderRequest:(request:T,label:ReactNode)=>ReactNode}) {
 const [metadata,setMetadata]=useState<Record<string,Metadata>>({});
 const [generation,setGeneration]=useState(0);
 useStorageWatch([{area:'local',keys:[LOCK_STATE_KEY,'activeAccountId']}],()=>{setMetadata({});setGeneration(n=>n+1);});
 const ids=requests.map(item=>item.id).join(',');
 useEffect(()=>{
  let current=true;
  setMetadata({});
  void (async()=>{
   for(const request of requests) {
    if(!current) return;
    if(!request.id) continue;
    try {
     const result=await rpc<PendingRequestPreview>('signer_previewRequest',{id:request.id,reveal:false,metadataOnly:true});
     if(current && result.messageMetadata) setMetadata(previous=>({...previous,[request.id!]:result.messageMetadata!}));
    } catch { /* Pending, locked or remote requests keep the public-key fallback. */ }
   }
  })();
  return ()=>{current=false;};
  // IDs identify immutable pending requests; replacing the array is not a new request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[ids,generation]);
 const groups=new Map<string,T[]>();
 for(const request of requests) {
  const sender=metadata[request.id || '']?.senderPubkey || request.theirPubkey || request.id || '';
  groups.set(sender,[...(groups.get(sender)||[]),request]);
 }
 return <div className="flex flex-col gap-5">{[...groups].map(([sender,messages])=><section key={sender} className="flex flex-col gap-3">
  <SenderProfile pubkey={sender} lookup={messages.some(item=>item.type!=='nip44Decrypt' || !!metadata[item.id || '']?.senderPubkey)}/>
  {messages.map(request=>{
   const sentAt=metadata[request.id || '']?.sentAt;
   return renderRequest(request,sentAt ? <time dateTime={new Date(sentAt*1000).toISOString()}>{new Date(sentAt*1000).toLocaleString(getLanguage())}</time> : t('messageReview.dateUnavailable'));
  })}
 </section>)}</div>;
}