import { WOT_DATABASE_NAME } from '@constants/wot.ts';

let opening: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
    return opening ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(WOT_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('snapshots');
            request.result.createObjectStore('lists');
        };
        request.onerror = () => { opening = undefined; reject(request.error); };
        request.onblocked = () => { opening = undefined; reject(new Error('WoT database is blocked by another open context')); };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); opening = undefined; };
            resolve(db);
        };
    });
}
/** Resolve on transaction commit, never merely on a request's success. */
export async function databaseRead<T>(store: 'snapshots' | 'lists', key: string): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const request = tx.objectStore(store).get(key);
        tx.oncomplete = () => resolve(request.result as T | undefined);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('WoT database read failed'));
    });
}
export async function databaseWrite(store: 'snapshots' | 'lists', records: Array<[string, unknown]>, remove: string[] = [], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const db = await open();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const abort = () => { try { tx.abort(); } catch { /* Already completed. */ } };
        signal?.addEventListener('abort', abort, {once:true});
        const finish = () => signal?.removeEventListener('abort', abort);
        tx.oncomplete = () => { finish(); resolve(); };
        tx.onabort = tx.onerror = () => { finish(); reject(signal?.aborted ? signal.reason : tx.error || new Error('WoT database write failed')); };
        try {
            const target = tx.objectStore(store);
            for (const [key, value] of records) target.put(value, key);
            for (const key of remove) target.delete(key);
        } catch (error) { abort(); finish(); reject(error); }
    });
}

export async function databaseReadMany<T>(store: 'snapshots' | 'lists', keys: string[]): Promise<Array<T | undefined>> {
    const db = await open();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(store,'readonly');
        const requests=keys.map(key=>tx.objectStore(store).get(key));
        tx.oncomplete=()=>resolve(requests.map(request=>request.result as T | undefined));
        tx.onabort=tx.onerror=()=>reject(tx.error || new Error('WoT database read failed'));
    });
}
export async function databaseKeys(store: 'snapshots' | 'lists'): Promise<string[]> {
    const db=await open();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(store,'readonly'),request=tx.objectStore(store).getAllKeys();
        tx.oncomplete=()=>resolve(request.result as string[]);
        tx.onabort=tx.onerror=()=>reject(tx.error || new Error('WoT database inventory failed'));
    });
}
