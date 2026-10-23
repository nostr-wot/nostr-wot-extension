import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import ggwave from 'ggwave';
import { verifyPackage } from './verify-package.mjs';

/** Boot the bytes from the upload ZIP in a disposable browser with no user data. */
export async function smokeChrome(archive, version) {
  const { manifest, sha256 } = verifyPackage(archive, 'chrome', version);
  const dir = mkdtempSync(join(tmpdir(), 'nostr-package-smoke-'));
  const unpacked = join(dir, 'extension');
  mkdirSync(unpacked);
  // An independent transmitter feeds Chrome's real microphone/audio-worklet path.
  const modem = await ggwave({ print() {}, printErr() {} });
  const parameters = modem.getDefaultParameters();
  parameters.sampleFormatOut = modem.SampleFormat.GGWAVE_SAMPLE_FORMAT_I16;
  const tx = modem.init(parameters);
  const packet = Buffer.from('4e570100' + 'fe'.repeat(32) + 'df'.repeat(32) + 'c0a80118d3c3', 'hex');
  const waveform = Buffer.from(modem.encode(tx, packet, modem.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 20));
  modem.free(tx);
  const pcm = Buffer.concat([Buffer.alloc(48000 * 2), waveform, Buffer.alloc(48000 * 2)]);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const audio = join(dir, 'pairing.wav'); writeFileSync(audio, Buffer.concat([header, pcm]));
  let context;
  try {
    execFileSync('unzip', ['-qq', resolve(archive), '-d', unpacked]);
    context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audio}`],
    });
    context.setDefaultTimeout(15000);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/${manifest.action.default_popup}`);
    await page.waitForFunction(() => globalThis.document.querySelector('#root')?.childElementCount > 0);
    // Exercise the exact privileged RPC used by the failed site-status card.
    // This runs in the popup, so the real sender checks and message transport apply.
    const response = await page.evaluate(async () => {
      return Promise.race([
        globalThis.chrome.runtime.sendMessage({ method: 'getAllowedDomains', params: {} }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getAllowedDomains timed out')), 10000)),
      ]);
    });
    assert.ok(response && !response.error && Array.isArray(response.result), 'Popup getAllowedDomains RPC failed');
    // A storage read stalled during update/startup must not leave an empty root.
    const recovery = await context.newPage();
    await recovery.addInitScript(() => {
      const original = globalThis.chrome.storage.sync.get.bind(globalThis.chrome.storage.sync);
      globalThis.chrome.storage.sync.get = (keys, ...args) => Array.isArray(keys) && keys.includes('language')
        ? new Promise(() => {})
        : original(keys, ...args);
    });
    await recovery.goto(`chrome-extension://${id}/${manifest.action.default_popup}`);
    await recovery.waitForFunction(() => globalThis.document.querySelector('#root')?.childElementCount > 0, undefined, { timeout: 5000 });
    await recovery.getByText('No accounts', { exact: true }).waitFor({ timeout: 5000 });
    await recovery.close();
    // Exercise the shipped decoder under the real MV3 CSP, not a Node mock.
    const bridge = await context.newPage();
    await bridge.addInitScript(() => {
      globalThis.soundStreams = [];
      globalThis.soundSockets = [];
      globalThis.soundViolations = [];
      globalThis.document.addEventListener('securitypolicyviolation', event => globalThis.soundViolations.push(event.violatedDirective));
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await capture(options); globalThis.soundStreams.push(stream); return stream;
      };
      // Observe auto-connect without reaching any real LAN service.
      globalThis.WebSocket = class { constructor(url) { globalThis.soundSockets.push(url); throw new Error('Sound test connection reached'); } };
    });
    await bridge.goto(`chrome-extension://${id}/src/entrypoints/local-bridge/index.html`);
    await bridge.getByText('Wi-Fi', { exact: true }).click();
    const sound = bridge.getByRole('button', { name: 'Pair with sound', exact: true });
    assert.equal(await sound.isEnabled(), true);
    assert.equal(await bridge.evaluate(() => globalThis.soundStreams.length), 0);
    await sound.click();
    // Opening the dialog alone must not request a microphone.
    await bridge.getByRole('button', { name: 'Start listening', exact: true }).waitFor();
    assert.equal(await bridge.evaluate(() => globalThis.soundStreams.length), 0);
    await bridge.getByRole('button', { name: 'Start listening', exact: true }).click();
    await bridge.getByText('Sound test connection reached', { exact: true }).waitFor({ timeout: 30000 });
    assert.deepEqual(await bridge.evaluate(() => globalThis.soundSockets), ['ws://192.168.1.24:54211/nwlan2']);
    const code = await bridge.locator('input').inputValue();
    assert.ok(code.startsWith('nwlan://' + 'fe'.repeat(32)));
    assert.equal(new URL(code).searchParams.get('psk'), Buffer.alloc(32, 0xdf).toString('base64url'));
    assert.equal(await bridge.evaluate(() => globalThis.soundStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
    assert.deepEqual(await bridge.evaluate(() => globalThis.soundViolations), []);
    // A second attempt is explicit, and cancelling immediately releases capture.
    await sound.click();
    await bridge.getByRole('button', { name: 'Start listening', exact: true }).click();
    await bridge.waitForFunction(() => globalThis.soundStreams.length === 2);
    await bridge.keyboard.press('Escape');
    await bridge.waitForFunction(() => globalThis.soundStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
    await bridge.reload();
    assert.equal(await bridge.evaluate(() => globalThis.soundStreams.length), 0);
    await bridge.close();
    console.log(`Chrome ZIP smoke passed: worker started, popup rendered, connection-status RPC answered. SHA256 ${sha256}`);
    return sha256;
  } finally {
    if (context) await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  await smokeChrome(process.argv[2], version);
}
