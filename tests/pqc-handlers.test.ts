import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as vault from '../lib/vault.ts';
import { handlers, PQC_KIND } from '../lib/bg/pqc-handlers.ts';
import { createFromMnemonic, importNsec, importNpub } from '../lib/accounts.ts';
import { verifyPop, popMessage } from '../lib/crypto/pq.ts';
import browserMock, { resetMockStorage } from './helpers/browser-mock.ts';

const PASSWORD = 'test-password-1234';

const M24 =
  'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
const M12 = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const SOME_PRIVKEY = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';

const getStatus = () => handlers.get('pqc_getStatus')!({}) as Promise<any>;
const bin = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));

async function vaultWith(account: any) {
  await vault.destroy();
  await vault.create(PASSWORD, { accounts: [account], activeAccountId: account.id });
  await browserMock.storage.local.set({ activeAccountId: account.id });
}

describe('pqc_getStatus', () => {
  beforeEach(async () => {
    resetMockStorage();
    await vault.destroy();
  });

  it('derives keys and a valid attestation for a 24-word account', async () => {
    await vaultWith(await createFromMnemonic(M24, 'Main'));
    const s = await getStatus();

    assert.strictEqual(s.canDerive, true);
    assert.strictEqual(s.reason, null);
    assert.strictEqual(s.wordCount, 24);
    assert.strictEqual(s.attestation.kind, PQC_KIND);

    const tag = (n: string) => s.attestation.tags.find((t: string[]) => t[0] === n);
    assert.deepStrictEqual(tag('origin'), ['origin', 'derived']);
    assert.deepStrictEqual(tag('seed_strength'), ['seed_strength', '256']);

    // The attestation it hands the UI must actually verify.
    const alg = (n: string) =>
      s.attestation.tags.find((t: string[]) => t[0] === 'alg' && t[1] === n)[2];
    assert.ok(
      verifyPop(
        bin(tag('pop')[2]),
        popMessage(s.pubkey, alg('ml-kem-1024'), alg('ml-dsa-87')),
        bin(alg('ml-dsa-87')),
      ),
      'proof of possession must verify',
    );
  });

  it('never returns secret key material', async () => {
    await vaultWith(await createFromMnemonic(M24, 'Main'));
    const s = await getStatus();
    const blob = JSON.stringify(s);
    assert.ok(!/secret/i.test(blob), 'response must not mention secrets');
    assert.deepStrictEqual(Object.keys(s.keys).sort(), ['dsa', 'kem']);
  });

  it('refuses a 12-word account and says why', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    const s = await getStatus();
    assert.strictEqual(s.canDerive, false);
    assert.strictEqual(s.reason, 'short-seed');
    assert.strictEqual(s.wordCount, 12);
    assert.strictEqual(s.keys, null);
    assert.strictEqual(s.attestation, null);
  });

  it('refuses an nsec-imported account (no seed)', async () => {
    await vaultWith(await importNsec(SOME_PRIVKEY, 'Imported'));
    const s = await getStatus();
    assert.strictEqual(s.canDerive, false);
    assert.strictEqual(s.reason, 'no-seed');
  });

  it('refuses a watch-only account', async () => {
    const acct = importNpub(
      'npub16sdj9zv4f8sl85e45vgq9n7nsgt5qphpvmf7vk8r5hhvmdjxx4es8rq74h',
      'Watch',
    );
    await vaultWith(acct);
    const s = await getStatus();
    assert.strictEqual(s.canDerive, false);
    assert.strictEqual(s.reason, 'read-only');
  });

  it('throws when the vault is locked', async () => {
    await vaultWith(await createFromMnemonic(M24, 'Main'));
    vault.lock();
    await assert.rejects(() => getStatus(), /locked/i);
  });

  it('is deterministic across calls', async () => {
    await vaultWith(await createFromMnemonic(M24, 'Main'));
    const a = await getStatus();
    const b = await getStatus();
    assert.deepStrictEqual(a.keys, b.keys);
  });
});

// ── Importing keys for an account that cannot derive ──

import { derivePqKeys, PQ_PROFILE, ALG_KEM, ALG_DSA } from '../lib/crypto/pq.ts';
import { arrayToBase64 } from '../lib/crypto/utils.ts';

const importKeys = (keyfile: string) => handlers.get('pqc_importKeys')!({ keyfile }) as Promise<any>;
const removeKeys = () => handlers.get('pqc_removeImportedKeys')!({}) as Promise<any>;

function keyfile(seedFill = 5): string {
  const { kem, dsa } = derivePqKeys(new Uint8Array(64).fill(seedFill), 0);
  return JSON.stringify({
    v: PQ_PROFILE,
    origin: 'independent',
    alg: { kem: ALG_KEM, dsa: ALG_DSA },
    kem: { public: arrayToBase64(kem.publicKey), secret: arrayToBase64(kem.secretKey) },
    dsa: { public: arrayToBase64(dsa.publicKey), secret: arrayToBase64(dsa.secretKey) },
  });
}

describe('pqc_importKeys', () => {
  beforeEach(async () => {
    resetMockStorage();
    await vault.destroy();
  });

  it('offers import to the accounts that cannot derive', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    assert.strictEqual((await getStatus()).canImport, true, '12-word account may import');

    await vaultWith(await importNsec(SOME_PRIVKEY, 'Imported'));
    assert.strictEqual((await getStatus()).canImport, true, 'nsec account may import');
  });

  it('does not offer import where the keys could never be used', async () => {
    await vaultWith(await importNpub(
      'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9', 'Watch'));
    let s = await getStatus();
    assert.strictEqual(s.reason, 'read-only');
    assert.strictEqual(s.canImport, false, 'a read-only account cannot sign or decrypt');

    await vaultWith(await createFromMnemonic(M24, 'Main'));
    s = await getStatus();
    assert.strictEqual(s.canImport, false, 'a deriving account is not offered an override');
  });

  it('imports a valid key file and reports the keys as imported', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    const s = await importKeys(keyfile());

    assert.strictEqual(s.canDerive, true);
    assert.strictEqual(s.source, 'imported');
    assert.strictEqual(s.canImport, false);
    assert.strictEqual(s.reason, null);
    assert.ok(s.keys.kem && s.keys.dsa);

    // Attestation must carry the independent provenance and NO seed strength claim.
    const tag = (n: string) => s.attestation.tags.find((t: string[]) => t[0] === n);
    assert.deepStrictEqual(tag('origin'), ['origin', 'independent']);
    assert.strictEqual(tag('seed_strength'), undefined, 'imported keys claim no seed strength');

    // And its proof of possession must verify against the imported DSA key.
    const alg = (n: string) => s.attestation.tags.find((t: string[]) => t[0] === 'alg' && t[1] === n)[2];
    assert.ok(verifyPop(
      bin(tag('pop')[2]),
      popMessage(s.pubkey, alg(ALG_KEM), alg(ALG_DSA)),
      bin(alg(ALG_DSA)),
    ), 'proof of possession must verify');
  });

  it('survives a lock/unlock cycle', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    const before = await importKeys(keyfile());
    vault.lock();
    await vault.unlock(PASSWORD);
    const after = await getStatus();
    assert.strictEqual(after.source, 'imported');
    assert.strictEqual(after.keys.kem, before.keys.kem, 'the same key came back');
  });

  it('rejects a mismatched key file without storing anything', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    const broken = JSON.parse(keyfile());
    broken.kem.public = JSON.parse(keyfile(9)).kem.public;
    await assert.rejects(() => importKeys(JSON.stringify(broken)), /do not match/i);
    assert.strictEqual((await getStatus()).source, null, 'nothing was stored');
  });

  it('refuses to import over a deriving account', async () => {
    await vaultWith(await createFromMnemonic(M24, 'Main'));
    await assert.rejects(() => importKeys(keyfile()), /cannot use imported|already has/i);
  });

  it('refuses a second import while keys are present', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    await importKeys(keyfile());
    await assert.rejects(() => importKeys(keyfile(9)), /already has/i);
  });

  it('never returns secret key material', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    const s = await importKeys(keyfile());
    assert.ok(!/secret/i.test(JSON.stringify(s)), 'response must not mention secrets');
    const { kem } = derivePqKeys(new Uint8Array(64).fill(5), 0);
    assert.ok(!JSON.stringify(s).includes(arrayToBase64(kem.secretKey)), 'no secret key in the response');
  });

  it('keeps imported secrets out of the account list', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    await importKeys(keyfile());
    const { kem } = derivePqKeys(new Uint8Array(64).fill(5), 0);
    // Every SafeAccount the UI can reach must be free of the imported secrets.
    const listed = JSON.stringify([vault.getActiveAccount(), vault.getActiveAccountWithWallet(),
      vault.getAccountById(vault.getActiveAccountId()!)]);
    assert.ok(!listed.includes(arrayToBase64(kem.secretKey)), 'SafeAccount must not carry pq secrets');
    assert.ok(!/pqKemSecret|pqDsaSecret|pqKeys|pqPublic/.test(listed), 'no pq fields on SafeAccount');
  });
});

describe('pqc_removeImportedKeys', () => {
  beforeEach(async () => {
    resetMockStorage();
    await vault.destroy();
  });

  it('removes the keys and restores the import offer', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    await importKeys(keyfile());
    assert.deepStrictEqual(await removeKeys(), { removed: true });

    const s = await getStatus();
    assert.strictEqual(s.source, null);
    assert.strictEqual(s.canDerive, false);
    assert.strictEqual(s.reason, 'short-seed');
    assert.strictEqual(s.canImport, true, 'the account may import again');
  });

  it('reports nothing to remove when there are no imported keys', async () => {
    await vaultWith(await createFromMnemonic(M12, 'Old'));
    assert.deepStrictEqual(await removeKeys(), { removed: false });
  });
});

// ── The point of the feature: imported keys must actually decrypt ──

import * as signer from '../lib/signer.ts';
import * as permissions from '../lib/permissions.ts';
import { pqEncrypt, KEM_PUBLIC_KEY_BYTES } from '../lib/crypto/pq.ts';
import { getConversationKey } from '../lib/crypto/nip44.ts';
import { getPublicKey } from '../lib/crypto/secp256k1.ts';
import { hexToBytes, bytesToHex, base64ToArray } from '../lib/crypto/utils.ts';

describe('imported keys decrypt a post-quantum message', () => {
  beforeEach(async () => {
    resetMockStorage();
    await vault.destroy();
  });

  it('reads an envelope encrypted to the imported ML-KEM key', async () => {
    // A 12-word account: it can never derive post-quantum keys, so before this feature
    // an envelope addressed to it was undecryptable by construction.
    const acct = await createFromMnemonic(M12, 'Old');
    await vaultWith(acct);
    const status = await importKeys(keyfile());
    assert.strictEqual(status.source, 'imported');
    assert.strictEqual(base64ToArray(status.keys.kem).length, KEM_PUBLIC_KEY_BYTES);

    await permissions.save('sender.example', 'nip44Decrypt', null, 'allow');

    // The sender: knows only the recipient's npub and the ML-KEM key from the
    // attestation, which is exactly what a real sender has.
    const senderPrivkey = hexToBytes(SOME_PRIVKEY);
    const senderPubkey = bytesToHex(getPublicKey(senderPrivkey));
    const conversationKey = getConversationKey(senderPrivkey, hexToBytes(acct.pubkey));
    const ciphertext = pqEncrypt(
      'the quantum adversary reads nothing',
      base64ToArray(status.keys.kem),
      conversationKey,
      senderPubkey,
      acct.pubkey,
    );

    const plaintext = await signer.handleNip44Decrypt(senderPubkey, ciphertext, 'sender.example');
    assert.strictEqual(plaintext, 'the quantum adversary reads nothing');
  });

  it('stops decrypting once the imported key is removed', async () => {
    const acct = await createFromMnemonic(M12, 'Old');
    await vaultWith(acct);
    const status = await importKeys(keyfile());
    await permissions.save('sender.example', 'nip44Decrypt', null, 'allow');

    const senderPrivkey = hexToBytes(SOME_PRIVKEY);
    const senderPubkey = bytesToHex(getPublicKey(senderPrivkey));
    const ciphertext = pqEncrypt(
      'still secret',
      base64ToArray(status.keys.kem),
      getConversationKey(senderPrivkey, hexToBytes(acct.pubkey)),
      senderPubkey,
      acct.pubkey,
    );

    await removeKeys();
    await assert.rejects(
      () => signer.handleNip44Decrypt(senderPubkey, ciphertext, 'sender.example'),
      /seed phrase/i,
      'without the key the account is back to having no post-quantum capability',
    );
  });
});
