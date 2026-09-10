import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { readPrivateCache, writePrivateCache, removePrivateCache } from '../src/services/storage/private-cache.ts';
import { readWalletDisplayCache, updateWalletDisplayCache, walletDisplayRevision } from '../src/services/wallet/display-cache.ts';
import { handlers as activity, logActivity } from '../src/services/background/activity-handlers.ts';
import { runPaymentOnce } from '../src/services/wallet/payment-intents.ts';
import { deriveKey, encrypt } from '../src/services/vault/encryption.ts';
import { arrayToBase64 } from '../src/lib/crypto/utils.ts';
import { VAULT_STORAGE_KEY, LEGACY_VAULT_PBKDF2_ITERATIONS } from '../src/constants/vault.ts';

const payload = {accounts:[],activeAccountId:null};
describe('encrypted private caches', () => {
  beforeEach(async () => { resetMockStorage(); vault.lock(); await vault.create('', payload); });
  afterEach(() => vault.lock());

  it('encrypts balances, memos, amounts and hashes with fresh nonces; lock hides them', async () => {
    const data = {providerType:'lnbits',balance:12345,transactions:[{paymentHash:'private-hash',memo:'private-memo',amount:99,status:'settled' as const,createdAt:1}]};
    await updateWalletDisplayCache('account-a',data,walletDisplayRevision());
    const raw = JSON.stringify(await browser.storage.local.get(null));
    assert.doesNotMatch(raw,/private-hash|private-memo|12345/);
    assert.equal((await readWalletDisplayCache('account-a'))?.balance,12345);
    vault.lock();
    assert.deepEqual(await readWalletDisplayCache('account-a'),{providerType:'lnbits'});
    assert.equal(await vault.unlock(''),true);
    assert.equal((await readWalletDisplayCache('account-a'))?.transactions?.[0].memo,'private-memo');
    await writePrivateCache('nonce',data); const first=(await browser.storage.local.get('nonce')).nonce;
    await writePrivateCache('nonce',data); const second=(await browser.storage.local.get('nonce')).nonce;
    assert.notEqual((first as any).iv,(second as any).iv);
  });

  it('authenticates record identity and tampering, and never treats corrupt budget as empty', async () => {
    await writePrivateCache('a',{private:'memo'});
    const record=(await browser.storage.local.get('a')).a as any;
    await browser.storage.local.set({b:record});
    await assert.rejects(readPrivateCache('b'));
    await browser.storage.local.set({a:{...record,ciphertext:record.ciphertext.slice(0,-4)+'AAAA'}});
    await assert.rejects(readPrivateCache('a'));
    await removePrivateCache('a'); assert.equal(await readPrivateCache('a'),null);
  });

  it('preserves caches across password changes and vault recreation from its payload', async () => {
    await writePrivateCache('a',{memo:'keep'});
    await vault.reEncrypt('new-password'); vault.lock();
    assert.equal(await vault.unlock('new-password'),true);
    assert.deepEqual(await readPrivateCache('a'),{memo:'keep'});
    await vault.create('',vault.getDecryptedPayload());
    assert.deepEqual(await readPrivateCache('a'),{memo:'keep'});
  });

  it('migrates old unvisited wallet/activity records on unlock after persisting a new key', async () => {
    vault.lock();
    const salt=crypto.getRandomValues(new Uint8Array(32));
    const key=await deriveKey('',salt,LEGACY_VAULT_PBKDF2_ITERATIONS);
    const encrypted=await encrypt(key,JSON.stringify(payload));
    await browser.storage.local.set({[VAULT_STORAGE_KEY]:{salt:arrayToBase64(salt),iv:arrayToBase64(encrypted.iv),ciphertext:arrayToBase64(encrypted.ciphertext),iterations:LEGACY_VAULT_PBKDF2_ITERATIONS},walletDisplay_old:{providerType:'lnbits',balance:67891,transactions:[{memo:'legacy-secret'}]},activityLog:[{method:'signEvent',timestamp:1,decision:'approved',event:{content:'legacy-event'}}]});
    assert.equal(await vault.unlock(''),true);
    assert.doesNotMatch(JSON.stringify(await browser.storage.local.get(null)),/legacy-secret|legacy-event|67891/);
    vault.lock(); assert.equal(await vault.unlock(''),true);
    assert.equal((await readWalletDisplayCache('old'))?.balance,67891);
  });

  it('clears encrypted activity on destroy so a fresh vault can record new activity', async () => {
    await logActivity({method:'signEvent',decision:'approved',event:{content:'private-event'}});
    assert.doesNotMatch(JSON.stringify(await browser.storage.local.get(null)),/private-event/);
    assert.equal((await activity.get('getActivityLog')!({}) as any[]).length,1);
    await vault.destroy(); await vault.create('',payload);
    await logActivity({method:'signEvent',decision:'approved'});
    assert.equal((await activity.get('getActivityLog')!({}) as any[]).length,1);
    vault.lock(); await assert.rejects(activity.get('getActivityLog')!({}),/locked/i);
    await logActivity({method:'signEvent',decision:'approved',event:{content:'locked-secret'}});
    assert.doesNotMatch(JSON.stringify(await browser.storage.local.get(null)),/locked-secret/);
  });

  it('encrypts replay results without losing duplicate-payment protection across lock/unlock', async () => {
    let sends=0;
    const send=async()=>{ sends++; return {preimage:'secret-preimage',memo:'secret-payment'}; };
    await runPaymentOnce('same-intent',send);
    assert.doesNotMatch(JSON.stringify(await browser.storage.session.get(null)),/secret-preimage|secret-payment/);
    vault.lock(); await assert.rejects(runPaymentOnce('same-intent',send),/locked/i);
    assert.equal(await vault.unlock(''),true);
    assert.deepEqual(await runPaymentOnce('same-intent',send),{preimage:'secret-preimage',memo:'secret-payment'});
    assert.equal(sends,1);
  });

  it('keeps an in-flight marker when lock prevents storing a completed payment result', async () => {
    let sends=0;
    await assert.rejects(runPaymentOnce('uncertain',async()=>{sends++;vault.lock();return {preimage:'secret'};}),/locked/i);
    await vault.unlock('');
    await assert.rejects(runPaymentOnce('uncertain',async()=>{sends++;}),/PAYMENT_IN_FLIGHT/);
    assert.equal(sends,1);
  });
  it('rejects reads queued before an account switch', async () => {
    const account = {id:'a',name:'A',type:'npub' as const,pubkey:'11'.repeat(32),privkey:null,mnemonic:null,nip46Config:null,readOnly:true,createdAt:1};
    await vault.create('',{accounts:[account,{...account,id:'b'}],activeAccountId:'a'});
    await writePrivateCache('private',{memo:'old session'});
    const original=browser.storage.local.set;
    let started!:()=>void, release!:()=>void;
    const entered=new Promise<void>(r=>{started=r;});
    const gate=new Promise<void>(r=>{release=r;});
    browser.storage.local.set=async (items)=>{if ('blocked' in items) {started();await gate;} return original(items);};
    try {
      const writing=writePrivateCache('blocked',{x:1}); await entered;
      const reading=readPrivateCache('private');
      const rejected=assert.rejects(reading,/session changed/);
      await vault.setActiveAccount('b');
      release(); await writing; await rejected;
    } finally {release();browser.storage.local.set=original;}
  });

  it('cannot encrypt migration data until the cache key is durably saved', async () => {
    vault.lock();
    const salt=crypto.getRandomValues(new Uint8Array(32));
    const key=await deriveKey('',salt,LEGACY_VAULT_PBKDF2_ITERATIONS);
    const encrypted=await encrypt(key,JSON.stringify(payload));
    await browser.storage.local.set({[VAULT_STORAGE_KEY]:{salt:arrayToBase64(salt),iv:arrayToBase64(encrypted.iv),ciphertext:arrayToBase64(encrypted.ciphertext),iterations:LEGACY_VAULT_PBKDF2_ITERATIONS},walletDisplay_old:{providerType:'lnbits',balance:321}});
    const original=browser.storage.local.set;
    let started!:()=>void, release!:()=>void;
    const entered=new Promise<void>(r=>{started=r;}); const gate=new Promise<void>(r=>{release=r;});
    browser.storage.local.set=async(items)=>{if (VAULT_STORAGE_KEY in items) {started();await gate;throw new Error('disk full');}return original(items);};
    try {
      const unlocking=vault.unlock(''); await entered;
      await assert.rejects(readPrivateCache('walletDisplay_old'),/locked/);
      release(); assert.equal(await unlocking,false); assert.equal(vault.isLocked(),true);
      assert.equal(((await browser.storage.local.get('walletDisplay_old')).walletDisplay_old as any).balance,321);
    } finally {release();browser.storage.local.set=original;}
  });

  it('does not encrypt with the old key while replacing the vault', async () => {
    const old=vault.getDecryptedPayload();
    const original=browser.storage.local.set;
    let started!:()=>void,release!:()=>void;
    const entered=new Promise<void>(r=>{started=r;});const gate=new Promise<void>(r=>{release=r;});
    browser.storage.local.set=async(items)=>{if (VAULT_STORAGE_KEY in items) {started();await gate;} return original(items);};
    try {
      const creating=vault.create('',old);await entered;
      await assert.rejects(writePrivateCache('during-create',{memo:'secret'}),/locked/);
      release();await creating;await writePrivateCache('after-create',{memo:'works'});
      assert.deepEqual(await readPrivateCache('after-create'),{memo:'works'});
    } finally {release();browser.storage.local.set=original;}
  });

});
