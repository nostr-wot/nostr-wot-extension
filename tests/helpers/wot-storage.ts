import 'fake-indexeddb/auto';
import { WOT_DATABASE_NAME } from '../../src/constants/wot.ts';
export async function resetWotDatabase() {
    await new Promise<void>((resolve,reject)=>{
        const request=indexedDB.open(WOT_DATABASE_NAME,1);
        request.onupgradeneeded=()=>{request.result.createObjectStore('snapshots');request.result.createObjectStore('lists');};
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
            const db=request.result,tx=db.transaction(['snapshots','lists'],'readwrite');
            tx.objectStore('snapshots').clear();tx.objectStore('lists').clear();
            tx.oncomplete=()=>{db.close();resolve();};
            tx.onabort=()=>{db.close();reject(tx.error);};
        };
    });
}
