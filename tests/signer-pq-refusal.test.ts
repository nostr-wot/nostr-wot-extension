/**
 * signer-pq-refusal.test.ts — accounts that cannot do post-quantum must say so
 *
 * `window.nostr.nip44.schemes` advertises what this *signer* accepts, not what the
 * *selected account* can perform, so a caller that correctly detected `pq` support can
 * still make a request the active account cannot answer. What must never happen is that
 * such a request comes back as ordinary NIP-44 ciphertext, because the caller has no way
 * to tell the two apart and would show the user a post-quantum badge over a classic
 * message. See nips/04-nip07-encryption-capability.md.
 *
 * The NIP-46 case is the dangerous one and the reason this file exists. Remote-signer
 * accounts are routed to the bunker inside handleCryptoRequest and never reach the
 * post-quantum crypto callback at all, so a guard placed there would never run. The
 * bunker happily answers `nip44Encrypt` with classic ciphertext, which is precisely the
 * silent downgrade the whole scheme is built to prevent.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browserMock from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.ts';
import * as permissions from '../lib/permissions.ts';
import * as signer from '../lib/signer.ts';
import { arrayToBase64 } from '../lib/crypto/utils.ts';
import type { VaultPayload } from '../lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const THEIR_PUBKEY_HEX = 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';

const TWELVE_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/**
 * The refusals under test all fire before the recipient's key is decoded, so its
 * contents are irrelevant. A real one is 1568 bytes of base64.
 */
const DUMMY_KEM_KEY = arrayToBase64(new Uint8Array(1568));

const PQ_OPTS = { scheme: 'pq' as const, recipientKemKey: DUMMY_KEM_KEY };

/**
 * A payload `isPqEnvelope` accepts: version 0x01, algorithm 0x01, long enough to hold a
 * KEM ciphertext, a nonce and a tag. It never gets decrypted in these tests.
 */
function makePqEnvelope(): string {
  const bytes = new Uint8Array(1700);
  bytes[0] = 0x01;
  bytes[1] = 0x01;
  return arrayToBase64(bytes);
}

function localAccount(overrides: Partial<VaultPayload['accounts'][0]> = {}): VaultPayload {
  return {
    accounts: [{
      id: 'acct1',
      name: 'Test',
      type: 'nsec',
      pubkey: TEST_PUBKEY_HEX,
      privkey: TEST_PRIVKEY_HEX,
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 1000000,
      ...overrides,
    }],
    activeAccountId: 'acct1',
  } as VaultPayload;
}

describe('post-quantum on a NIP-46 account', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
    await browserMock.storage.local.set({
      accounts: [{ id: 'n1', type: 'nip46', pubkey: TEST_PUBKEY_HEX }],
      activeAccountId: 'n1',
    });
  });

  it('refuses a post-quantum encrypt instead of delegating to the bunker', async () => {
    await permissions.save('chat.com', 'nip44Encrypt', null, 'allow');
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'chat.com', PQ_OPTS),
      /Remote signers do not support post-quantum/,
    );
  });

  it('refuses to decrypt a post-quantum envelope', async () => {
    await permissions.save('chat.com', 'nip44Decrypt', null, 'allow');
    await assert.rejects(
      signer.handleNip44Decrypt(THEIR_PUBKEY_HEX, makePqEnvelope(), 'chat.com'),
      /Remote signers cannot read post-quantum/,
    );
  });

  it('still routes a classic nip44 encrypt to the bunker', async () => {
    // The guard must be scoped to post-quantum. If it leaked into the classic path it
    // would break every remote-signer account's ordinary DMs.
    await permissions.save('chat.com', 'nip44Encrypt', null, 'allow');
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'chat.com'),
      (err: Error) => !/post-quantum/.test(err.message),
      'a classic request must fail for bunker reasons, not post-quantum ones',
    );
  });

  it('applies a per-origin deny before disclosing the account type', async () => {
    // An origin that is not allowed to encrypt at all must not learn that this account
    // is a remote signer. The permission gate comes first.
    await permissions.save('evil.com', 'nip44Encrypt', null, 'deny');
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'evil.com', PQ_OPTS),
      /Permission denied/,
    );
  });
});

describe('post-quantum on a local account that cannot derive', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  async function setup(payload: VaultPayload): Promise<void> {
    await vault.create(TEST_PASSWORD, payload);
    await browserMock.storage.local.set({
      accounts: [{ id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX }],
      activeAccountId: 'acct1',
    });
    await permissions.save('chat.com', 'nip44Encrypt', null, 'allow');
  }

  it('refuses a 12-word account and names the reason', async () => {
    await setup(localAccount({ mnemonic: TWELVE_WORDS }));
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'chat.com', PQ_OPTS),
      /24-word seed phrase/,
    );
  });

  it('refuses an account with no seed and names the reason', async () => {
    await setup(localAccount({ mnemonic: null }));
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'chat.com', PQ_OPTS),
      /no seed phrase/,
    );
  });

  it('refuses a read-only account that still holds a private key', async () => {
    // getPrivkey() keys off privkeyBytes, not the readOnly flag, so such an account
    // reaches the crypto callback and has to be stopped there.
    await setup(localAccount({ readOnly: true }));
    await assert.rejects(
      signer.handleNip44Encrypt(THEIR_PUBKEY_HEX, 'hello', 'chat.com', PQ_OPTS),
      /watch-only/,
    );
  });

  it('leaves classic nip44 encryption working on the same account', async () => {
    await setup(localAccount({ mnemonic: TWELVE_WORDS }));
    // A real x-only pubkey, unlike THEIR_PUBKEY_HEX: the refusals above reject before
    // any curve operation, but this path performs an actual ECDH and needs a valid point.
    const ciphertext: string = await signer.handleNip44Encrypt(TEST_PUBKEY_HEX, 'hello', 'chat.com');
    assert.ok(ciphertext.length > 0, 'classic encryption must be unaffected');
  });
});
