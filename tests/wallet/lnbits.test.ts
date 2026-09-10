import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LnbitsProvider } from '../../src/services/wallet/lnbits.ts';

/** Helper to build a mock fetch that returns the given JSON body with status 200. */
function mockFetch(body: unknown, status = 200): (url: string, init?: RequestInit) => Promise<Response> {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

/** Helper that captures the arguments passed to fetch and returns a preset response. */
function capturingFetch(body: unknown, status = 200) {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fn = async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn, getCapturedUrl: () => capturedUrl, getCapturedInit: () => capturedInit };
}

describe('LnbitsProvider', () => {
  const config = { instanceUrl: 'https://lnbits.example.com', adminKey: 'testapikey123' };

  describe('getBalance', () => {
    it('returns balance in sats (converted from msats)', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 100_000 }));
      const result = await provider.getBalance();
      assert.deepEqual(result, { balance: 100 });
    });

    it('sends admin key in X-Api-Key header', async () => {
      const { fn, getCapturedInit } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(config, fn);
      await provider.getBalance();
      const headers = getCapturedInit()?.headers as Record<string, string>;
      assert.equal(headers['X-Api-Key'], 'testapikey123');
    });

    it('sends GET request to /api/v1/wallet', async () => {
      const { fn, getCapturedUrl, getCapturedInit } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(config, fn);
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
      assert.equal(getCapturedInit()?.method, 'GET');
    });
  });

  describe('getInfo', () => {
    it('returns alias and supported methods', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ name: 'My LNbits Wallet' }));
      const info = await provider.getInfo();
      assert.equal(info.alias, 'My LNbits Wallet');
      assert.deepEqual(info.methods, ['pay_invoice', 'get_balance', 'make_invoice']);
    });
  });

  describe('payInvoice', () => {
    it('sends bolt11 with out:true and returns preimage', async () => {
      const bolt11 = 'lnbc1pvjluezpp5qqqsyq...';
      const { fn, getCapturedInit } = capturingFetch({ preimage: 'abc123preimage' });
      const provider = new LnbitsProvider(config, fn);
      const result = await provider.payInvoice(bolt11);

      assert.equal(result.preimage, 'abc123preimage');
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, true);
      assert.equal(body.bolt11, bolt11);
    });

    it('sends POST request to /api/v1/payments', async () => {
      const { fn, getCapturedUrl, getCapturedInit } = capturingFetch({ preimage: 'x' });
      const provider = new LnbitsProvider(config, fn);
      await provider.payInvoice('lnbc1...');
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/payments');
      assert.equal(getCapturedInit()?.method, 'POST');
    });
  });

  describe('makeInvoice', () => {
    it('sends amount/memo with out:false and returns bolt11 + paymentHash', async () => {
      const { fn, getCapturedInit } = capturingFetch({
        payment_request: 'lnbc50n1...',
        payment_hash: 'hash123',
      });
      const provider = new LnbitsProvider(config, fn);
      const result = await provider.makeInvoice(50_000, 'test payment');

      assert.equal(result.bolt11, 'lnbc50n1...');
      assert.equal(result.paymentHash, 'hash123');
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, false);
      assert.equal(body.amount, 50_000);
      assert.equal(body.memo, 'test payment');
    });

    it('sends request without memo when not provided', async () => {
      const { fn, getCapturedInit } = capturingFetch({
        payment_request: 'lnbc1...',
        payment_hash: 'hash456',
      });
      const provider = new LnbitsProvider(config, fn);
      await provider.makeInvoice(1000);
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, false);
      assert.equal(body.amount, 1000);
      assert.equal(body.memo, undefined);
    });
  });

  describe('error handling', () => {
    it('throws on HTTP 401 error', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ detail: 'Unauthorized' }, 401));
      await assert.rejects(() => provider.getBalance(), (err: Error) => {
        assert.match(err.message, /401/);
        return true;
      });
    });

    it('throws on HTTP 500 error', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ detail: 'Internal' }, 500));
      await assert.rejects(() => provider.payInvoice('lnbc1...'), (err: Error) => {
        assert.match(err.message, /500/);
        return true;
      });
    });

    it('includes LNbits API error prefix in message', async () => {
      const provider = new LnbitsProvider(config, mockFetch({}, 403));
      await assert.rejects(() => provider.getInfo(), (err: Error) => {
        assert.match(err.message, /LNbits API error/);
        return true;
      });
    });
  });

  describe('connection state', () => {
    it('isConnected returns false initially', () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      assert.equal(provider.isConnected(), false);
    });

    it('isConnected returns true after connect()', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      await provider.connect();
      assert.equal(provider.isConnected(), true);
    });

    it('disconnect resets connection state', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      await provider.connect();
      assert.equal(provider.isConnected(), true);
      provider.disconnect();
      assert.equal(provider.isConnected(), false);
    });

    it('connect validates by calling getBalance', async () => {
      const provider = new LnbitsProvider(config, mockFetch({}, 401));
      await assert.rejects(() => provider.connect(), (err: Error) => {
        assert.match(err.message, /401/);
        return true;
      });
      assert.equal(provider.isConnected(), false);
    });
  });

  describe('transport security', () => {
    it('refuses to send the admin key over plain HTTP to a remote host', async () => {
      let fetchCalled = false;
      const fn = async (_url: string, _init?: RequestInit) => {
        fetchCalled = true;
        return new Response('{}', { status: 200 });
      };
      const provider = new LnbitsProvider(
        { instanceUrl: 'http://lnbits.example.com', adminKey: 'secretkey' },
        fn,
      );
      await assert.rejects(() => provider.getBalance(), (err: Error) => {
        assert.match(err.message, /insecure/);
        return true;
      });
      assert.equal(fetchCalled, false, 'admin key must never be sent over plain HTTP');
    });

    it('rejects non-http(s) schemes', async () => {
      const provider = new LnbitsProvider(
        { instanceUrl: 'ftp://lnbits.example.com', adminKey: 'secretkey' },
        mockFetch({ balance: 0 }),
      );
      await assert.rejects(() => provider.getBalance(), /insecure/);
    });

    it('rejects HTTP hosts that merely start with "localhost"', async () => {
      const provider = new LnbitsProvider(
        { instanceUrl: 'http://localhost.evil.com', adminKey: 'secretkey' },
        mockFetch({ balance: 0 }),
      );
      await assert.rejects(() => provider.getBalance(), /insecure/);
    });

    it('allows plain HTTP to localhost for local development', async () => {
      const provider = new LnbitsProvider(
        { instanceUrl: 'http://localhost:5000', adminKey: 'key' },
        mockFetch({ balance: 42_000 }),
      );
      const result = await provider.getBalance();
      assert.deepEqual(result, { balance: 42 });
    });

    it('allows plain HTTP to 127.0.0.1 for local development', async () => {
      const provider = new LnbitsProvider(
        { instanceUrl: 'http://127.0.0.1:5000', adminKey: 'key' },
        mockFetch({ balance: 42_000 }),
      );
      const result = await provider.getBalance();
      assert.deepEqual(result, { balance: 42 });
    });

    it('allows HTTPS to any host', async () => {
      const provider = new LnbitsProvider(
        { instanceUrl: 'https://lnbits.example.com', adminKey: 'key' },
        mockFetch({ balance: 1000 }),
      );
      const result = await provider.getBalance();
      assert.deepEqual(result, { balance: 1 });
    });
  });

  describe('URL normalization', () => {
    it('strips trailing slash from instanceUrl', async () => {
      const { fn, getCapturedUrl } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(
        { instanceUrl: 'https://lnbits.example.com/', adminKey: 'key' },
        fn,
      );
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
    });

    it('strips multiple trailing slashes from instanceUrl', async () => {
      const { fn, getCapturedUrl } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(
        { instanceUrl: 'https://lnbits.example.com///', adminKey: 'key' },
        fn,
      );
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
    });
  });

  describe('type field', () => {
    it('has type set to lnbits', () => {
      const provider = new LnbitsProvider(config, mockFetch({}));
      assert.equal(provider.type, 'lnbits');
    });
  });

  describe('listTransactions', () => {
    it('preserves raw page length and pending status for pagination', async () => {
      const rows = [
        { checking_id: 'a', payment_hash: 'a', bolt11: '', amount: 1000, fee: 0, memo: '', status: 'success', time: 1700000000, preimage: 'pa' },
        { checking_id: 'b', payment_hash: 'b', bolt11: '', amount: 2000, fee: 0, memo: '', status: 'pending', time: 1700000001, preimage: '' },
        { checking_id: 'c', payment_hash: 'c', bolt11: '', amount: 3000, fee: 0, memo: '', status: 'failed', time: 1700000002, preimage: '' },
      ];
      const provider = new LnbitsProvider(config, mockFetch(rows));
      const txs = await provider.listTransactions();
      assert.equal(txs.length, 3);
      assert.equal(txs[0].paymentHash, 'a');
      assert.equal(txs[0].status, 'settled');
      assert.equal(txs[1].paymentHash, 'b');
      assert.equal(txs[1].status, 'pending');
      assert.equal(txs[2].status, 'failed');
    });
  });

  describe('lookupInvoice', () => {
    it('returns paid:true with amount in sats when settled', async () => {
      const provider = new LnbitsProvider(
        config,
        mockFetch({ paid: true, preimage: 'xx', details: { amount: 50_000 } }),
      );
      const res = await provider.lookupInvoice('hash123');
      assert.equal(res.paid, true);
      assert.equal(res.amountPaid, 50);
    });

    it('returns paid:false when invoice is not yet paid', async () => {
      const provider = new LnbitsProvider(
        config,
        mockFetch({ paid: false, details: { amount: 10_000 } }),
      );
      const res = await provider.lookupInvoice('hash123');
      assert.equal(res.paid, false);
    });

    it('returns paid:false on 404 instead of throwing', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ detail: 'not found' }, 404));
      const res = await provider.lookupInvoice('missinghash');
      assert.deepEqual(res, { paid: false });
    });

    it('handles negative (outgoing) amounts', async () => {
      const provider = new LnbitsProvider(
        config,
        mockFetch({ paid: true, details: { amount: -25_000 } }),
      );
      const res = await provider.lookupInvoice('hash');
      assert.equal(res.paid, true);
      assert.equal(res.amountPaid, 25);
    });
  });
});

it('requests non-pending history from LNbits before pagination, newest first',async()=>{
 const {fn,getCapturedUrl}=capturingFetch([]);
 await new LnbitsProvider({instanceUrl:'https://wallet.test',adminKey:'test'},fn).listTransactions(50,100);
 const query=new URL(getCapturedUrl()).searchParams;
 assert.equal(query.get('status[ne]'),'pending'); assert.equal(query.get('limit'),'50'); assert.equal(query.get('offset'),'100');
 assert.equal(query.get('sortby'),'time'); assert.equal(query.get('direction'),'desc');
});

describe('LNbits credential lifetime', () => {
  it('refuses redirects before forwarding credentials', async () => {
    const { createServer } = await import('node:http');
    let leaked = false;
    const destination = createServer((_req, res) => { leaked = true; res.end('{"balance":0}'); });
    await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve));
    const destinationPort = (destination.address() as { port: number }).port;
    const server = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${destinationPort}/stolen` }); res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try {
      const provider = new LnbitsProvider({ instanceUrl: `http://127.0.0.1:${address.port}`, adminKey: 'synthetic' });
      await assert.rejects(provider.getBalance());
      assert.equal(leaked, false);
    } finally {
      server.closeAllConnections(); destination.closeAllConnections();
      await Promise.all([server, destination].map(s => new Promise<void>(resolve => s.close(() => resolve()))));
    }
  });

  it('disconnect permanently revokes all operations and reconnect', async () => {
    let requests = 0;
    const provider = new LnbitsProvider({ instanceUrl: 'https://wallet.test', adminKey: 'synthetic' }, async () => {
      requests++; return new Response('{"balance":0}');
    });
    await provider.connect();
    provider.disconnect();
    for (const operation of [() => provider.connect(), () => provider.getBalance(), () => provider.payInvoice('invoice'), () => provider.lookupInvoice('hash')]) {
      await assert.rejects(operation, /disconnect|disposed/i);
    }
    assert.equal(requests, 1);
  });

  it('disconnect aborts an in-flight connection and cannot resurrect it', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (response: Response) => void;
    const provider = new LnbitsProvider({ instanceUrl: 'https://wallet.test', adminKey: 'synthetic' }, async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(resolve => { finish = resolve; });
    });
    const connecting = provider.connect();
    provider.disconnect();
    finish(new Response('{"balance":0}'));
    await assert.rejects(connecting, /disconnect|disposed/i);
    assert.equal(signal?.aborted, true);
    assert.equal(provider.isConnected(), false);
  });
});

describe('bounded wallet HTTP responses', () => {
  it('rejects declared and streamed oversized bodies and cancels the stream', async () => {
    const { walletHttp } = await import('../../src/services/http/wallet.ts');
    for (const declared of [true, false]) {
      let canceled = false;
      const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(100))); },
        cancel() { canceled = true; },
      }), { headers: declared ? { 'content-length': '100' } : {} });
      await assert.rejects(walletHttp('https://wallet.test', {}, async () => response, 'HTTP', { maxBytes: 32 }), /too large/);
      assert.equal(canceled, true);
    }
  });
  it('bounds fetch and body stalls and aborts transport', async () => {
    const { walletHttp } = await import('../../src/services/http/wallet.ts');
    for (const stage of ['fetch', 'body']) {
      let signal: AbortSignal | undefined;
      await assert.rejects(walletHttp('https://wallet.test', {}, async (_url, init) => {
        signal = init?.signal ?? undefined;
        return stage === 'fetch' ? new Promise<Response>(() => {}) : new Response(new ReadableStream());
      }, 'HTTP', { timeoutMs: 5 }), /timed out/);
      assert.equal(signal?.aborted, true);
    }
  });
  it('rejects redirects regardless of destination and never requests a follow-up URL', async () => {
    for (const destination of ['https://wallet.test/other', 'https://thief.test/', 'http://wallet.test/']) {
      let calls = 0;
      const provider = new LnbitsProvider({ instanceUrl: 'https://wallet.test', adminKey: 'synthetic' }, async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, 'error');
        return new Response('', { status: 302, headers: { Location: destination } });
      });
      await assert.rejects(provider.getBalance(), /redirect/i);
      assert.equal(calls, 1);
    }
  });
});
