import assert from 'node:assert/strict';
import test from 'node:test';
import qr from 'qrcode-generator';
import { startQrCamera, type CameraEnvironment } from '../src/services/browser/qrCamera.ts';

function fixture() {
  const code = qr(0, 'M'); code.addData('nwlan://test-camera-payload'); code.make();
  const size = (code.getModuleCount() + 8) * 4;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / 4) - 4, col = Math.floor(x / 4) - 4;
    if (row >= 0 && col >= 0 && row < code.getModuleCount() && col < code.getModuleCount() && code.isDark(row, col)) {
      const i = (y * size + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    }
  }
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream;
  const video = { videoWidth: size, videoHeight: size, readyState: 4, srcObject: null, play: async () => {}, pause: () => {} } as unknown as HTMLVideoElement;
  const canvas = { width: size, height: size, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) } as unknown as HTMLCanvasElement;
  const env: CameraEnvironment = { requestVideo: async () => stream, createCanvas: () => canvas, schedule: () => 1 as unknown as ReturnType<typeof setTimeout>, cancel: () => {} };
  return { video, env, stream, stops: () => stops };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('camera decodes a QR locally and releases its tracks before delivering the code', async () => {
  const f = fixture(); const values: string[] = [];
  const stop = startQrCamera(f.video, value => { assert.equal(f.stops(), 1); values.push(value); }, assert.fail, f.env);
  await settle();
  assert.deepEqual(values, ['nwlan://test-camera-payload']);
  assert.equal(f.video.srcObject, null);
  stop(); assert.equal(f.stops(), 1);
});

test('closing while camera permission is pending releases a late stream without scanning', async () => {
  const f = fixture(); let grant!: (stream: MediaStream) => void;
  f.env.requestVideo = () => new Promise(resolve => { grant = resolve; });
  const stop = startQrCamera(f.video, assert.fail, assert.fail, f.env);
  stop(); grant(f.stream); await settle();
  assert.equal(f.stops(), 1); assert.equal(f.video.srcObject, null);
});

test('camera permission denial gives actionable feedback without exposing browser error details', async () => {
  const f = fixture(); const errors: string[] = [];
  f.env.requestVideo = async () => { throw new DOMException('private details', 'NotAllowedError'); };
  startQrCamera(f.video, assert.fail, key => errors.push(key), f.env);
  await settle(); assert.deepEqual(errors, ['localBridge.cameraDenied']);
});

test('playback failure releases the camera', async () => {
  const f = fixture(); const errors: string[] = [];
  f.video.play = async () => { throw new Error('failed'); };
  startQrCamera(f.video, assert.fail, key => errors.push(key), f.env);
  await settle(); assert.equal(f.stops(), 1); assert.deepEqual(errors, ['localBridge.cameraFailed']);
});
