import type { WotGraph } from '@domain/wot/types.ts';
import { databaseRead, databaseReadMany, databaseWrite } from './database.ts';

/** Verified public data only; private mute payloads never enter this shared cache. */
export interface PublicLists {
    bytes?: number;
    pubkey: string;
    scope: string;
    checkedAt: number;
    fullCheckedAt: number;
    follows?: string[];
    followVersion?: {createdAt:number;id:string};
    relays?: WotGraph['relays'][string];
    relayVersion?: {createdAt:number;id:string};
}
export async function readPublicLists(pubkey: string): Promise<PublicLists | undefined> {
    return databaseRead<PublicLists>('lists',pubkey);
}
export function readPublicListBatch(pubkeys: string[]): Promise<Array<PublicLists | undefined>> {
    return databaseReadMany<PublicLists>('lists',pubkeys);
}
export async function publicListSummary(): Promise<{records:number;bytes:number}> {
    return await databaseRead<{records:number;bytes:number}>('lists','__summary__') || {records:0,bytes:0};
}
export async function savePublicLists(records: PublicLists[], signal?: AbortSignal): Promise<void> {
    if (!records.length) return;
    const previous=await readPublicListBatch(records.map(record=>record.pubkey));
    const summary=await publicListSummary();
    records=records.map((record,index)=>{
        const {bytes: _bytes,...data}=record;
        const bytes=new TextEncoder().encode(JSON.stringify(data)).byteLength;
        summary.bytes+=bytes-(previous[index]?.bytes || 0);
        if (!previous[index]) summary.records++;
        return {...data,bytes};
    });
    await databaseWrite('lists',[...records.map(record=>[record.pubkey,record] as [string,unknown]),['__summary__',summary]],[],signal);
}
