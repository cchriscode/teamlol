// Lazy loader for opencv.js.
//
// opencv.js is ~7-10MB of WASM + JS, so we defer loading until the user
// actually starts a capture. The package's default export is a Promise
// that resolves to the initialized `cv` namespace.
//
// Why @techstark/opencv-js (instead of the official CDN):
//   - bundled as a regular npm package → static asset URL goes through
//     Next.js, no CORS / mixed-content surprises in production.
//   - ships a fully-typed `cv` namespace (TS-friendly).
//
// Browser only — `typeof window === 'undefined'` guards make this safe to
// import from a server component.

import type cvType from '@techstark/opencv-js';

export type OpenCV = typeof cvType;

let loadPromise: Promise<OpenCV> | null = null;

/**
 * Returns the initialized `cv` namespace. First call triggers the download
 * + wasm init (can take 2-5s on cold network). Subsequent calls resolve
 * instantly with the cached module.
 */
export function ensureOpenCv(): Promise<OpenCV> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('opencv.js is browser-only'));
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Dynamic import — keeps opencv.js out of the initial bundle and only
    // pays the cost when this function is actually called.
    const mod = await import('@techstark/opencv-js');
    const cv = (mod.default ?? mod) as OpenCV & { onRuntimeInitialized?: () => void };

    // @techstark/opencv-js resolves the module before WASM is fully ready.
    // Wait for `onRuntimeInitialized` (set by the underlying Emscripten
    // module). Some builds expose `cv.ready` as a Promise — handle both.
    const maybeReady = (cv as unknown as { ready?: Promise<unknown> }).ready;
    if (maybeReady && typeof (maybeReady as Promise<unknown>).then === 'function') {
      await maybeReady;
    } else {
      await new Promise<void>((resolve) => {
        const prev = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => {
          try { prev?.(); } catch { /* ignore */ }
          resolve();
        };
        // Fallback: if init has already happened, the hook above won't
        // fire — give it a short window then resolve anyway.
        setTimeout(resolve, 5000);
      });
    }
    return cv as OpenCV;
  })();

  return loadPromise;
}

/** Whether opencv.js has finished loading. Useful for UI gating. */
export function isOpenCvLoaded(): boolean {
  return loadPromise !== null;
}
