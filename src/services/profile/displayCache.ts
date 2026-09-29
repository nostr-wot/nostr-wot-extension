import browser from '@lib/browser';
import { PROFILE_CACHE_TTL_MS, PROFILE_CACHE_MAX_ENTRIES } from '@constants/profile';
import { profileCache, type ProfileCacheEntry } from '../background/state';

let maintenance:Promise<void> = Promise.resolve();
/** Serialize pruning with writes so concurrent directory reads obey the same cap. */
export function maintainProfileCache(pubkey?:string,entry?:ProfileCacheEntry):Promise<void> {
 const run=maintenance.catch(()=>{}).then(async()=>{
  if(pubkey && entry) await browser.storage.local.set({[`profile_${pubkey}`]:entry});
  const stored=await browser.storage.local.get(null) as Record<string,ProfileCacheEntry>;
  const now=Date.now();
  const profiles=Object.entries(stored).filter(([key])=>/^profile_[a-f0-9]{64}$/i.test(key));
  const fresh=profiles.filter(([,value])=>value && Number.isFinite(value.fetchedAt) && value.fetchedAt<=now && now-value.fetchedAt<PROFILE_CACHE_TTL_MS)
   .sort((a,b)=>b[1].fetchedAt-a[1].fetchedAt).slice(0,PROFILE_CACHE_MAX_ENTRIES);
  const keep=new Set(fresh.map(([key])=>key));
  const remove=profiles.map(([key])=>key).filter(key=>!keep.has(key));
  if(remove.length) await browser.storage.local.remove(remove);
  profileCache.clear();
  for(const [key,value] of fresh) profileCache.set(key.slice(8),value);
 });
 maintenance=run;
 return run;
}
