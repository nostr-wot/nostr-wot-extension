import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';

export const walletKey = new Uint8Array(32).fill(21);
export const clientKey = new Uint8Array(32).fill(22);
export const walletPubkey = getPublicKey(walletKey);
export const clientPubkey = getPublicKey(clientKey);
type Request = { id: string; method: string; params: Record<string, unknown>; encryption: 'nip04' | 'nip44_v2' };

export async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'NWC integration condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Independent wallet peer uses nostr-tools, while the provider uses the app's
// crypto. Deliberately forwards hostile events too: the provider must verify them.
export async function localWallet(options: { encryption?: string; infoEvents?: object[]; silentInfo?: boolean } = {}) {
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const relay = `ws://127.0.0.1:${address.port}`;
  const requests: Request[] = [];
  const filters: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  const infoFilters: Record<string, unknown>[] = [];
  server.on('connection', socket => {
    socket.on('message', raw => {
      void (async () => {
        const [type, value, filter] = JSON.parse(raw.toString());
        if(type==='REQ') {
          if (filter.kinds.includes(13194)) {
            infoFilters.push(filter);
            if (options.silentInfo) return;
            const events = options.infoEvents ?? (options.encryption ? [finalizeEvent({ kind: 13194, created_at: 1700000000, tags: [['encryption', options.encryption]], content: 'get_info get_balance pay_invoice make_invoice lookup_invoice list_transactions' }, walletKey)] : []);
            for (const event of events) socket.send(JSON.stringify(['EVENT', value, event]));
          } else filters.push(filter);
          socket.send(JSON.stringify(['EOSE',value]));
        }
        if(type!=='EVENT') return;
        assert.ok(verifyEvent(value)); assert.equal(value.kind,23194);
        assert.equal(value.pubkey,clientPubkey);
        assert.deepEqual(value.tags.find((tag: string[]) => tag[0] === 'p'), ['p', walletPubkey]);
        const encryption = value.tags.find((tag: string[]) => tag[0] === 'encryption')?.[1] ?? 'nip04';
        if (options.encryption === 'nip44_v2') assert.equal(encryption, 'nip44_v2');
        const plaintext = encryption === 'nip44_v2'
          ? nip44.v2.decrypt(value.content, nip44.v2.utils.getConversationKey(walletKey, clientPubkey))
          : await nip04.decrypt(walletKey,clientPubkey,value.content);
        const content=JSON.parse(plaintext);
        requests.push({id:value.id,...content,encryption});
        socket.send(JSON.stringify(['OK',value.id,true,'']));
      })().catch(error=>errors.push(error));
    });
  });
  function send(event: object) {
    for(const socket of server.clients) if(socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(['EVENT','nwc-sub',event]));
  }
  async function response(req: Request, result: object, options: {key?:Uint8Array; tamper?:boolean; content?:string; reference?:string; error?:{code:string;message:string}} = {}) {
    const plaintext = JSON.stringify({result_type:req.method,result,...(options.error?{error:options.error}:{})});
    const content = options.content ?? (req.encryption === 'nip44_v2'
      ? nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(walletKey, clientPubkey))
      : await nip04.encrypt(walletKey,clientPubkey,plaintext));
    const event=finalizeEvent({kind:23195,created_at:Math.floor(Date.now()/1000),tags:[['p',clientPubkey],['e',options.reference??req.id]],content},options.key??walletKey);
    send(options.tamper?{...event,content:event.content+'tampered'}:event);
  }
  return {relay,requests,filters,infoFilters,errors,response,
    dropConnections() { for (const socket of server.clients) socket.terminate(); },
    async close() {for(const socket of server.clients) socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  };
}

