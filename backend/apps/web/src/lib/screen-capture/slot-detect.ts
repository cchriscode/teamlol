// High-level slot-position detection that combines OpenCV shape detection
// (HoughCircles for picks, contour-find for bans) with post-processing
// (alignment + count filtering) to handle layout variation across
// resolutions, UI scales, and windowed/fullscreen modes — without any
// hardcoded slot coordinates.
//
// Output is the same SlotRect shape the existing capture pipeline uses,
// so this can drop into auto-calibrate as a higher-fidelity alternative.

import { detectPickCircles, detectBanRects, type CircleHit, type RectHit } from './shape-detect';

export type SlotKind = 'myPick' | 'enemyPick' | 'myBan' | 'enemyBan' | 'myLane';

export interface SlotRect {
  kind: SlotKind;
  idx: number;
  x: number; y: number; w: number; h: number;
  label: string;
}

export interface DetectProgress {
  phase: 'picks' | 'bans' | 'lanes' | 'done';
  region?: string;
}

export interface DetectResult {
  slots: SlotRect[];
  diagnostics: {
    frameW: number; frameH: number;
    pickCircles: { my: number; enemy: number };
    banRects:    { my: number; enemy: number };
    extrapolated: { myPick: number; enemyPick: number; myBan: number; enemyBan: number };
  };
}

/**
 * Detect all 25 slot positions in a captured frame.
 *
 * Strategy per region:
 *   1. Run shape detection (HoughCircles / contour) on a wide search area.
 *   2. Cluster candidates by alignment along the primary axis (Y for
 *      vertical pick columns, X for horizontal ban rows).
 *   3. Pick the densest cluster, sort, keep top-5 by spacing regularity.
 *   4. If fewer than 5 survive, extrapolate with median stride.
 *
 * Lane TEXT positions are derived from my-pick centers at a fixed offset
 * (the layout always puts lane text right of each portrait).
 */
export async function detectSlots(
  frameCanvas: HTMLCanvasElement,
  onProgress?: (p: DetectProgress) => void,
): Promise<DetectResult> {
  const W = frameCanvas.width;
  const H = frameCanvas.height;

  // Expected portrait radius: ~3% of frame height covers 1080p, 1440p, 4K
  // pretty well (portraits scale with the UI which scales with viewport).
  const expectedPickR = Math.round(H * 0.030);
  // Bans are ~2/3 the diameter of pick portraits.
  const expectedBanSide = Math.round(H * 0.040);

  // Wide search regions — broader than the previous hardcoded ones so we
  // tolerate slight layout differences. Post-processing filters out
  // false positives by alignment + count.
  const pickL = { x: 0,                    y: 0,                    w: Math.round(0.22 * W), h: H };
  const pickR = { x: Math.round(0.78 * W), y: 0,                    w: Math.round(0.22 * W), h: H };
  const banL  = { x: 0,                    y: 0,                    w: Math.round(0.25 * W), h: Math.round(0.12 * H) };
  const banR  = { x: Math.round(0.75 * W), y: 0,                    w: Math.round(0.25 * W), h: Math.round(0.12 * H) };

  onProgress?.({ phase: 'picks', region: 'myPick' });
  const myPickRaw    = await detectPickCircles(frameCanvas, pickL, 'myPick',    expectedPickR);
  onProgress?.({ phase: 'picks', region: 'enemyPick' });
  const enemyPickRaw = await detectPickCircles(frameCanvas, pickR, 'enemyPick', expectedPickR);
  onProgress?.({ phase: 'bans',  region: 'myBan' });
  const myBanRaw     = await detectBanRects   (frameCanvas, banL,  'myBan',     expectedBanSide);
  onProgress?.({ phase: 'bans',  region: 'enemyBan' });
  const enemyBanRaw  = await detectBanRects   (frameCanvas, banR,  'enemyBan',  expectedBanSide);

  // Pick filtering: keep up to 5 circles forming a vertical column at the
  // dominant X (median of all candidates). Bans: keep 5 in a horizontal
  // row at the dominant Y.
  const myPicks    = filterColumnCircles(myPickRaw,    'y');
  const enemyPicks = filterColumnCircles(enemyPickRaw, 'y');
  const myBans     = filterRowRects(myBanRaw,    'x');
  const enemyBans  = filterRowRects(enemyBanRaw, 'x');

  const slots: SlotRect[] = [];
  const extrapolated = { myPick: 0, enemyPick: 0, myBan: 0, enemyBan: 0 };

  pushPickSlots(slots, myPicks,    'myPick',    extrapolated);
  pushPickSlots(slots, enemyPicks, 'enemyPick', extrapolated);
  pushBanSlots (slots, myBans,     'myBan',     extrapolated);
  pushBanSlots (slots, enemyBans,  'enemyBan',  extrapolated);

  onProgress?.({ phase: 'lanes' });
  // Lane TEXT slots — derived from my-pick centers. Text sits to the
  // right of each portrait at ~1.5× portrait radius offset, vertically
  // centered on the portrait (LoL renders name on top + lane on bottom
  // line, so a moderately tall crop covers both — OCR picks the lane).
  const myPickSlots = slots.filter((s) => s.kind === 'myPick').sort((a, b) => a.idx - b.idx);
  for (const p of myPickSlots) {
    const portraitR = p.w / 2;
    const cx = p.x + p.w + Math.round(portraitR * 1.5);
    const cy = p.y + Math.round(p.h * 0.60);            // bias to lane line
    const halfW = Math.max(50, Math.round(portraitR * 2.5));
    const halfH = Math.max(12, Math.round(portraitR * 0.5));
    slots.push({
      kind: 'myLane',
      idx: p.idx,
      x: Math.max(0, Math.round(cx - halfW)),
      y: Math.max(0, Math.round(cy - halfH)),
      w: halfW * 2,
      h: halfH * 2,
      label: `우리 ${p.idx + 1}번 라인 텍스트`,
    });
  }

  onProgress?.({ phase: 'done' });
  return {
    slots,
    diagnostics: {
      frameW: W, frameH: H,
      pickCircles: { my: myPickRaw.length, enemy: enemyPickRaw.length },
      banRects:    { my: myBanRaw.length,  enemy: enemyBanRaw.length },
      extrapolated,
    },
  };
}

// ---- post-processing helpers ----

/**
 * From an unfiltered list of circle hits, keep 5 forming a vertical
 * column at the dominant X. Tolerates outliers (other UI circles) by
 * using median X as the column anchor.
 */
function filterColumnCircles(hits: CircleHit[], primary: 'y' | 'x'): CircleHit[] {
  if (hits.length === 0) return [];
  const sec: 'x' | 'y' = primary === 'y' ? 'x' : 'y';
  const secValues = hits.map((h) => sec === 'x' ? h.cx : h.cy).sort((a, b) => a - b);
  const secMedian = secValues[Math.floor(secValues.length / 2)]!;
  // Tolerance ~3× expected radius (so we catch all picks in the column
  // even if some are 1-2px off due to detection noise).
  const tol = Math.max(20, Math.round(hits[0]!.r * 3));
  const inColumn = hits.filter((h) => {
    const sv = sec === 'x' ? h.cx : h.cy;
    return Math.abs(sv - secMedian) <= tol;
  });
  if (inColumn.length === 0) return [];
  // Sort by primary axis, dedupe near-duplicates within 1× radius.
  inColumn.sort((a, b) => primary === 'y' ? a.cy - b.cy : a.cx - b.cx);
  const dedup: CircleHit[] = [];
  for (const h of inColumn) {
    const last = dedup[dedup.length - 1];
    const gap = last
      ? Math.abs((primary === 'y' ? h.cy : h.cx) - (primary === 'y' ? last.cy : last.cx))
      : Infinity;
    if (gap < h.r * 1.2) {
      // duplicate — keep the bigger / clearer one
      if (h.r > (last?.r ?? 0)) dedup[dedup.length - 1] = h;
    } else {
      dedup.push(h);
    }
  }
  return dedup.slice(0, 5);
}

function filterRowRects(hits: RectHit[], primary: 'x' | 'y'): RectHit[] {
  if (hits.length === 0) return [];
  const sec: 'x' | 'y' = primary === 'x' ? 'y' : 'x';
  const secValues = hits.map((h) => sec === 'x' ? h.cx : h.cy).sort((a, b) => a - b);
  const secMedian = secValues[Math.floor(secValues.length / 2)]!;
  const expectedHalfSide = (hits[0]!.w + hits[0]!.h) / 4;
  const tol = Math.max(15, Math.round(expectedHalfSide * 2));
  const inRow = hits.filter((h) => {
    const sv = sec === 'x' ? h.cx : h.cy;
    return Math.abs(sv - secMedian) <= tol;
  });
  inRow.sort((a, b) => primary === 'x' ? a.cx - b.cx : a.cy - b.cy);
  // Dedupe by spacing < 0.8× width
  const dedup: RectHit[] = [];
  for (const h of inRow) {
    const last = dedup[dedup.length - 1];
    const gap = last ? Math.abs((primary === 'x' ? h.cx : h.cy) - (primary === 'x' ? last.cx : last.cy)) : Infinity;
    if (gap < h.w * 0.8) {
      const lastSize = (last?.w ?? 0) * (last?.h ?? 0);
      if (h.w * h.h > lastSize) dedup[dedup.length - 1] = h;
    } else {
      dedup.push(h);
    }
  }
  return dedup.slice(0, 5);
}

function pushPickSlots(
  out: SlotRect[],
  hits: CircleHit[],
  kind: 'myPick' | 'enemyPick',
  extrap: { myPick: number; enemyPick: number; myBan: number; enemyBan: number },
): void {
  const positions = extrapolateTo5(hits.map((h) => ({ p: h.cy, sec: h.cx, size: h.r })), 'y');
  const sizeMedian = median(hits.map((h) => h.r)) || 30;
  positions.forEach((pos, i) => {
    const half = Math.round(sizeMedian);
    out.push({
      kind,
      idx: i,
      x: Math.max(0, Math.round(pos.sec - half)),
      y: Math.max(0, Math.round(pos.p - half)),
      w: half * 2,
      h: half * 2,
      label: labelFor(kind, i),
    });
  });
  if (kind === 'myPick' || kind === 'enemyPick') extrap[kind] = 5 - hits.length;
}

function pushBanSlots(
  out: SlotRect[],
  hits: RectHit[],
  kind: 'myBan' | 'enemyBan',
  extrap: { myPick: number; enemyPick: number; myBan: number; enemyBan: number },
): void {
  const positions = extrapolateTo5(hits.map((h) => ({ p: h.cx, sec: h.cy, size: (h.w + h.h) / 2 })), 'x');
  const sizeMedian = median(hits.map((h) => (h.w + h.h) / 2)) || 30;
  positions.forEach((pos, i) => {
    const half = Math.round(sizeMedian / 2);
    out.push({
      kind,
      idx: i,
      x: Math.max(0, Math.round(pos.p - half)),
      y: Math.max(0, Math.round(pos.sec - half)),
      w: half * 2,
      h: half * 2,
      label: labelFor(kind, i),
    });
  });
  if (kind === 'myBan' || kind === 'enemyBan') extrap[kind] = 5 - hits.length;
}

/**
 * Given N (≤5) positions along a primary axis, return exactly 5 positions
 * by extrapolating with the median stride. Found positions stay
 * pixel-accurate; extrapolated positions inherit the median sec / size.
 */
function extrapolateTo5(
  found: Array<{ p: number; sec: number; size: number }>,
  _axis: 'x' | 'y',
): Array<{ p: number; sec: number; size: number }> {
  if (found.length === 0) return [];
  if (found.length >= 5) {
    return found.slice(0, 5);
  }
  found = [...found].sort((a, b) => a.p - b.p);
  // Median stride
  let stride = 0;
  if (found.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < found.length; i++) gaps.push(found[i]!.p - found[i - 1]!.p);
    gaps.sort((a, b) => a - b);
    stride = gaps[Math.floor(gaps.length / 2)]!;
  } else {
    // Lone hit — fallback stride estimated from size (portraits are
    // separated by ~3× their radius vertically).
    stride = Math.round(found[0]!.size * 3);
  }
  const secMedian = median(found.map((f) => f.sec))!;
  const sizeMedian = median(found.map((f) => f.size))!;
  const anchor = found[0]!.p;
  const generated: Array<{ p: number; sec: number; size: number }> = [];
  for (let i = 0; i < 5; i++) generated.push({ p: anchor + i * stride, sec: secMedian, size: sizeMedian });
  // Snap generated positions to actual found ones when close.
  for (const f of found) {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < 5; i++) {
      const d = Math.abs(generated[i]!.p - f.p);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD < stride / 2) generated[bestI] = f;
  }
  return generated;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function labelFor(kind: SlotKind, idx: number): string {
  const n = idx + 1;
  switch (kind) {
    case 'myPick':    return `우리 픽 ${n}`;
    case 'enemyPick': return `적 픽 ${n}`;
    case 'myBan':     return `우리 밴 ${n}`;
    case 'enemyBan':  return `적 밴 ${n}`;
    case 'myLane':    return `우리 ${n}번 라인 텍스트`;
  }
}
