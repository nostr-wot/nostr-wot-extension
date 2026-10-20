import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachBridgeTab, type BridgeTabPort } from '../src/services/browser/localBridgeTab.ts';

function fixture() {
  const messages = new Set<(message: unknown) => void>();
  const disconnects = new Set<() => void>();
  const sent: unknown[] = [];
  const calls: unknown[] = [];
  const closes: string[] = [];
  let clientClosed = false;
  let deviceClosed: ((error: Error) => void) | undefined;
  const port: BridgeTabPort = { postMessage: (message) => { sent.push(message); }, disconnect: () => {},
    onMessage: { addListener: (fn) => { messages.add(fn); }, removeListener: (fn) => { messages.delete(fn); } },
    onDisconnect: { addListener: (fn) => { disconnects.add(fn); }, removeListener: (fn) => { disconnects.delete(fn); } },
  };
  const client = { request: async (method: string, params: string[]) => { calls.push([method, params]); return 'signed'; }, close: () => { clientClosed = true; }, onClose: (fn: (error: Error) => void) => { deviceClosed = fn; return () => { deviceClosed = undefined; }; } };
  const link = attachBridgeTab(client, port, 'a'.repeat(64), (reason) => { closes.push(reason); });
  return { link, sent, calls, closes, emit: (msg: unknown) => { for (const handler of messages) handler(msg); }, drop: () => { for (const handler of disconnects) handler(); }, radioDrop: () => deviceClosed?.(new Error('Radio lost')), closed: () => clientClosed };
}

test('document dispatches only after matching account registration, rejects malformed requests', async () => {
  const f = fixture();
  try {
    f.emit({ type: 'request', id: 'early', method: 'sign_event', params: ['{}'] });
    assert.equal(f.calls.length, 0);
    f.emit({ type: 'ready', pubkey: 'a'.repeat(64) });
    await f.link.ready;
    f.emit({ type: 'request', id: 'one', method: 'sign_event', params: ['{}'] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.calls, [['sign_event', ['{}']]]);
    assert.deepEqual(f.sent.at(-1), { type: 'response', id: 'one', result: 'signed' });
    f.emit({ type: 'request', id: 'bad', method: 'export_key', params: [] });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.sent.at(-1), { type: 'response', id: 'bad', error: 'Invalid or busy bridge request' });
  } finally { f.link.close(); }
  assert.ok(f.closed());
});

test('account mismatch and runtime disconnect tear down the encrypted client', async () => {
  const mismatch = fixture();
  mismatch.emit({ type: 'ready', pubkey: 'b'.repeat(64) });
  await assert.rejects(mismatch.link.ready, /does not match/);
  assert.ok(mismatch.closed());
  const disconnected = fixture();
  disconnected.drop();
  await assert.rejects(disconnected.link.ready, /disconnected/);
  assert.ok(disconnected.closed());
});

test('radio loss updates the document and disconnects the extension broker immediately', async () => {
  const f = fixture();
  f.emit({ type: 'ready', pubkey: 'a'.repeat(64) });
  await f.link.ready;
  f.radioDrop();
  assert.deepEqual(f.closes, ['Radio lost']);
  assert.ok(f.closed());
  f.link.close();
  assert.equal(f.closes.length, 1);
});
