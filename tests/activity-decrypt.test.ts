import { it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/lib/vault.ts';
import { importNsec } from '../src/lib/accounts.ts';
import { nip04Encrypt } from '../src/lib/crypto/nip04.ts';
import { nip44Encrypt } from '../src/lib/crypto/nip44.ts';
import { hexToBytes } from '../src/lib/crypto/utils.ts';
import { handlers } from '../src/lib/bg/activity-handlers.ts';
import { activityEntryKey, type ActivityEntry } from '../src/domain/activity/activity.ts';

beforeEach(async () => { resetMockStorage(); await vault.destroy(); });
const ownerKey = '11'.repeat(32), peerKey = '22'.repeat(32);

for (const [scheme, encrypt] of [['nip04', nip04Encrypt], ['nip44', nip44Encrypt]] as const) {
  it(`activity decrypts ${scheme} with the recorded account, not the current account`, async () => {
    const owner = await importNsec(ownerKey, 'Owner');
    const peer = await importNsec(peerKey, 'Other');
    await vault.create('', { accounts: [owner,peer], activeAccountId: peer.id });
    const ciphertext = await encrypt('private message', hexToBytes(peerKey), hexToBytes(owner.pubkey));
    const entry: ActivityEntry = { method: `${scheme}Decrypt`, timestamp: 1, decision: 'approved', domain: 'site.test', pubkey: owner.pubkey, theirPubkey: peer.pubkey, ciphertext };
    await browser.storage.local.set({ activityLog: [entry] });
    const result = await handlers.get('activity_decrypt')!({ entryKey: activityEntryKey(entry) });
    assert.deepEqual(result, { plaintext: 'private message' });
    assert.equal(vault.getActiveAccountId(), peer.id);
    assert.equal(JSON.stringify((await browser.storage.local.get('activityLog')).activityLog).includes('private message'), false);
    vault.lock();
    await assert.rejects(() => handlers.get('activity_decrypt')!({ entryKey: activityEntryKey(entry) }), /locked/i);
  });
}
it('activity refuses a removed or fabricated log entry', async () => {
  const owner = await importNsec(ownerKey, 'Owner');
  await vault.create('', { accounts: [owner], activeAccountId: owner.id });
  await assert.rejects(() => handlers.get('activity_decrypt')!({ entryKey: 'not saved' }), /no longer|not found/i);
});

it('gift-wrap review verifies the seal and decrypts both layers', async () => {
  const { signEvent } = await import('../src/lib/crypto/nip01.ts');
  const owner = await importNsec(ownerKey, 'Owner');
  const peer = await importNsec(peerKey, 'Sender');
  const wrapper = await importNsec('33'.repeat(32), 'Wrapper');
  await vault.create('', { accounts: [owner], activeAccountId: owner.id });
  const content = await nip44Encrypt('private rumor', hexToBytes(peerKey), hexToBytes(owner.pubkey));
  const seal = await signEvent({ kind: 13, created_at: 1, tags: [], content, pubkey: peer.pubkey }, hexToBytes(peerKey));
  for (const valid of [true, false]) {
    const ciphertext = await nip44Encrypt(JSON.stringify(valid ? seal : {...seal, sig: '00'.repeat(64)}), hexToBytes('33'.repeat(32)), hexToBytes(owner.pubkey));
    const entry: ActivityEntry = { method: 'signEvent', timestamp: 1, decision: 'approved', pubkey: owner.pubkey,
      event: { kind: 1059, pubkey: wrapper.pubkey, content: ciphertext, tags: [['p',owner.pubkey]] } };
    await browser.storage.local.set({ activityLog: [entry] });
    const review = () => handlers.get('activity_decrypt')!({entryKey: activityEntryKey(entry)});
    if (valid) assert.deepEqual(await review(), {plaintext: 'private rumor'});
    else await assert.rejects(review, /signature/i);
  }
});

it('PQ review uses the recorded mnemonic account and reuses the hybrid decoder', async () => {
  const { createFromMnemonic } = await import('../src/lib/accounts.ts');
  const { mnemonicToSeed } = await import('../src/lib/crypto/bip39.ts');
  const { derivePqKeys, pqEncrypt } = await import('../src/lib/crypto/pq.ts');
  const { getConversationKey } = await import('../src/lib/crypto/nip44.ts');
  const mnemonic = 'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
  const owner = await createFromMnemonic(mnemonic, 'PQ owner');
  const peer = await importNsec(peerKey, 'Current account');
  await vault.create('', { accounts: [owner,peer], activeAccountId: peer.id });
  const seed = await mnemonicToSeed(mnemonic);
  const keys = derivePqKeys(seed);
  const conversation = getConversationKey(hexToBytes(peerKey), hexToBytes(owner.pubkey));
  const ciphertext = pqEncrypt('hybrid message', keys.kem.publicKey, conversation, peer.pubkey, owner.pubkey);
  seed.fill(0); conversation.fill(0); keys.kem.secretKey.fill(0); keys.dsa.secretKey.fill(0);
  const entry: ActivityEntry = { method: 'nip44Decrypt', timestamp: 1, decision: 'approved', pubkey: owner.pubkey, theirPubkey: peer.pubkey, ciphertext };
  await browser.storage.local.set({ activityLog: [entry] });
  assert.deepEqual(await handlers.get('activity_decrypt')!({entryKey: activityEntryKey(entry)}), {plaintext: 'hybrid message'});
});

it('review rejects missing accounts, watch-only keys, invalid peers and absent ciphertext', async () => {
  const { decryptForAccount } = await import('../src/lib/signer.ts');
  const owner = await importNsec(ownerKey, 'Owner');
  await vault.create('', { accounts: [{...owner, readOnly: true, type: 'npub', privkey: null}], activeAccountId: owner.id });
  await assert.rejects(() => decryptForAccount(owner.id, 'nip44', '22'.repeat(32), 'x'), /not available/i);
  const entry: ActivityEntry = { method: 'nip44Decrypt', timestamp: 1, decision: 'approved', pubkey: 'ff'.repeat(32), ciphertext: 'ciphertext' };
  await browser.storage.local.set({ activityLog: [entry] });
  await assert.rejects(() => handlers.get('activity_decrypt')!({entryKey: activityEntryKey(entry)}), /no longer on this device/i);
  delete entry.ciphertext;
  await browser.storage.local.set({ activityLog: [entry] });
  await assert.rejects(() => handlers.get('activity_decrypt')!({entryKey: activityEntryKey(entry)}), /No encrypted content/i);
  await vault.destroy();
  await vault.create('', { accounts: [owner], activeAccountId: owner.id });
  await assert.rejects(() => decryptForAccount(owner.id, 'nip44', 'bad', 'x'), /Invalid peer/i);
});

it('successful crypto requests retain ciphertext, never the plaintext result or input', async () => {
  const { handlers: nip07 } = await import('../src/lib/bg/nip07-handlers.ts');
  const permissions = await import('../src/lib/permissions.ts');
  const { config } = await import('../src/lib/bg/state.ts');
  const owner = await importNsec(ownerKey, 'Owner');
  const peer = await importNsec(peerKey, 'Peer');
  await vault.create('', { accounts: [owner], activeAccountId: owner.id });
  await browser.storage.local.set({accounts: [owner], activeAccountId: owner.id});
  config.myPubkey = owner.pubkey;
  for (const scheme of ['nip04', 'nip44']) {
    await permissions.save('site.test', `${scheme}Encrypt`, null, 'allow', owner.id);
    await permissions.save('site.test', `${scheme}Decrypt`, null, 'allow', owner.id);
    const ciphertext = await nip07.get(`nip07_${scheme}Encrypt`)!({origin: 'site.test', pubkey: peer.pubkey, plaintext: 'never persist this'}) as string;
    await new Promise(resolve => setTimeout(resolve, 10));
    const result = await nip07.get(`nip07_${scheme}Decrypt`)!({origin: 'site.test', pubkey: peer.pubkey, ciphertext});
    assert.equal(result, 'never persist this');
    await new Promise(resolve => setTimeout(resolve, 10));
    const log = (await browser.storage.local.get('activityLog')).activityLog as ActivityEntry[];
    assert.equal(log[0].ciphertext, ciphertext);
    assert.equal(log[1].ciphertext, ciphertext);
    assert.equal(log[0].pubkey, owner.pubkey);
    assert.equal(JSON.stringify(log).includes('never persist this'), false);
  }
});
it('activity decryption remains internal to extension pages', async () => {
  const { buildPrivilegedMethods } = await import('../src/lib/bg/state.ts');
  const { handlers: misc } = await import('../src/lib/bg/misc-handlers.ts');
  assert.equal(buildPrivilegedMethods(misc).has('activity_decrypt'), true);
});
