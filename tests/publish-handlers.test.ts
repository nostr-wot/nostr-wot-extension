/**
 * Tests for lib/bg/publish-handlers.ts — focused on the checkRelayHealth
 * handler's SSRF hardening (scheme allowlist + private-host rejection).
 *
 * Run with the browser mock:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/publish-handlers.test.ts
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
// Import the browser mock before any lib/ module so the loader-hook redirect
// resolves to the already-loaded mock module (same pattern as other bg tests).
import { resetMockStorage } from './helpers/browser-mock.ts';
import { handlers, isPrivateHost } from '../lib/bg/publish-handlers.ts';

const checkRelayHealth = handlers.get('checkRelayHealth')!;

// ── fetch stub ──

const originalFetch = globalThis.fetch;
let fetchedUrls: string[] = [];
let fetchResponseOk = true;

function stubFetch() {
  fetchedUrls = [];
  fetchResponseOk = true;
  globalThis.fetch = (async (url: any, _init?: any) => {
    fetchedUrls.push(String(url));
    return new Response('{}', { status: fetchResponseOk ? 200 : 500 });
  }) as typeof fetch;
}

describe('isPrivateHost', () => {
  it('rejects loopback and localhost variants', () => {
    assert.strictEqual(isPrivateHost('localhost'), true);
    assert.strictEqual(isPrivateHost('LOCALHOST'), true);
    assert.strictEqual(isPrivateHost('127.0.0.1'), true);
    assert.strictEqual(isPrivateHost('127.255.255.255'), true);
    assert.strictEqual(isPrivateHost('[::1]'), true);
    assert.strictEqual(isPrivateHost('::1'), true);
  });

  it('rejects private and link-local ranges', () => {
    assert.strictEqual(isPrivateHost('10.0.0.1'), true);
    assert.strictEqual(isPrivateHost('172.16.0.1'), true);
    assert.strictEqual(isPrivateHost('172.31.255.254'), true);
    assert.strictEqual(isPrivateHost('192.168.1.1'), true);
    assert.strictEqual(isPrivateHost('169.254.169.254'), true);
    assert.strictEqual(isPrivateHost('0.0.0.0'), true);
    assert.strictEqual(isPrivateHost('router.local'), true);
  });

  it('allows public hosts', () => {
    assert.strictEqual(isPrivateHost('relay.damus.io'), false);
    assert.strictEqual(isPrivateHost('1.1.1.1'), false);
    assert.strictEqual(isPrivateHost('172.15.0.1'), false);
    assert.strictEqual(isPrivateHost('172.32.0.1'), false);
    assert.strictEqual(isPrivateHost('192.169.0.1'), false);
    assert.strictEqual(isPrivateHost('mylocal.example.com'), false);
  });
});

describe('checkRelayHealth', () => {
  beforeEach(() => { resetMockStorage(); stubFetch(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('probes a wss relay over https', async () => {
    const result = await checkRelayHealth({ url: 'wss://relay.example.com/path?x=1' });
    assert.deepStrictEqual(result, { reachable: true });
    assert.deepStrictEqual(fetchedUrls, ['https://relay.example.com/path?x=1']);
  });

  it('probes a ws relay over http', async () => {
    const result = await checkRelayHealth({ url: 'ws://relay.example.com' });
    assert.deepStrictEqual(result, { reachable: true });
    assert.deepStrictEqual(fetchedUrls, ['http://relay.example.com/']);
  });

  it('reports unreachable on non-OK response', async () => {
    fetchResponseOk = false;
    const result = await checkRelayHealth({ url: 'wss://relay.example.com' });
    assert.deepStrictEqual(result, { reachable: false });
  });

  it('rejects non-websocket schemes without fetching', async () => {
    for (const url of [
      'https://internal.example.com',
      'http://internal.example.com',
      'file:///etc/passwd',
      'ftp://relay.example.com',
      'not a url',
    ]) {
      const result = await checkRelayHealth({ url });
      assert.deepStrictEqual(result, { reachable: false }, `should reject ${url}`);
    }
    assert.deepStrictEqual(fetchedUrls, [], 'must not fetch non-ws(s) URLs');
  });

  it('rejects private/loopback hosts without fetching', async () => {
    for (const url of [
      'wss://localhost:7777',
      'ws://127.0.0.1',
      'wss://10.1.2.3',
      'wss://172.16.5.5:8080',
      'wss://192.168.1.1',
      'wss://169.254.169.254',
      'wss://[::1]:4848',
      'wss://printer.local',
    ]) {
      const result = await checkRelayHealth({ url });
      assert.deepStrictEqual(result, { reachable: false }, `should reject ${url}`);
    }
    assert.deepStrictEqual(fetchedUrls, [], 'must not probe private hosts');
  });

  it('rejects non-string url params without fetching', async () => {
    const result = await checkRelayHealth({ url: 42 as unknown as string });
    assert.deepStrictEqual(result, { reachable: false });
    assert.deepStrictEqual(fetchedUrls, []);
  });
});
