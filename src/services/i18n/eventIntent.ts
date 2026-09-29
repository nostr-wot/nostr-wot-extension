import { t } from './i18n.ts';
import { KIND_LABELS } from '@constants/nostr.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';

/** Describe the requested signing operation; the full event remains in Advanced. */
export function describeSigningIntent(origin:string,event?:Partial<NostrEventDisplay> | null):string {
  const kind = event?.kind;
  const tags = event?.tags || [];
  if (kind === 30078) {
    const identifier = tags.find(tag=>tag[0] === 'd');
    if (identifier?.[1]) return identifier[2]
      ? t('eventIntent.appAction',{origin,app:identifier[1],action:identifier[2].replace(/_/g,' ')})
      : t('eventIntent.appData',{origin,app:identifier[1]});
  }
  const descriptions:Record<number,string> = {0:'profile',1:'note',3:'contacts',5:'delete',6:'repost',7:'reaction',13:'seal',1059:'wrap'};
  if (kind !== undefined && descriptions[kind]) return t(`eventIntent.${descriptions[kind]}`,{
    origin,count:tags.filter(tag=>kind === 3 ? tag[0] === 'p' : ['e','a'].includes(tag[0])).length,
    reaction:event?.content || '+',
  });
  return kind !== undefined && KIND_LABELS[kind]
    ? t('eventIntent.named',{origin,purpose:KIND_LABELS[kind]}) : t('eventIntent.generic',{origin});
}
