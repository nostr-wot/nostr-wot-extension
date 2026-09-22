import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';

export const walletKey = new Uint8Array(32).fill(21);
export const clientKey = new Uint8Array(32).fill(22);
export const walletPubkey = getPublicKey(walletKey);
export const clientPubkey = getPublicKey(clientKey);
type Request = { id: string; method: string; params: Record<string, unknown> };

export async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'NWC integration condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// Independent wallet peer uses nostr-tools, while the provider uses the app's
// crypto. Deliberately forwards hostile events too: the provider must verify them.
export async function localWallet() {
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const relay = `ws://127.0.0.1:${address.port}`;
  const requests: Request[] = [];
  const filters: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  server.on('connection', socket => {
    socket.on('message', raw => {
      void (async () => {
        const [type, value, filter] = JSON.parse(raw.toString());
        if(type==='REQ') { filters.push(filter); socket.send(JSON.stringify(['EOSE',value])); }
        if(type!=='EVENT') return;
        assert.ok(verifyEvent(value)); assert.equal(value.kind,23194);
        assert.equal(value.pubkey,clientPubkey);
        assert.deepEqual(value.tags,[['p',walletPubkey]]);
        const content=JSON.parse(await nip04.decrypt(walletKey,clientPubkey,value.content));
        requests.push({id:value.id,...content});
        socket.send(JSON.stringify(['OK',value.id,true,'']));
      })().catch(error=>errors.push(error));
    });
  });
  function send(event: object) {
    for(const socket of server.clients) if(socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(['EVENT','nwc-sub',event]));
  }
  async function response(req: Request, result: object, options: {key?:Uint8Array; tamper?:boolean; content?:string; reference?:string; error?:{code:string;message:string}} = {}) {
    const content=options.content ?? await nip04.encrypt(walletKey,clientPubkey,JSON.stringify({result_type:req.method,result,...(options.error?{error:options.error}:{})}));
    const event=finalizeEvent({kind:23195,created_at:Math.floor(Date.now()/1000),tags:[['p',clientPubkey],['e',options.reference??req.id]],content},options.key??walletKey);
    send(options.tamper?{...event,content:event.content+'tampered'}:event);
  }
  return {relay,requests,filters,errors,response,
    dropConnections() { for (const socket of server.clients) socket.terminate(); },
    async close() {for(const socket of server.clients) socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  };
}

