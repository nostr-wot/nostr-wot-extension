import jsQR from 'jsqr';

export interface CameraEnvironment {
  requestVideo(): Promise<MediaStream>;
  createCanvas(): HTMLCanvasElement;
  schedule(callback: () => void): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

/** Camera frames stay in this document; only the decoded text is delivered to the caller. */
export function startQrCamera(
  video: HTMLVideoElement,
  onCode: (value: string) => void,
  onError: (key: string) => void,
  environment?: CameraEnvironment,
): () => void {
  const env = environment ?? {
    requestVideo: () => navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } }),
    createCanvas: () => document.createElement('canvas'),
    schedule: (callback: () => void) => setTimeout(callback, 200),
    cancel: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  };
  let stopped = false;
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) env.cancel(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.pause(); video.srcObject = null;
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    const name = error instanceof Error ? error.name : '';
    onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'localBridge.cameraDenied' : name === 'NotFoundError' ? 'localBridge.cameraMissing' : 'localBridge.cameraFailed');
  };
  void (async () => {
    const acquired = await env.requestVideo();
    if (stopped) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = acquired;
    await video.play();
    if (stopped) return;
    const canvas = env.createCanvas();
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Camera canvas unavailable');
    const scan = () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frame.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) { stop(); onCode(code.data); return; }
        }
        timer = env.schedule(scan);
      } catch (error) { fail(error); }
    };
    scan();
  })().catch(fail);
  return stop;
}
