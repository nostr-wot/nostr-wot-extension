/**
 * LNbits auto-provisioning tests
 *
 * Tests provisionLnbitsWallet() which uses a two-step challenge-response:
 *   1. POST /api/v2/provision/challenge → body-bound challenge + transaction token
 *   2. Sign challenge with signFn → kind:27235 event
 *   3. POST /api/v2/provision with { name } and Authorization header
 *
 * Run with:
 *   node --import tsx --test tests/wallet/lnbits-provision.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { provisionLnbitsWallet, claimLightningAddress, getLightningAddress, releaseLightningAddress } from '../../src/services/wallet/lnbits-provision.ts';
import { DEFAULT_LNBITS_URL } from '@constants/wallet.ts';
import type { WalletAuthProof } from '../../src/services/wallet/lnbits-provision.ts';
import { createHash } from 'node:crypto';
import type { SignedEvent } from '../../src/domain/nostr/types.ts';

const FAKE_CHALLENGE = 'a'.repeat(64);
const TRANSACTION_TOKEN = 'b'.repeat(64);
const challengeResponse = () => ({version:2,challenge:FAKE_CHALLENGE,transactionToken:TRANSACTION_TOKEN,expiresAt:Math.floor(Date.now()/1000)+60});

const FAKE_SIGNED_EVENT: SignedEvent = {
  id: 'event-id-123',
  pubkey: 'pubkey-abc',
  created_at: 1700000000,
  kind: 27235,
  tags: [['challenge', FAKE_CHALLENGE], ['u', 'https://zaps.example.com/api/v2/provision']],
  content: '',
  sig: 'sig-xyz',
};

function createMockSignFn(expectedChallenge?: string) {
  let called = false;
  let receivedChallenge = '';
  const signFn = async ({challenge,payload,transaction}: WalletAuthProof): Promise<SignedEvent> => {
    assert.match(payload,/^[a-f0-9]{64}$/);
    assert.equal(transaction,createHash('sha256').update(TRANSACTION_TOKEN).digest('hex'));
    called = true;
    receivedChallenge = challenge;
    if (expectedChallenge !== undefined) {
      assert.strictEqual(challenge, expectedChallenge);
    }
    return FAKE_SIGNED_EVENT;
  };
  return { signFn, wasCalled: () => called, getChallenge: () => receivedChallenge };
}

describe('provisionLnbitsWallet', () => {
  it('fetches challenge, calls signFn, sends an exact body hash and a separate authentication header', async () => {
    const { signFn, wasCalled } = createMockSignFn(FAKE_CHALLENGE);
    let postBody: Record<string, unknown> | null = null;

    const mockFetch = async (url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        // Challenge endpoint
        assert.strictEqual(url, 'https://zaps.example.com/api/v2/provision/challenge');
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      // Provision endpoint
      assert.strictEqual(url, 'https://zaps.example.com/api/v2/provision');
      assert.strictEqual(init?.method, 'POST');
      const headers = init?.headers as Record<string, string>;
      assert.strictEqual(headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(atob(headers.Authorization.slice(6))),FAKE_SIGNED_EVENT);
      assert.equal(headers['X-Nostr-Transaction'],TRANSACTION_TOKEN);
      postBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        id: 'wallet-id-123',
        name: 'WoT:npub1abc1234',
        adminkey: 'admin-key-abc',
        inkey: 'invoice-key-xyz',
        balance_msat: 0,
        user: 'user-id-456',
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet(
      'https://zaps.example.com',
      'WoT:npub1abc1234',
      signFn,
      mockFetch as typeof fetch,
    );

    assert.strictEqual(result.adminKey, 'admin-key-abc');
    assert.strictEqual(result.walletId, 'wallet-id-123');
    assert.strictEqual(wasCalled(), true);
    assert.ok(postBody);
    assert.strictEqual((postBody as Record<string, unknown>).name, 'WoT:npub1abc1234');
    assert.equal((postBody as Record<string, unknown>).event, undefined);
  });

  it('strips trailing slashes from instance URL', async () => {
    const capturedUrls: string[] = [];
    const { signFn } = createMockSignFn();

    const mockFetch = async (url: string, init?: RequestInit) => {
      capturedUrls.push(url);
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test', balance_msat: 0, user: 'u1',
      }), { status: 201 });
    };

    await provisionLnbitsWallet('https://zaps.example.com/', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(capturedUrls[0], 'https://zaps.example.com/api/v2/provision/challenge');
    assert.strictEqual(capturedUrls[1], 'https://zaps.example.com/api/v2/provision');
  });

  it('throws on challenge request failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async () => new Response('Service Unavailable', { status: 503 });
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message.includes('challenge request failed') && err.message.includes('503'),
    );
  });

  it('throws on provision POST failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message.includes('Wallet provisioning failed: 403'),
    );
  });

  it('throws on network error', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async () => { throw new Error('Network error'); };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      { message: 'Network error' },
    );
  });

  it('throws when signFn throws', async () => {
    const failSignFn = async () => { throw new Error('No private key'); };
    const mockFetch = async () => {
      return new Response(JSON.stringify(challengeResponse()), { status: 200 });
    };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', failSignFn, mockFetch as typeof fetch),
      { message: 'No private key' },
    );
  });

  it('returns nwcUri when present in provision response', async () => {
    const { signFn } = createMockSignFn();
    const nwcUri = 'nostr+walletconnect://pubkey?relay=wss://relay.test&secret=abc';

    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test',
        balance_msat: 0, user: 'u1', nwcUri,
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(result.nwcUri, nwcUri);
  });

  it('returns undefined nwcUri when not present in response', async () => {
    const { signFn } = createMockSignFn();

    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test',
        balance_msat: 0, user: 'u1',
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(result.nwcUri, undefined);
  });

  it('exports DEFAULT_LNBITS_URL pointing to zaps.nostr-wot.com', () => {
    assert.strictEqual(typeof DEFAULT_LNBITS_URL, 'string');
    assert.strictEqual(DEFAULT_LNBITS_URL, 'https://zaps.nostr-wot.com');
  });
});

describe('claimLightningAddress', () => {
  it('fetches challenge, signs, sends POST with a body-bound username', async () => {
    const { signFn, wasCalled } = createMockSignFn(FAKE_CHALLENGE);
    let postBody: Record<string, unknown> | null = null;

    const mockFetch = async (url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      assert.strictEqual(url, 'https://zaps.example.com/api/v2/claim-username');
      postBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ address: 'alice@zaps.nostr-wot.com' }), { status: 200 });
    };

    const result = await claimLightningAddress(
      'https://zaps.example.com', 'alice', signFn, mockFetch as typeof fetch,
    );
    assert.strictEqual(result.address, 'alice@zaps.nostr-wot.com');
    assert.strictEqual(wasCalled(), true);
    assert.ok(postBody);
    assert.strictEqual((postBody as Record<string, unknown>).username, 'alice');
    assert.equal((postBody as Record<string, unknown>).event, undefined);
  });

  it('throws server error message when claim fails', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 409 });
    };
    await assert.rejects(
      () => claimLightningAddress('https://zaps.example.com', 'alice', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message === 'Username already taken',
    );
  });

  it('throws generic error when claim response has no error field', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response('Bad Request', { status: 400 });
    };
    await assert.rejects(
      () => claimLightningAddress('https://zaps.example.com', 'alice', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message === 'Claim failed: 400',
    );
  });

  it('throws on challenge failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async () => new Response('Down', { status: 503 });
    await assert.rejects(
      () => claimLightningAddress('https://zaps.example.com', 'alice', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message.includes('challenge request failed') && err.message.includes('503'),
    );
  });
});

describe('getLightningAddress', () => {
  it('returns address when found', async () => {
    const mockFetch = async (url: string) => {
      assert.ok(url.includes('pubkey=abc123'));
      return new Response(JSON.stringify({ address: 'bob@zaps.nostr-wot.com' }), { status: 200 });
    };
    const result = await getLightningAddress('https://zaps.example.com', 'abc123', mockFetch as typeof fetch);
    assert.strictEqual(result, 'bob@zaps.nostr-wot.com');
  });

  it('returns null when no address exists', async () => {
    const mockFetch = async () => {
      return new Response(JSON.stringify({ address: null }), { status: 200 });
    };
    const result = await getLightningAddress('https://zaps.example.com', 'abc123', mockFetch as typeof fetch);
    assert.strictEqual(result, null);
  });

  it('rejects server errors instead of claiming the address is missing', async () => {
    const mockFetch = async () => new Response('Error', { status: 500 });
    await assert.rejects(() => getLightningAddress('https://zaps.example.com', 'abc123', mockFetch as typeof fetch), /500/);
  });
});

describe('releaseLightningAddress', () => {
  it('fetches challenge, signs, sends POST to release endpoint', async () => {
    const { signFn, wasCalled } = createMockSignFn(FAKE_CHALLENGE);
    let postUrl = '';

    const mockFetch = async (url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      postUrl = url;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await releaseLightningAddress('https://zaps.example.com', signFn, mockFetch as typeof fetch);
    assert.strictEqual(wasCalled(), true);
    assert.strictEqual(postUrl, 'https://zaps.example.com/api/v2/release-username');
  });

  it('throws on release failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!(init?.headers as Record<string,string>)?.Authorization) {
        return new Response(JSON.stringify(challengeResponse()), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    };
    await assert.rejects(
      () => releaseLightningAddress('https://zaps.example.com', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message === 'Release failed: 404',
    );
  });
});

describe('provisioning transport boundaries', () => {
  it('rejects insecure URLs in every helper before fetching or signing', async () => {
    let calls = 0;
    const fetchFn = (async () => { calls++; return new Response('{"challenge":"abcd","id":"id","adminkey":"key","address":null}'); }) as typeof fetch;
    const signFn = async () => { calls++; return FAKE_SIGNED_EVENT; };
    for (const url of ['http://remote.test', 'http://localhost.evil.test', 'https://user:pass@remote.test', 'https://remote.test/?redirect=x']) {
      await assert.rejects(provisionLnbitsWallet(url, 'test', signFn, fetchFn));
      await assert.rejects(claimLightningAddress(url, 'test', signFn, fetchFn));
      await assert.rejects(releaseLightningAddress(url, signFn, fetchFn));
      await assert.rejects(getLightningAddress(url, 'pubkey', fetchFn));
    }
    assert.equal(calls, 0);
  });
  it('rejects malformed challenges before signing', async () => {
    for (const challenge of [null, 23, '', {}, 'a'.repeat(4097)]) {
      const { signFn, wasCalled } = createMockSignFn();
      await assert.rejects(provisionLnbitsWallet('https://wallet.test', 'test', signFn,
        (async () => new Response(JSON.stringify({ challenge }))) as typeof fetch), /challenge/i);
      assert.equal(wasCalled(), false);
    }
  });
  it('rejects malformed provisioning credentials', async () => {
    for (const body of [null, {}, {id: 'id', adminkey: 123}, {id:'id', adminkey:'key', nwcUri:'https://bad.test'}]) {
      const fetchFn = (async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify((init?.headers as Record<string,string>)?.Authorization ? body : challengeResponse()))) as typeof fetch;
      await assert.rejects(provisionLnbitsWallet('https://wallet.test', 'test', createMockSignFn().signFn, fetchFn), /response/i);
    }
  });
});

it('uses redirect refusal for challenge, provisioning, claim, lookup and release', async () => {
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ ...challengeResponse(), id: 'id', adminkey: 'key', address: 'alice@example.test' }));
  }) as typeof fetch;
  const { signFn } = createMockSignFn();
  await provisionLnbitsWallet('http://127.0.0.1:1234', 'test', signFn, fetchFn);
  await claimLightningAddress('http://localhost:1234', 'alice', signFn, fetchFn);
  await getLightningAddress('https://wallet.test', 'pubkey', fetchFn);
  await releaseLightningAddress('https://wallet.test', signFn, fetchFn);
});

it('rejects malformed address responses', async () => {
  for (const address of [undefined, 32, {}, 'no-domain']) {
    await assert.rejects(getLightningAddress('https://wallet.test', 'key',
      (async () => new Response(JSON.stringify({ address }))) as typeof fetch), /response/i);
  }
});

it('binds the exact bytes for provision, claim and release before signing', async () => {
  for (const [operation,body,invoke] of [
    ['provision',{name:'Wallet é'},(sign: any,fetch: typeof globalThis.fetch)=>provisionLnbitsWallet('https://wallet.test','Wallet é',sign,fetch)],
    ['claim-username',{username:'alice'},(sign: any,fetch: typeof globalThis.fetch)=>claimLightningAddress('https://wallet.test','alice',sign,fetch)],
    ['release-username',{},(sign: any,fetch: typeof globalThis.fetch)=>releaseLightningAddress('https://wallet.test',sign,fetch)],
  ] as const) {
    let proof: WalletAuthProof | undefined;
    const bytes=JSON.stringify(body);const hash=createHash('sha256').update(bytes).digest('hex');
    const mockFetch=(async(url:string,init:RequestInit)=>{
      assert.equal(init.redirect,'error');
      if(url.endsWith('/challenge')) {
        assert.deepEqual(JSON.parse(init.body as string),{url:`https://wallet.test/api/v2/${operation}`,method:'POST',payload:hash});
        return new Response(JSON.stringify(challengeResponse()));
      }
      assert.equal(init.body,bytes);assert.equal(proof?.payload,hash);
      const headers=new Headers(init.headers);assert.equal(headers.get('X-Nostr-Transaction'),TRANSACTION_TOKEN);
      assert.equal(JSON.parse(atob(headers.get('Authorization')!.slice(6))).tags.find((tag:string[])=>tag[0]==='payload')[1],hash);
      assert.ok(!String(init.body).includes(TRANSACTION_TOKEN));
      return new Response(JSON.stringify({id:'wallet',adminkey:'key',address:'alice@wallet.test'}));
    }) as typeof fetch;
    await invoke(async(value:WalletAuthProof)=>{proof=value;return {...FAKE_SIGNED_EVENT,tags:[['payload',value.payload]]};},mockFetch);
  }
});

it('does not downgrade when the backend lacks v2 and never signs malformed or expired transactions', async () => {
  for (const response of [new Response('upgrade',{status:426}),new Response('missing',{status:404}),
    new Response(JSON.stringify({...challengeResponse(),version:1})),
    new Response(JSON.stringify({...challengeResponse(),transactionToken:'bad'})),
    new Response(JSON.stringify({...challengeResponse(),expiresAt:Math.floor(Date.now()/1000)-1})),
    new Response(JSON.stringify({...challengeResponse(),expiresAt:Math.floor(Date.now()/1000)+600})),
  ]) {
    let calls=0;let signatures=0;
    await assert.rejects(provisionLnbitsWallet('https://wallet.test','name',async()=>{signatures++;return FAKE_SIGNED_EVENT;},(async()=>{calls++;return response;}) as typeof fetch));
    assert.equal(calls,1);assert.equal(signatures,0);
  }
});

it('refuses an expired transaction after signing and before posting', async t => {
  const now=Date.now();let calls=0;
  t.mock.method(Date,'now',()=>now);
  const sign=async()=>{t.mock.method(Date,'now',()=>now+61_000);return FAKE_SIGNED_EVENT;};
  await assert.rejects(provisionLnbitsWallet('https://wallet.test','name',sign,(async()=>{calls++;return new Response(JSON.stringify(challengeResponse()));}) as typeof fetch),/expired/);
  assert.equal(calls,1);
});
