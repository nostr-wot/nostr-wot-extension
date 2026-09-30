import { it } from 'node:test';
import assert from 'node:assert/strict';
import { signVerifiedRemoteEvent } from '../src/services/signing/remoteEventVerifier.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { getPublicKey } from '../src/lib/crypto/secp256k1.ts';
import { bytesToHex } from '../src/lib/crypto/utils.ts';
import type { UnsignedEvent } from '../src/domain/nostr/types.ts';
const key=new Uint8Array(32).fill(1);
const pubkey=bytesToHex(getPublicKey(key));
const event=():UnsignedEvent=>({kind:27235,created_at:1700000000,content:'',tags:[['u','https://api.test/login'],['method','POST'],['payload','a'.repeat(64)],['challenge','nonce']]});
it('accepts the exact signed request and expected author',async()=>{
  const result=await signVerifiedRemoteEvent(event(),pubkey,e=>signEvent(e,key));
  assert.equal(result.pubkey,pubkey); assert.deepEqual(result.tags,event().tags);
});
for(const [name,mutate] of Object.entries({
  destination:(e:UnsignedEvent)=>{e.tags[0][1]='https://evil.test';},
  method:(e:UnsignedEvent)=>{e.tags[1][1]='DELETE';},
  payload:(e:UnsignedEvent)=>{e.tags[2][1]='b'.repeat(64);},
  challenge:(e:UnsignedEvent)=>{e.tags[3][1]='other';},
  content:(e:UnsignedEvent)=>{e.content='not reviewed';},
  kind:(e:UnsignedEvent)=>{e.kind=1;},
  timestamp:(e:UnsignedEvent)=>{e.created_at++;},
  tagOrder:(e:UnsignedEvent)=>{e.tags.reverse();},
  extraTag:(e:UnsignedEvent)=>{e.tags.push(['extra','yes']);},
})) it('rejects valid remote signatures changing '+name,async()=>{
  await assert.rejects(signVerifiedRemoteEvent(event(),pubkey,async e=>{mutate(e);return signEvent(e,key);}),/approved event/i);
});
it('rejects a valid signature under an unexpected author',async()=>{
  await assert.rejects(signVerifiedRemoteEvent(event(),pubkey,e=>signEvent(e,new Uint8Array(32).fill(2))),/author/i);
});
it('rejects invalid signature and ID',async()=>{
  for(const field of ['sig','id']) await assert.rejects(signVerifiedRemoteEvent(event(),pubkey,async e=>({...await signEvent(e,key),[field]:'0'.repeat(field==='id'?64:128)})),/signature/i);
});
it('snapshots before the remote await and resists original and delegated-input mutation',async()=>{
  const request=event(); let release!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});
  const result=signVerifiedRemoteEvent(request,pubkey,async e=>{await gate;return signEvent(e,key);});
  request.tags[0][1]='https://evil.test'; request.created_at++;
  release(); assert.deepEqual((await result).tags,event().tags);
  await assert.rejects(signVerifiedRemoteEvent(event(),pubkey,async e=>{await Promise.resolve();e.tags[0][1]='https://evil.test';return signEvent(e,key);}),/approved event/i);
});
it('normalizes omitted tags and timestamp before remote signing',async()=>{
  const result=await signVerifiedRemoteEvent({kind:1,content:'test'} as UnsignedEvent,pubkey,async e=>{
    assert.deepEqual(e.tags,[]); assert.ok(Number.isInteger(e.created_at));return signEvent(e,key);
  });
  assert.deepEqual(result.tags,[]);
});
