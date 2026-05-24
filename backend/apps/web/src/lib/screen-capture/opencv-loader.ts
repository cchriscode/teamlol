// Lazy loader for opencv.js.
//
// opencv.js is ~7-10MB of WASM + JS. It is NOT imported via webpack/
// turbopack — the bundle includes Node-only require('fs') paths inside
// runtime-only guards that confuse static bundlers. Instead we inject a
// <script> tag at first use, load the official build from the docs CDN,
// and wait for the Emscripten runtime to signal ready.
//
// Browser-only — calls from a server component will reject immediately.

// Minimal subset of the cv namespace we actually call. Declared with `any`
// because opencv.js doesn't ship browser-runtime typings out of the box;
// the @techstark/opencv-js types live in node_modules but our shape-detect
// code only touches a handful of methods so the runtime contract is small.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type OpenCV = any;

const SCRIPT_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let loadPromise: Promise<OpenCV> | null = null;

declare global {
  interface Window {
    cv?: OpenCV & { onRuntimeInitialized?: () => void; ready?: Promise<unknown> };
  }
}

/**
 * Returns the initialized `cv` namespace. First call injects the script
 * tag and waits for WASM init (can take 2-5s on cold network). Subsequent
 * calls resolve instantly with the cached module.
 */
export function ensureOpenCv(): Promise<OpenCV> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('opencv.js is browser-only'));
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<OpenCV>((resolve, reject) => {
    // If a previous page load already brought in cv, reuse it.
    if (window.cv && (window.cv as { Mat?: unknown }).Mat) {
      resolve(window.cv);
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    // No crossOrigin attribute: docs.opencv.org doesn't ship CORS headers
    // and the strict 'anonymous' mode would block the load. We don't need
    // SRI here either — opencv.js is sandboxed by the page origin and we
    // can't safely sub-resource integrity check a 7MB binary anyway.

    script.onerror = () => reject(new Error(`failed to load opencv.js from ${SCRIPT_URL}`));
    script.onload = () => {
      const cv = window.cv;
      if (!cv) {
        reject(new Error('opencv.js loaded but window.cv is undefined'));
        return;
      }
      // The Emscripten module fires onRuntimeInitialized once WASM is
      // ready. Some builds also expose `ready` as a Promise. Handle both,
      // with a 10s timeout as a safety net.
      const maybeReady = cv.ready as Promise<unknown> | undefined;
      if (maybeReady && typeof maybeReady.then === 'function') {
        maybeReady.then(() => resolve(cv)).catch(reject);
        return;
      }
      const t = setTimeout(() => resolve(cv), 10_000);
      const prev = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => {
        clearTimeout(t);
        try { prev?.(); } catch { /* ignore */ }
        resolve(cv);
      };
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Whether opencv.js has finished loading. Useful for UI gating. */
export function isOpenCvLoaded(): boolean {
  return !!(typeof window !== 'undefined' && window.cv && (window.cv as { Mat?: unknown }).Mat);
}
