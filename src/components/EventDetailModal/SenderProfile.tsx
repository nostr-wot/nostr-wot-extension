import type { ProfileMetadata } from '@domain/profile/profileMetadata';
import { rpc } from '@services/rpc';
import Avatar from '@components/Avatar';
import Text from '@components/Text';
import useAsyncResource from '@hooks/useAsyncResource';
import { truncateMiddle } from '@utils/format/text';

export default function SenderProfile({pubkey,lookup=true}:{pubkey:string;lookup?:boolean}) {
 const {data}=useAsyncResource<{profile:ProfileMetadata|null}>({profile:null},{deps:[pubkey,lookup],load:async(patch,current)=>{
  patch({profile:null});
  if(!lookup || !/^[a-f0-9]{64}$/i.test(pubkey)) return;
  const profile=await rpc<ProfileMetadata|null>('getProfileMetadata',{pubkey,directory:true});
  if(current()) patch({profile});
 }});
 const name=[data.profile?.display_name,data.profile?.name].find((value):value is string=>typeof value==='string' && !!value.trim()) || truncateMiddle(pubkey,16,12);
 const picture=typeof data.profile?.picture==='string' ? data.profile.picture : undefined;
 return <div className="flex items-center gap-3 min-w-0">
  <Avatar key={picture || pubkey} src={picture} fallback={name[0]?.toUpperCase() || '?'} imgClassName="size-12 rounded-full object-cover" fallbackClassName="size-12 rounded-full shrink-0 bg-brand-light text-brand flex items-center justify-center"/>
  <Text className="font-medium break-all">{name}</Text>
 </div>;
}
