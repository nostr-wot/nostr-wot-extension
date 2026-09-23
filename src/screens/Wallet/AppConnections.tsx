import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import OverlayPanel from '@components/OverlayPanel';
import Card from '@components/Card';
import Button, { ButtonDanger } from '@components/Button';
import Input from '@components/Input';
import FormError from '@components/FormError';
import CopyButton from '@components/CopyButton';
import QrCode from '@components/QrCode';
import ConfirmDialog from '@components/ConfirmDialog';
import { SectionHint } from '@components/SectionLabel';
import { validateConnectionDraft, type AppConnection } from '@domain/wallet/app-connections.ts';

export default function AppConnections({accountId,onClose}:{accountId:string;onClose:()=>void}) {
 const [connections,setConnections]=useState<AppConnection[]>([]);
 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [creating,setCreating]=useState(false),[name,setName]=useState(''),[limit,setLimit]=useState('1000'),[days,setDays]=useState('30');
 const [pairing,setPairing]=useState(''),[revoke,setRevoke]=useState<AppConnection|null>(null);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const refresh=useCallback(async()=>{
   setBusy(true);setError('');
   try {const result=await rpc<{connections:AppConnection[]}>('wallet_listAppConnections',{accountId});if(alive.current){setConnections(result.connections);setLoaded(true);}}
   catch {if(alive.current) setError(t('wallet.appsUnavailable'));}
   finally {if(alive.current)setBusy(false);}
 },[accountId]);
 useEffect(()=>{void refresh();},[refresh]);
 const draft={name,dailyLimit:Number(limit),days:Number(days)};
 let valid=true;try{validateConnectionDraft(draft);}catch{valid=false;}
 const create=async()=>{
   if(busy||!valid)return;
   setBusy(true);setError('');
   try {const result=await rpc<{uri:string}>('wallet_createAppConnection',{accountId,...draft,requestId:crypto.randomUUID()});if(alive.current){setCreating(false);setPairing(result.uri);setName('');await refresh();}}
   catch {if(alive.current)setError(t('wallet.appsCreateFailed'));}
   finally {if(alive.current)setBusy(false);}
 };
 const reveal=async(pubkey:string)=>{
   setBusy(true);setError('');
   try {const uri=await rpc<string>('wallet_copyAppConnection',{accountId,pubkey});if(alive.current)setPairing(uri);}
   catch {if(alive.current)setError(t('wallet.appsReadFailed'));}
   finally {if(alive.current)setBusy(false);}
 };
 const remove=async()=>{
   if(!revoke||busy)return;
   setBusy(true);setError('');
   try {await rpc('wallet_revokeAppConnection',{accountId,pubkey:revoke.pubkey});if(alive.current){setRevoke(null);await refresh();}}
   catch {if(alive.current)setError(t('wallet.appsRevokeFailed'));}
   finally {if(alive.current)setBusy(false);}
 };
 return <>
  <OverlayPanel title={t('wallet.appsTitle')} onBack={busy?undefined:()=>{if(pairing)setPairing('');else if(creating)setCreating(false);else onClose();}} zIndex={550}>
   <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6 pb-4">
    <SectionHint>{t('wallet.appsHint')}</SectionHint>
    <FormError>{error}</FormError>
    {pairing ? <Card className="m-0 p-6 flex flex-col gap-5">
      <SectionHint>{t('wallet.appsSecretHint')}</SectionHint>
      <div className="flex justify-center"><QrCode value={pairing} size={200} className="bg-white p-4 rounded-md"/></div>
      <CopyButton value={pairing} label={t('wallet.copyNwc')}/>
      <Button small onClick={()=>setPairing('')}>{t('common.close')}</Button>
    </Card> : creating ? <Card className="m-0 p-6 flex flex-col gap-5">
      <Input label={t('wallet.appsName')} value={name} maxLength={50} onChange={e=>setName(e.target.value)} disabled={busy}/>
      <Input label={t('wallet.appsLimit')} type="number" value={limit} min={1} max={9999999} step={1} onChange={e=>setLimit(e.target.value)} disabled={busy}/>
      <Input label={t('wallet.appsExpiry')} type="number" value={days} min={1} max={365} step={1} onChange={e=>setDays(e.target.value)} disabled={busy}/>
      <SectionHint>{t('wallet.appsPermissions')}</SectionHint>
      <Button small disabled={busy||!valid} onClick={create}>{t(busy?'common.loading':'wallet.appsCreate')}</Button>
      <Button small variant="secondary" disabled={busy} onClick={()=>setCreating(false)}>{t('common.cancel')}</Button>
    </Card> : <>
      <div className="flex gap-4"><Button small disabled={busy||!loaded} onClick={()=>{setError('');setCreating(true);}}>{t('wallet.appsNew')}</Button><Button small variant="secondary" disabled={busy} onClick={refresh}>{t(busy?'common.loading':'common.refresh')}</Button></div>
      {loaded&&!connections.length&&<SectionHint>{t('wallet.appsEmpty')}</SectionHint>}
      {connections.map(c=><Card key={c.pubkey} className="m-0 p-6 flex flex-col gap-4">
        <strong className="text-heading break-words">{c.name}</strong>
        <span className="text-xs text-menu-subtitle break-all">{c.pubkey.slice(0,12)}…{c.pubkey.slice(-8)}</span>
        <span className="text-sm text-menu-subtitle">{t('wallet.appsExpires',{date:c.expiresAt?new Date(c.expiresAt*1000).toLocaleDateString():t('wallet.appsNever')})}</span>
        {c.budgets.length?c.budgets.map((b,i)=><span key={i} className="text-sm text-menu-subtitle">{t('wallet.appsBudget',{used:String(b.usedSats),limit:String(b.limitSats)})} · {b.seconds===86400?t('wallet.appsDaily'):t('wallet.appsPeriod',{seconds:String(b.seconds)})}</span>):<SectionHint>{t('wallet.appsUnlimited')}</SectionHint>}
        <div className="flex gap-4 flex-wrap">{c.canCopy&&<Button small disabled={busy} onClick={()=>reveal(c.pubkey)}>{t('wallet.appsShow')}</Button>}<ButtonDanger small disabled={busy} onClick={()=>{setError('');setRevoke(c);}}>{t('wallet.appsRevoke')}</ButtonDanger></div>
        {!c.canCopy&&<SectionHint>{t('wallet.appsOtherDevice')}</SectionHint>}
      </Card>)}
    </>}
   </div>
  </OverlayPanel>
  {revoke&&<ConfirmDialog title={t('wallet.appsRevoke')} message={t('wallet.appsRevokeConfirm',{name:revoke.name})} confirmLabel={t('wallet.appsRevoke')} danger busy={busy} error={error} onConfirm={remove} onCancel={()=>setRevoke(null)}/>}
 </>;
}
