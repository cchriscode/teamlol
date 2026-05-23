// Champion-name OCR — reads the Korean champion name LoL renders under
// each pick portrait (e.g. "카타리나", "그라가스") so we can cross-check
// the pHash result.
//
// Why this exists: pHash on a portrait crop sometimes mis-matches when
// the crop is slightly off-center, or during the "선택 중" transition
// animation. The name TEXT under the portrait is unambiguous — if pHash
// says "Aatrox" but OCR reads "카타리나", we flag the slot as low-
// confidence rather than locking in the wrong pick.
//
// Uses the same tesseract.js infrastructure as lane-ocr but a separate
// worker because the character set is wide (all champ names) — we can't
// use lane-ocr's tight whitelist.

import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker('kor');
    // No character whitelist — champion names use a wide hangul range.
  }
  return workerPromise;
}

export async function ensureNameOcrLoaded(): Promise<void> {
  await getWorker();
}

/**
 * OCR a single champion-name text crop, normalize whitespace.
 * Returns empty string on failure.
 */
export async function ocrName(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const w = await getWorker();
    const { data } = await w.recognize(canvas);
    return (data.text ?? '').replace(/\s+/g, '').trim();
  } catch {
    return '';
  }
}

/**
 * Given a pHash-matched champion key and an OCR'd name string, decide
 * whether they refer to the same champion. The lookup table is built
 * by the caller (it depends on the live ddragon CHAMPIONS map).
 *
 * Matching rules:
 *   - Exact: OCR == nameKr(key)
 *   - Prefix / substring: OCR ⊆ nameKr or nameKr ⊆ OCR (handles partial
 *     reads when the crop clips a few characters).
 *   - Character overlap ≥ 50%: tolerates 1-2 character OCR errors.
 */
export function nameMatches(ocrText: string, nameKr: string): boolean {
  if (!ocrText || !nameKr) return false;
  const a = ocrText.replace(/\s+/g, '');
  const b = nameKr.replace(/\s+/g, '');
  if (a === b) return true;
  if (a.length >= 2 && b.includes(a)) return true;
  if (b.length >= 2 && a.includes(b)) return true;
  // Loose match: overlap ratio (intersect chars / shorter length).
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter += 1;
  const minLen = Math.min(sa.size, sb.size);
  if (minLen === 0) return false;
  return inter / minLen >= 0.5;
}
