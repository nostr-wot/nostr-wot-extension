import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
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

test('microphone float frames decode a real pairing waveform and release capture', async () => {
  const {default:factory}=await import('ggwave');
  const modem=await factory({print:()=>{},printErr:()=>{}});
  const params=modem.getDefaultParameters();params.sampleFormatOut=modem.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  const tx=modem.init(params);
  const waveform=(modem as any).encode(tx,packet,(modem as any).ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST,20);
  const samples=new Float32Array(waveform.buffer.slice(waveform.byteOffset,waveform.byteOffset+waveform.byteLength));modem.free(tx);
  const {startSoundPairing}=await import('../src/services/browser/soundPairing.ts');
  const names=['navigator','AudioContext','AudioWorkletNode'] as const;
  const originals=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  let capture:any;let stops=0;let closes=0;let ready=false;let notified=false;const codes:string[]=[];const errors:string[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})}}});
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:class {
    sampleRate=48000;destination={};audioWorklet={addModule:async()=>{}};
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    resume(){ready=true;return Promise.resolve();} close(){closes++;return Promise.resolve();}
  }});
  Object.defineProperty(globalThis,'AudioWorkletNode',{configurable:true,value:class {
    port={onmessage:null as any,close(){}};constructor(){capture={port:this.port};}connect(){}disconnect(){}
  }});
  let stop: (()=>void)|undefined;
  try {
    stop=startSoundPairing(uri=>codes.push(uri),key=>errors.push(key),()=>{assert.equal(ready,true);notified=true;});
    assert.equal(notified,false);
    for(let i=0;i<200&&!ready&&!errors.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(ready,true,errors.join(','));assert.equal(notified,true);
    for(let offset=0;offset<samples.length&&capture.port.onmessage;offset+=1024)capture.port.onmessage({data:samples.slice(offset,offset+1024)});
    for(let i=0;i<10&&capture.port.onmessage;i++)capture.port.onmessage({data:new Float32Array(1024)});
    assert.deepEqual(errors,[]);assert.deepEqual(codes,[decodeSoundOffer(packet)]);assert.equal(stops,1);assert.equal(closes,1);
  } finally {
    stop?.();names.forEach((name,i)=>{if(originals[i])Object.defineProperty(globalThis,name,originals[i]!);else Reflect.deleteProperty(globalThis,name);});
  }
});

// This is the extension CSP restriction that the previous npm build violated.
test('sound decoder initializes without dynamic JavaScript execution', () => {
  execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', `
    import factory from './src/vendor/ggwave/ggwave.mjs';
    const modem = await factory({ print() {}, printErr() {} });
    const instance = modem.init(modem.getDefaultParameters());
    if (instance < 0) throw new Error('Decoder failed to initialize');
    modem.free(instance);
  `], { cwd: process.cwd(), stdio: 'pipe' });
});

test('the one-attempt deadline also stops a delayed microphone grant', async t => {
  const { startSoundPairing } = await import('../src/services/browser/soundPairing.ts');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let grant!: (stream: MediaStream) => void;
  let stops = 0, closes = 0;
  const errors: string[] = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { close() { closes++; return Promise.resolve(); } } });
  try {
    startSoundPairing(assert.fail, key => errors.push(key));
    t.mock.timers.tick(29_999); assert.deepEqual(errors, []);
    t.mock.timers.tick(1); assert.deepEqual(errors, ['localBridge.soundTimeout']);
    grant({ getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1); assert.equal(closes, 1);
  } finally {
    t.mock.timers.reset();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
