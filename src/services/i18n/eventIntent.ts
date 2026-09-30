import { t } from './i18n.ts';
import { KIND_LABELS } from '@constants/nostr.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';

/** Describe the requested signing operation; the full event remains in Advanced. */
export function signingIntentParts(origin:string,event?:Partial<NostrEventDisplay> | null):IntentPart[] {
  const kind = event?.kind;
  const tags = event?.tags || [];
  if (kind === 9007) {
    const group = tags.find(tag=>tag[0] === 'name')?.[1] || tags.find(tag=>tag[0] === 'h')?.[1];
    return intentParts(group ? 'eventIntent.createNamedGroup' : 'eventIntent.createGroup',{origin,group:group || ''});
  }
  if (kind === 30078) {
    const identifier = tags.find(tag=>tag[0] === 'd');
    if (identifier?.[1]) return identifier[2]
      ? intentParts('eventIntent.appAction',{origin,app:identifier[1],action:identifier[2].replace(/_/g,' ')})
      : intentParts('eventIntent.appData',{origin,app:identifier[1]});
  }
  const descriptions:Record<number,string> = {0:'profile',1:'note',3:'contacts',5:'delete',6:'repost',7:'reaction',13:'seal',1059:'wrap'};
  if (kind !== undefined && descriptions[kind]) return intentParts(`eventIntent.${descriptions[kind]}`,{
    origin,count:tags.filter(tag=>kind === 3 ? tag[0] === 'p' : ['e','a'].includes(tag[0])).length,
    reaction:event?.content || '+',
  });
  return kind !== undefined && KIND_LABELS[kind]
    ? intentParts('eventIntent.named',{origin,purpose:KIND_LABELS[kind]}) : intentParts('eventIntent.generic',{origin});
}

export interface IntentPart { text:string; accent:boolean }
/** Parse only trusted translation markup, then insert values as literal text. */
export function intentParts(key:string,params:Record<string,string|number>):IntentPart[] {
  let accent=false;
  return t(key).split(/(\[\[|\]\]|\{\w+\})/).flatMap(token=>{
    if(token==='[[') {accent=true;return [];}
    if(token===']]') {accent=false;return [];}
    const name=token.match(/^\{(\w+)\}$/)?.[1];
    return token ? [{text:name ? String(params[name] ?? token) : token,accent:accent || name==='origin' || name==='app'}] : [];
  });
}
export function describeSigningIntent(origin:string,event?:Partial<NostrEventDisplay> | null):string {
  return signingIntentParts(origin,event).map(part=>part.text).join('');
}
