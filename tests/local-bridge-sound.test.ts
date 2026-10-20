import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSoundOffer } from '../src/services/signing/localBridge/sound.ts';
import { parsePairingUri } from '../src/services/signing/localBridge/protocol.ts';
const packet = Buffer.from('4e570100' + '11'.repeat(32) + '22'.repeat(32) + 'c0a80118d3c3', 'hex');
test('compact sound bootstrap reconstructs a normal Wi-Fi pairing code', () => {
  const offer = parsePairingUri(decodeSoundOffer(packet));
  assert.equal(offer.hostPubkey, '11'.repeat(32));
  assert.equal(offer.psk, Buffer.alloc(32, 0x22).toString('base64url'));
  assert.deepEqual(offer.addresses, ['192.168.1.24:54211']);
});
test('invalid sound packets never become pairing codes', () => {
  for (const bytes of [packet.subarray(1), Buffer.concat([packet,Buffer.from([0])]), new Uint8Array(74)]) assert.throws(() => decodeSoundOffer(bytes));
  const publicHost = Buffer.from(packet); publicHost.set([8,8,8,8],68);
  assert.throws(() => decodeSoundOffer(publicHost));
});

test('microphone cancellation releases late permission grants and closes the audio context', async () => {
  const { startSoundPairing } = await import('../src/services/browser/soundPairing.ts');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let grant!: (stream: MediaStream) => void; let stops = 0; let closes = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { close() { closes++; return Promise.resolve(); } } });
  try {
    const stop = startSoundPairing(assert.fail, assert.fail);
    stop(); stop();
    grant({ getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1); assert.equal(closes, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

test('microphone denial stops capture and gives a local actionable error', async () => {
  const { startSoundPairing } = await import('../src/services/browser/soundPairing.ts');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let closes = 0; const errors: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { close() { closes++; return Promise.resolve(); } } });
  try {
    startSoundPairing(assert.fail, value => errors.push(value));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1); assert.deepEqual(errors, ['localBridge.microphoneDenied']);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

test('signed modem bytes retain high-bit key, secret and address bytes', () => {
  const bytes = Buffer.from(packet); bytes.fill(0xfe,4,36); bytes.fill(0xdf,36,68);
  const decoded = parsePairingUri(decodeSoundOffer(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  assert.equal(decoded.hostPubkey, 'fe'.repeat(32));
  assert.equal(decoded.psk, Buffer.alloc(32, 0xdf).toString('base64url'));
  assert.deepEqual(decoded.addresses, ['192.168.1.24:54211']);
});
