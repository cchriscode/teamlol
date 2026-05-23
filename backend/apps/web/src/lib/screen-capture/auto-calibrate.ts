// Auto-calibrate slot positions from a live LoL champ-select capture.
//
// Strategy:
//   1. Restrict search to 4 regions of the frame (bans top-left/right,
//      picks left/right columns). Full-screen sliding pHash would be
//      ~30× more expensive.
//   2. At each step, crop a 56×56 sub-window and pHash-match against the
//      full champion roster. Strong matches (distance ≤ threshold) are
//      kept as candidates.
//   3. Cluster nearby candidates (same icon sampled at adjacent positions)
//      into single spots at the weighted centroid.
//   4. Per region, take the strongest clusters and extrapolate to exactly
//      5 slots — if only 2 picks are visible during early champ select,
//      we infer the remaining 3 by the median spacing between found
//      candidates.
//   5. Lane TEXT positions are derived from my-pick positions (text sits
//      at a fixed offset to the right of each player's champion portrait).
//
// Caveat: assumes 16:9 aspect ratio with a normal-scale LoL UI. Ultrawide
// or non-default UI scales may need manual fallback.

import type { CaptureSession } from './capture';
import { matchChampion } from './champion-matcher';

export type SlotKind = 'myPick' | 'enemyPick' | 'myBan' | 'enemyBan' | 'myLane';

export interface CalSlotRect {
  kind: SlotKind;
  idx: number;
  x: number; y: number; w: number; h: number;
  label: string;
}

export interface AutoCalProgress {
  phase: 'scan' | 'cluster' | 'done';
  region?: string;
  done: number;
  total: number;
}

export interface AutoCalResult {
  slots: CalSlotRect[];
  diagnostics: {
    frameW: number; frameH: number;
    foundByRegion: Record<string, number>;
    extrapolated: Record<string, number>;
  };
}

// Sliding-window parameters.
const STEP = 12;                  // pixel stride between samples
const PHASH_WINDOW = 56;          // size of the crop sampled at each position
const PICK_THRESHOLD = 16;        // hamming distance below which it's a candidate
const BAN_THRESHOLD  = 20;        // bans look noisier (X overlay)
const CLUSTER_RADIUS = 30;        // candidates within this distance merge

type Region = 'myBan' | 'enemyBan' | 'myPick' | 'enemyPick';
interface Candidate {
  cx: number; cy: number;
  champ: string;
  d: number;
  region: Region;
}
interface Cluster extends Candidate {
  weight: number;
}

const SLOT_HALF_PICK = 32;
const SLOT_HALF_BAN  = 20;
const LANE_HALF_W    = 60;
const LANE_HALF_H    = 14;

export async function autoCalibrate(
  session: CaptureSession,
  onProgress?: (p: AutoCalProgress) => void,
): Promise<AutoCalResult> {
  const W = session.width;
  const H = session.height;

  // Fractional regions — measured from the reference LoL champ-select
  // screenshot at 16:9. Bans live in a small strip at the very top-left
  // and top-right (above the pick columns), NOT a wide horizontal band.
  // Pick columns hug the side edges and span ~9-84% vertically.
  const regions: Array<{ name: Region; threshold: number; rect: { x: number; y: number; w: number; h: number } }> = [
    // Top-left ban strip: ~18% wide × ~6% tall is tight enough to hit the 5
    // ban icons without bleeding into the pick column below.
    { name: 'myBan',     threshold: BAN_THRESHOLD,  rect: { x: 0,                    y: 0,                    w: Math.round(0.20 * W), h: Math.round(0.07 * H) } },
    { name: 'enemyBan',  threshold: BAN_THRESHOLD,  rect: { x: Math.round(0.80 * W), y: 0,                    w: Math.round(0.20 * W), h: Math.round(0.07 * H) } },
    // Pick columns: start just below the ban strip, end above the bottom
    // skin row. 18% wide leaves room for the portrait+name area without
    // pulling in the center splash art.
    { name: 'myPick',    threshold: PICK_THRESHOLD, rect: { x: 0,                    y: Math.round(0.08 * H), w: Math.round(0.18 * W), h: Math.round(0.78 * H) } },
    { name: 'enemyPick', threshold: PICK_THRESHOLD, rect: { x: Math.round(0.82 * W), y: Math.round(0.08 * H), w: Math.round(0.18 * W), h: Math.round(0.78 * H) } },
  ];

  const candidates: Candidate[] = [];

  for (const region of regions) {
    const positions: Array<{ x: number; y: number }> = [];
    for (let y = region.rect.y; y <= region.rect.y + region.rect.h - PHASH_WINDOW; y += STEP) {
      for (let x = region.rect.x; x <= region.rect.x + region.rect.w - PHASH_WINDOW; x += STEP) {
        positions.push({ x, y });
      }
    }
    const total = positions.length;
    let done = 0;
    onProgress?.({ phase: 'scan', region: region.name, done, total });

    for (const pos of positions) {
      const sub = session.cropFrame({ x: pos.x, y: pos.y, w: PHASH_WINDOW, h: PHASH_WINDOW });
      done += 1;
      if (!sub) continue;
      const matches = matchChampion(sub, 1);
      const top = matches[0];
      if (top && top.distance <= region.threshold) {
        candidates.push({
          cx: pos.x + PHASH_WINDOW / 2,
          cy: pos.y + PHASH_WINDOW / 2,
          champ: top.championKey,
          d: top.distance,
          region: region.name,
        });
      }
      // Yield every 80 samples so the spinner repaints and the tab stays
      // responsive — synchronous pHash blocks the main thread otherwise.
      if (done % 80 === 0) {
        onProgress?.({ phase: 'scan', region: region.name, done, total });
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
    onProgress?.({ phase: 'scan', region: region.name, done: total, total });
  }

  onProgress?.({ phase: 'cluster', done: 0, total: candidates.length });

  // Spatial clustering per region.
  const clusters: Cluster[] = [];
  for (const c of candidates) {
    const existing = clusters.find((cl) =>
      cl.region === c.region &&
      Math.hypot(cl.cx - c.cx, cl.cy - c.cy) < CLUSTER_RADIUS
    );
    if (existing) {
      const w = existing.weight + 1;
      existing.cx = (existing.cx * existing.weight + c.cx) / w;
      existing.cy = (existing.cy * existing.weight + c.cy) / w;
      existing.weight = w;
      if (c.d < existing.d) { existing.d = c.d; existing.champ = c.champ; }
    } else {
      clusters.push({ ...c, weight: 1 });
    }
  }

  // Reject one-shot noise — a real icon spans several adjacent samples.
  const solidClusters = clusters.filter((c) => c.weight >= 2);

  const slots: CalSlotRect[] = [];
  const foundByRegion: Record<string, number> = {};
  const extrapolated: Record<string, number> = {};

  for (const region of regions) {
    let regionClusters = solidClusters.filter((c) => c.region === region.name);
    foundByRegion[region.name] = regionClusters.length;
    if (regionClusters.length === 0) {
      extrapolated[region.name] = 0;
      continue;
    }

    const isBan = region.name === 'myBan' || region.name === 'enemyBan';
    // Primary axis: bans line up horizontally (sort by x), picks vertically (sort by y).
    const axis: 'x' | 'y' = isBan ? 'x' : 'y';
    regionClusters.sort((a, b) => axis === 'x' ? a.cx - b.cx : a.cy - b.cy);

    // Use lowest-distance 5 first; if fewer than 5, extrapolate.
    const top5 = [...regionClusters].sort((a, b) => a.d - b.d).slice(0, 5);
    top5.sort((a, b) => axis === 'x' ? a.cx - b.cx : a.cy - b.cy);

    const positions: Array<{ x: number; y: number }> = top5.map((c) => ({ x: c.cx, y: c.cy }));

    if (positions.length < 5 && positions.length >= 1) {
      // Compute median stride along primary axis from gaps between consecutive found.
      let stride = 0;
      if (positions.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < positions.length; i++) {
          gaps.push(axis === 'x' ? positions[i]!.x - positions[i - 1]!.x : positions[i]!.y - positions[i - 1]!.y);
        }
        gaps.sort((a, b) => a - b);
        stride = gaps[Math.floor(gaps.length / 2)]!;
      } else {
        // Single candidate — fall back to a frame-relative default.
        stride = isBan ? Math.round(0.06 * W) : Math.round(0.16 * H);
      }
      // Cross-axis fixed at median of found.
      const crossValues = positions.map((p) => axis === 'x' ? p.y : p.x).sort((a, b) => a - b);
      const crossMedian = crossValues[Math.floor(crossValues.length / 2)]!;

      // Anchor: leftmost/topmost found position. Generate 5 positions
      // starting from that anchor; keep the found ones and fill the rest.
      const anchor = axis === 'x' ? positions[0]!.x : positions[0]!.y;
      const filled: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 5; i++) {
        const v = anchor + i * stride;
        filled.push(axis === 'x' ? { x: v, y: crossMedian } : { x: crossMedian, y: v });
      }
      // Replace generated positions with the actual found ones where they
      // align (within stride/2) so we keep precise coords for confirmed picks.
      for (const found of positions) {
        let bestI = 0, bestDelta = Infinity;
        for (let i = 0; i < 5; i++) {
          const delta = axis === 'x'
            ? Math.abs(filled[i]!.x - found.x)
            : Math.abs(filled[i]!.y - found.y);
          if (delta < bestDelta) { bestDelta = delta; bestI = i; }
        }
        if (bestDelta < stride / 2) filled[bestI] = found;
      }
      positions.splice(0, positions.length, ...filled);
      extrapolated[region.name] = 5 - top5.length;
    } else {
      extrapolated[region.name] = 0;
    }

    const half = isBan ? SLOT_HALF_BAN : SLOT_HALF_PICK;
    positions.forEach((p, i) => {
      slots.push({
        kind: region.name,
        idx: i,
        x: Math.max(0, Math.round(p.x - half)),
        y: Math.max(0, Math.round(p.y - half)),
        w: half * 2,
        h: half * 2,
        label: labelFor(region.name, i),
      });
    });
  }

  // Lane TEXT slots — derive from my-pick rects. The "상단 (탑)" label
  // sits to the RIGHT of each portrait, on the second text line (below
  // the player name). cy is biased down by ~60% of portrait height so the
  // crop lands on the lane line, not the name line above it.
  const myPicks = slots.filter((s) => s.kind === 'myPick').sort((a, b) => a.idx - b.idx);
  for (const p of myPicks) {
    const cx = p.x + p.w + LANE_HALF_W + 4;       // just right of portrait → text center
    const cy = p.y + Math.round(p.h * 0.60);      // below the name line
    slots.push({
      kind: 'myLane',
      idx: p.idx,
      x: Math.max(0, Math.round(cx - LANE_HALF_W)),
      y: Math.max(0, Math.round(cy - LANE_HALF_H)),
      w: LANE_HALF_W * 2,
      h: LANE_HALF_H * 2,
      label: `우리 ${p.idx + 1}번 라인 텍스트`,
    });
  }

  onProgress?.({ phase: 'done', done: 1, total: 1 });
  return {
    slots,
    diagnostics: { frameW: W, frameH: H, foundByRegion, extrapolated },
  };
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
