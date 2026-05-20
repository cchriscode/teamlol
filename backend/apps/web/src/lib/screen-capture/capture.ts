// Thin wrapper around getDisplayMedia for capturing a specific window
// (the user will pick the LoL client). Exposes single-frame snapshots
// rendered to an OffscreenCanvas/HTMLCanvasElement for downstream
// champion-icon matching.
//
// Browser security: we can't programmatically focus the LoL window or
// pre-select which window to share — the user has to pick from the
// browser's screen-share dialog. Once a stream is acquired, it persists
// until they hit "공유 중지" in the browser bar.

export interface CaptureSession {
  stream: MediaStream;
  video: HTMLVideoElement;
  /** Width/height of the source window (post-handshake). */
  width: number;
  height: number;
  /** Render the current frame onto the given canvas. Returns false if no frame yet. */
  drawFrame: (canvas: HTMLCanvasElement) => boolean;
  /** Crop a sub-rectangle of the current frame to a new canvas. */
  cropFrame: (rect: { x: number; y: number; w: number; h: number }) => HTMLCanvasElement | null;
  stop: () => void;
}

export async function startCapture(): Promise<CaptureSession> {
  // displaySurface preference is a hint — browser still shows its own
  // picker. Only Chromium honours `preferCurrentTab: false`; Firefox/
  // Safari ignore. Either way the user clicks the target window.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      // Higher framerate is wasted — champ select changes slowly.
      frameRate: { ideal: 2, max: 5 },
    } as MediaTrackConstraints,
    audio: false,
  });

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('no video track in display capture');
  }
  const settings = track.getSettings();
  const width = settings.width ?? 1920;
  const height = settings.height ?? 1080;

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  // Wait for the first frame so subsequent drawFrame() doesn't render blank.
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  const drawFrame = (canvas: HTMLCanvasElement): boolean => {
    if (video.readyState < 2) return false;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return true;
  };

  const cropFrame = (rect: { x: number; y: number; w: number; h: number }): HTMLCanvasElement | null => {
    if (video.readyState < 2) return null;
    const out = document.createElement('canvas');
    out.width = rect.w;
    out.height = rect.h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return out;
  };

  const stop = () => {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  // Auto-cleanup when the user hits the browser's "stop sharing" button.
  track.addEventListener('ended', stop);

  return { stream, video, width, height, drawFrame, cropFrame, stop };
}
