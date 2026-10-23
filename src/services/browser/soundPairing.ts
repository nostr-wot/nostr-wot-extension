import factory from '../../vendor/ggwave/ggwave.mjs';
import browser from '@lib/browser';
import { decodeSoundOffer } from '@services/signing/localBridge/sound';

/** Explicit, short-lived microphone capture. Samples never leave this document. */
export function startSoundPairing(onCode: (uri: string) => void, onError: (key: string) => void, onReady: () => void = () => {}): () => void {
  let stopped = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let modem: Awaited<ReturnType<typeof factory>> | undefined;
  let instance: number | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (node) { node.port.onmessage = null; node.port.close(); node.disconnect(); }
    source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    if (context) void context.close().catch(() => {});
    if (modem && instance !== undefined) { modem.free(instance); instance = undefined; }
  };
  const fail = (key: string) => { if (!stopped) { stop(); onError(key); } };

  const timer = setTimeout(() => fail('localBridge.soundTimeout'), 30_000);
  void (async () => {
    context = new AudioContext();
    // Start both requests while handling the user's click. No remote scripts or services.
    const requested = navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    const acquired = await requested;
    if (stopped) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    modem = await factory({ print: () => {}, printErr: () => {} });
    if (stopped) return;
    const parameters = modem.getDefaultParameters();
    parameters.sampleRateInp = context.sampleRate;
    parameters.sampleFormatInp = modem.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    parameters.operatingMode = modem.GGWAVE_OPERATING_MODE_RX;
    instance = modem.init(parameters);
    if (instance < 0) throw new Error('Audio decoder unavailable');
    await context.audioWorklet.addModule(browser.runtime.getURL('sound-pairing-worklet.js'));
    if (stopped) return;
    node = new AudioWorkletNode(context, 'pairing-capture');
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopped || !modem || instance === undefined) return;
      try {
        const samples = event.data;
        const decoded = modem.decode(instance, new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
        if (decoded.length) {
          const uri = decodeSoundOffer(decoded);
          stop(); onCode(uri);
        }
      } catch { fail('localBridge.invalidSound'); }
    };
    source = context.createMediaStreamSource(acquired);
    source.connect(node); node.connect(context.destination);
    await context.resume();
    if (stopped) return;
    onReady();
  })().catch(error => fail(error instanceof Error && error.name === 'NotAllowedError' ? 'localBridge.microphoneDenied' : 'localBridge.soundFailed'));
  return stop;
}
