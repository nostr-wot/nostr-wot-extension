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
