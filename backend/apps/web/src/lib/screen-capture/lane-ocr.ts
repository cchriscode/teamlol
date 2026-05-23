// Lane detection via OCR on the Korean text label LoL renders in champion
// select (e.g., "상단 (탑)", "중단 (미드)", "정글", "서포터").
//
// Why OCR instead of icon pHash: the champ-select UI shows lane assignments
// as text next to each my-team player, not as a position icon. The position
// icons (top/jungle/mid/adc/support pngs from Community Dragon) only appear
// in OTHER screens (loading screen, post-game), so pHash matching against
// them returns 0 hits during champ select.
//
// Implementation: tesseract.js with the Korean traineddata. ~10MB download
// on first use, cached by the browser. Worker is a singleton so we pay the
// init cost (load wasm + traineddata) only once per session.

import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

export type LaneKey = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

let workerPromise: Promise<TesseractWorker> | null = null;

/** Lazily create + cache the single Tesseract worker. */
async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker('kor').then(async (w) => {
      // Restricting the charset to expected lane characters dramatically
      // improves accuracy on tiny text and skips OCR of unrelated UI noise.
      await w.setParameters({
        tessedit_char_whitelist: '탑정글미드봇서포터상단중하원딜바텀()',
      });
      return w;
    });
  }
  return workerPromise;
}

/** Eagerly warm up the worker (preload wasm + traineddata). */
export async function ensureOcrLoaded(): Promise<void> {
  await getWorker();
}

// Match parenthesized short form first ("상단 (탑)" → "탑"), then the prefix.
// Each pattern is tried against the parenthesized substring before the
// raw text so the short form takes priority.
const LANE_PATTERNS: Array<[RegExp, LaneKey]> = [
  [/탑|상단/,           'top'],
  [/정글/,              'jungle'],
  [/미드|중단/,         'mid'],
  [/봇|하단|바텀|원딜/, 'adc'],
  [/서폿|서포터/,       'support'],
];

function parseLaneText(text: string): LaneKey | null {
  const cleaned = text.replace(/\s+/g, '');
  if (!cleaned) return null;
  // Prefer parenthesized hint (e.g., "상단(탑)" → match "탑" first).
  const paren = cleaned.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    for (const [re, lane] of LANE_PATTERNS) if (re.test(paren[1])) return lane;
  }
  for (const [re, lane] of LANE_PATTERNS) if (re.test(cleaned)) return lane;
  return null;
}

/**
 * OCR a single lane text crop and resolve to a LaneKey or null.
 * Returns null on Tesseract failure or unrecognized text — caller treats
 * null as "no confident lane".
 */
export async function ocrLane(canvas: HTMLCanvasElement): Promise<{
  lane: LaneKey | null; rawText: string;
}> {
  try {
    const w = await getWorker();
    const { data } = await w.recognize(canvas);
    const lane = parseLaneText(data.text ?? '');
    return { lane, rawText: (data.text ?? '').trim() };
  } catch {
    return { lane: null, rawText: '' };
  }
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise;
  await w.terminate();
  workerPromise = null;
}
