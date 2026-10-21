import { BleFrameDecoder } from '../src/services/signing/localBridge/transports.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePairingUri,
  validateAddress,
  deriveKeys,
  transcript,
  encode64,
} from '../src/services/signing/localBridge/protocol.ts';
import { v2 as nip44 } from 'nostr-tools/nip44';
const host = '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa';
const peer = '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27';
const psk = encode64(new Uint8Array(32).fill(7));
test('pairing limits destinations and refuses downgrade or ambiguous offers', () => {
  assert.equal(parsePairingUri(`nwlan://${host}?v=2&addr=192.168.1.2:1234&psk=${psk}`).transport, 'wifi');
  assert.equal(parsePairingUri(`nwlan://${host}?v=2&transport=ble&psk=${psk}`).transport, 'ble');
  for (const a of ['example.com:123', '8.8.8.8:123', '127.1:123', '192.168.1.2:0', 'user@192.168.1.2:12', '192.168.1.2:12/path'])
    assert.throws(() => validateAddress(a));
  for (const query of [
    `v=1&addr=192.168.1.2:12&psk=${psk}`,
    `v=2&v=2&transport=ble&psk=${psk}`,
    `v=2&transport=ble&addr=192.168.1.2:12&psk=${psk}`,
  ])
    assert.throws(() => parsePairingUri(`nwlan://${host}?${query}`));
});
test('matches independently published wallet HKDF and payload vector', () => {
  const conv = nip44.utils.getConversationKey(new Uint8Array(32).fill(0x22), host);
  const keys = deriveKeys(
    conv,
    transcript('session', host, peer, encode64(new Uint8Array(16).fill(1)), encode64(new Uint8Array(16).fill(2))),
  );
  assert.equal(Buffer.from(keys.mac).toString('hex'), '19a1aaa843f38d370b96b75ff6149de8c792770450dd4b366f6adda73f9a710a');
  assert.equal(Buffer.from(keys.payload).toString('hex'), 'bc90367fb6a60933359de74a2c899e9c26bb6dd9f9067cd02e89474d105f5744');
});
test('BLE decoder reassembles split headers and coalesced frames, bounds lengths', () => {
  const d = new BleFrameDecoder();
  const bytes = new Uint8Array([0, 0, 0, 2, 123, 125, 0, 0, 0, 2, 123, 125]);
  assert.deepEqual(d.push(bytes.slice(0, 2)), []);
  assert.deepEqual(d.push(bytes.slice(2)), ['{}', '{}']);
  assert.throws(() => new BleFrameDecoder().push(new Uint8Array([0, 1, 0, 1])));
});

import { LocalBridgeClient, type BridgeTransport } from '../src/services/signing/localBridge/client.ts';
import { createBleTransport, type BleDevice, type BleCharacteristic } from '../src/services/signing/localBridge/transports.ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { extract, expand } from '@noble/hashes/hkdf.js';
import { base64urlnopad } from '@scure/base';
const enc = new TextEncoder();
// Independent device-side wire implementation; no production transcript/MAC helpers.
class Device implements BridgeTransport {
  messages = new Set<(text: string) => void>();
  closes = new Set<(error?: Error) => void>();
  keys?: { mac: Uint8Array; payload: Uint8Array };
  received: number[] = [];
  closed = false;
  mode = 'normal';
  commitment?: string;
  challenge?: string;
  held: Record<string, unknown>[] = [];
  async open() {}
  onMessage(cb: (text: string) => void) {
    this.messages.add(cb);
    return () => {
      this.messages.delete(cb);
    };
  }
  onClose(cb: (error?: Error) => void) {
    this.closes.add(cb);
    return () => {
      this.closes.delete(cb);
    };
  }
  close() {
    this.closed = true;
  }
  emit(frame: unknown) {
    for (const cb of this.messages) cb(JSON.stringify(frame));
  }
  async send(text: string) {
    const f = JSON.parse(text);
    if (f.t === 'discover') {
      assert.equal(this.commitment, undefined);
      this.commitment = f.commitment;
      this.challenge = encode64(new Uint8Array(16).fill(9));
      this.emit({v:2, t:'offer', host, challenge:this.challenge});
      return;
    }
    if (f.t === 'hello') {
      const t = ['nwlan/2/hello', host, f.peer, f.nonce, f.ts].join('\x1f');
      assert(schnorr.verify(base64urlnopad.decode(f.sig), sha256(enc.encode(t)), Buffer.from(f.peer, 'hex')));
      if (this.commitment) {
        assert.equal(this.commitment, Buffer.from(sha256(enc.encode(['nwlan/2/discover',f.peer,f.nonce].join('\x1f')))).toString('hex'));
        assert.equal(f.mac, undefined);
      } else assert.equal(f.mac, base64urlnopad.encode(hmac(sha256, new Uint8Array(32).fill(7), enc.encode(t))));
      const session = base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16)));
      const salt = enc.encode(['nwlan/2/session', host, f.peer, f.nonce, session].join('\x1f'));
      const prk = extract(sha256, nip44.utils.getConversationKey(new Uint8Array(32).fill(0x11), f.peer), salt);
      this.keys = {
        mac: expand(sha256, prk, enc.encode('nwlan/2/mac'), 32),
        payload: expand(sha256, prk, enc.encode('nwlan/2/payload'), 32),
      };
      const sig = base64urlnopad.encode(
        schnorr.sign(
          sha256(enc.encode(['nwlan/2/welcome', host, f.peer, f.nonce, session].join('\x1f'))),
          new Uint8Array(32).fill(this.mode === 'bad-host' ? 0x33 : 0x11),
        ),
      );
      if (this.mode !== 'no-confirmation') {
        const challenge = this.challenge && this.mode !== 'changed-challenge' ? this.challenge : base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(16)));
        const digest = sha256(enc.encode(['nwlan/2/confirm', host, f.peer, f.nonce, challenge].join('\x1f')));
        this.emit({ v: 2, t: 'confirm', host, challenge, sig: base64urlnopad.encode(schnorr.sign(digest, new Uint8Array(32).fill(this.mode === 'bad-confirmation' ? 0x33 : 0x11))) });
      }
      this.emit({ v: 2, t: 'welcome', host, session, sig });
      return;
    }
    this.received.push(f.seq);
    assert.equal(f.mac, base64urlnopad.encode(hmac(sha256, this.keys!.mac, enc.encode(['nwlan/2/req', f.seq, f.payload].join('\x1f')))));
    const request = JSON.parse(nip44.decrypt(f.payload, this.keys!.payload));
    const payload = nip44.encrypt(
      JSON.stringify({ id: this.mode === 'bad-id' ? 'wrong' : request.id, result: request.method === 'get_public_key' ? host : 'ok' }),
      this.keys!.payload,
    );
    const mac = base64urlnopad.encode(hmac(sha256, this.keys!.mac, enc.encode(['nwlan/2/res', f.seq, payload].join('\x1f'))));
    const frame = { v: 2, t: 'res', seq: f.seq, payload, mac: this.mode === 'bad-mac' ? base64urlnopad.encode(new Uint8Array(32)) : mac };
    if (this.mode === 'hold') this.held.push(frame);
    else this.emit(frame);
  }
}
const offer = parsePairingUri(`nwlan://${host}?v=2&transport=ble&psk=${psk}`);
const connect = (transport: BridgeTransport, timeoutMs = 1000) =>
  LocalBridgeClient.connect({ offer, secretKey: new Uint8Array(32).fill(0x22), transport, timeoutMs });
test('mutual proof, encrypted request, out-of-order correlation and replay rejection', async () => {
  const d = new Device();
  const c = await connect(d);
  assert.equal(await c.request('get_public_key', []), host);
  d.mode = 'hold';
  const a = c.request('a', []),
    b = c.request('b', []);
  d.emit(d.held[1]);
  d.emit(d.held[0]);
  assert.deepEqual(await Promise.all([a, b]), ['ok', 'ok']);
  assert.deepEqual(d.received, [1, 2, 3]);
  d.emit(d.held[0]);
  assert(d.closed);
  await assert.rejects(c.request('again', []), /not connected/);
});
test('bad welcome signature never establishes a session', async () => {
  const d = new Device();
  d.mode = 'bad-host';
  await assert.rejects(connect(d), /signature/);
  assert(d.closed);
});
for (const mode of ['bad-mac', 'bad-id'])
  test(`rejects ${mode} and closes transport`, async () => {
    const d = new Device();
    const c = await connect(d);
    d.mode = mode;
    await assert.rejects(c.request('get_public_key', []));
    assert(d.closed);
  });
test('request timeout and disconnect reject every pending request', async () => {
  for (const disconnect of [false, true]) {
    const d = new Device();
    const c = await connect(d, 30);
    d.mode = 'hold';
    const a = assert.rejects(c.request('a', []), /timed out|disconnected/),
      b = assert.rejects(c.request('b', []), /timed out|disconnected/);
    if (disconnect) for (const cb of d.closes) cb();
    await Promise.all([a, b]);
    assert(d.closed);
  }
});
test('connection deadline also settles an open operation that never resolves', async () => {
  const d = new Device();
  d.open = () => new Promise(() => {});
  await assert.rejects(connect(d, 10), /timed out/);
  assert(d.closed);
});
test('BLE serialized writes never exceed 20 bytes and include big-endian frame length', async () => {
  const writes: Uint8Array[] = [];
  let concurrent = 0;
  let max = 0;
  let disconnected = false;
  const characteristic: BleCharacteristic = {
    async startNotifications() {},
    async writeValueWithResponse(value) {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 1));
      writes.push(value);
      concurrent--;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const device: BleDevice = {
    gatt: {
      async connect() {
        return {
          async getPrimaryService() {
            return {
              async getCharacteristic() {
                return characteristic;
              },
            };
          },
        };
      },
      disconnect() {
        disconnected = true;
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const t = createBleTransport({
    async requestDevice() {
      return device;
    },
  });
  await t.open();
  await Promise.all([t.send('x'.repeat(41)), t.send('{}')]);
  assert.equal(max, 1);
  assert(writes.every((w) => w.length <= 20));
  assert.deepEqual([...writes[0].slice(0, 4)], [0, 0, 0, 41]);
  t.close();
  assert(disconnected);
  await assert.rejects(t.send('{}'), /not connected/);
});
test('disconnect during handshake rejects without retaining listeners', async () => {
  const d = new Device();
  d.send = async () => {
    for (const cb of d.closes) cb();
  };
  await assert.rejects(connect(d), /disconnected/);
  assert.equal(d.messages.size, 0);
  assert.equal(d.closes.size, 0);
});
test('BLE notification handler is installed before startNotifications resolves', async () => {
  let notify: () => void = () => {};
  const frames: string[] = [];
  const characteristic: BleCharacteristic = {
    value: new DataView(new Uint8Array([0, 0, 0, 2, 123, 125]).buffer),
    async startNotifications() {
      notify();
    },
    async writeValueWithResponse() {},
    addEventListener(_type, handler) {
      notify = handler;
    },
    removeEventListener() {},
  };
  const device: BleDevice = {
    gatt: {
      async connect() {
        return {
          async getPrimaryService() {
            return {
              async getCharacteristic() {
                return characteristic;
              },
            };
          },
        };
      },
      disconnect() {},
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const t = createBleTransport({
    async requestDevice() {
      return device;
    },
  });
  const remove = t.onMessage((frame) => frames.push(frame));
  await t.open();
  assert.deepEqual(frames, ['{}']);
  remove();
  t.close();
});
test('BLE late chooser selection is disconnected after cancellation', async () => {
  let selected: (device: BleDevice) => void = () => {};
  let disconnected = false;
  const t = createBleTransport({
    requestDevice: () =>
      new Promise((resolve) => {
        selected = resolve;
      }),
  });
  const opening = assert.rejects(t.open(), /cancelled/);
  t.close();
  selected({
    gatt: {
      async connect() {
        throw new Error('must not connect');
      },
      disconnect() {
        disconnected = true;
      },
    },
    addEventListener() {},
    removeEventListener() {},
  });
  await opening;
  assert(disconnected);
});
import { createWifiTransport } from '../src/services/signing/localBridge/transports.ts';
test('WebSocket transport uses local nwlan2 endpoint and rejects binary messages', async () => {
  let socket: WebSocket;
  let url = '';
  let closed = false;
  const fake = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    close() {
      closed = true;
    },
    send() {},
  };
  const t = createWifiTransport('127.0.0.1:1234', (value) => {
    url = value;
    socket = fake as unknown as WebSocket;
    return socket;
  });
  const opening = t.open();
  fake.readyState = 1;
  socket!.onopen?.({} as Event);
  await opening;
  assert.equal(url, 'ws://127.0.0.1:1234/nwlan2');
  let failure: Error | undefined;
  const remove = t.onClose((error) => {
    failure = error;
  });
  socket!.onmessage?.({ data: new Uint8Array(1) } as MessageEvent);
  assert.match(failure!.message, /Invalid/);
  remove();
  t.close();
  assert(closed);
  await assert.rejects(t.send('{}'), /not open/);
});
test('verified welcome settles connect even if final BLE write acknowledgement stalls', async () => {
  const d = new Device();
  const send = d.send.bind(d);
  d.send = async (frame) => {
    await send(frame);
    await new Promise(() => {});
  };
  const c = await connect(d, 20);
  assert.equal(await c.request('get_public_key', []), host);
  c.close();
});
test('client exposes one close notification and late subscriptions see closed state', async () => {
  const d = new Device();
  const c = await connect(d);
  const errors: Error[] = [];
  const remove = c.onClose((error) => errors.push(error));
  for (const cb of d.closes) cb();
  assert.equal(errors.length, 1);
  c.close();
  assert.equal(errors.length, 1);
  remove();
  c.onClose((error) => errors.push(error));
  assert.equal(errors.length, 2);
});
test('closing transport cancels an unanswered connection immediately', async () => {
  const t = createBleTransport({ requestDevice: () => new Promise(() => {}) });
  const connecting = connect(t, 500);
  let settled = false;
  const rejected = assert.rejects(connecting, /closed|disconnected/).then(() => {
    settled = true;
  });
  t.close();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(settled, 'manual close must not wait for the connection deadline');
  await rejected;
});


test('pairing refuses a missing or forged phone confirmation challenge', async () => {
  for (const mode of ['no-confirmation', 'bad-confirmation']) {
    const d = new Device(); d.mode = mode;
    await assert.rejects(connect(d), /confirmation/);
    assert(d.closed);
  }
});

test('a signed phone challenge produces a six-digit comparison code', async () => {
  const d = new Device(); let code = '';
  const c = await LocalBridgeClient.connect({ offer, secretKey: new Uint8Array(32).fill(0x22), transport: d, onConfirmation: value => { code = value; } });
  assert.match(code, /^\d{6}$/); c.close();
});

test('direct Bluetooth commits before revealing and requires the offered signed comparison', async () => {
  const device = new Device(); let code = '';
  const client = await LocalBridgeClient.connectBluetooth({ transport: device, secretKey: new Uint8Array(32).fill(0x22), onConfirmation: value => { code = value; } });
  assert.match(code, /^\d{6}$/); assert.ok(device.commitment); client.close();
  for (const mode of ['no-confirmation', 'bad-confirmation', 'changed-challenge']) {
    const bad = new Device(); bad.mode = mode;
    await assert.rejects(LocalBridgeClient.connectBluetooth({ transport: bad, secretKey: new Uint8Array(32).fill(0x22) }), /confirmation/);
    assert.equal(bad.closed, true);
  }
});


test('Bluetooth discovery distinguishes closed pairing from outdated phone software', async () => {
  for (const [frame, message] of [
    [{ v: 2, t: 'bye', reason: 'unauthorized' }, /Pair a computer/],
    [{ v: 2, t: 'bye', reason: 'busy' }, /busy/],
    [{ v: 2, t: 'bye', reason: 'stopped' }, /closed by the phone/],
    [{ v: 2, t: 'bye', reason: 'version' }, /Update the phone/],
    [{ v: 1, t: 'offer' }, /Update the phone/],
    [{ v: 2, t: 'offer', host: 'bad' }, /Invalid Bluetooth offer/],
  ] as const) {
    const device = new Device();
    device.send = async () => { for (const receive of device.messages) receive(JSON.stringify(frame)); };
    await assert.rejects(LocalBridgeClient.connectBluetooth({ transport: device, secretKey: new Uint8Array(32).fill(0x22) }), message);
    assert.equal(device.closed, true);
    assert.equal(device.messages.size, 0);
    assert.equal(device.closes.size, 0);
  }
});

function sizedBluetooth(capability?: number[], failWrite = false) {
  const writes: Uint8Array[] = [];
  let active = 0, maxActive = 0, disconnected = false;
  const rx: BleCharacteristic = {
    async startNotifications() {},
    async writeValueWithResponse(value) {
      active++; maxActive = Math.max(active, maxActive);
      await Promise.resolve();
      writes.push(value); active--;
      if (failWrite) throw new Error('Write failed');
    },
    addEventListener() {}, removeEventListener() {},
  };
  const transport = createBleTransport({ async requestDevice() { return {
    gatt: {
      async connect() { return { async getPrimaryService() { return {
        async getCharacteristic(uuid: string) {
          if (uuid.endsWith('1203')) {
            if (!capability) throw new Error('Characteristic not found');
            return { ...rx, async readValue() { return new DataView(Uint8Array.from(capability).buffer); } };
          }
          return rx;
        },
      }; } }; },
      disconnect() { disconnected = true; },
    }, addEventListener() {}, removeEventListener() {},
  }; } });
  return { transport, writes, maxActive: () => maxActive, disconnected: () => disconnected };
}

test('BLE uses the phone packet size and preserves serialized, complete frames', async () => {
  const f = sizedBluetooth([1, 0, 244]);
  await f.transport.open();
  const frames = ['x'.repeat(2048), 'second'];
  await Promise.all(frames.map(frame => f.transport.send(frame)));
  assert.equal(f.writes.length, 10, '2 KiB uses nine writes instead of 103');
  assert.equal(f.writes[0].length, 244);
  assert.equal(f.maxActive(), 1);
  const decoder = new BleFrameDecoder();
  assert.deepEqual(f.writes.flatMap(bytes => decoder.push(bytes)), frames);
  f.transport.close();
});

test('BLE falls back safely for old phones and malformed capabilities', async () => {
  for (const value of [undefined, [], [1, 0], [2, 0, 244], [1, 0, 19], [1, 2, 1], [1, 255, 255]]) {
    const f = sizedBluetooth(value);
    await f.transport.open(); await f.transport.send('x'.repeat(41));
    assert.deepEqual(f.writes.map(bytes => bytes.length), [20, 20, 5]);
    f.transport.close();
  }
});

test('BLE failed write closes stream and never retries or sends queued frames', async () => {
  const f = sizedBluetooth([1, 0, 244], true);
  await f.transport.open();
  const first = assert.rejects(f.transport.send('x'.repeat(500)), /Write failed/);
  const second = assert.rejects(f.transport.send('must not send'), /not connected/);
  await Promise.all([first, second]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.disconnected(), true);
});
