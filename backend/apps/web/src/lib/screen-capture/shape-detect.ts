// OpenCV-based shape detection for champ-select slots.
//
// Picks:  HoughCircles in left + right pick columns. The portraits sit in
//         circular UI frames so even an empty (unpicked) slot is detectable
//         — pHash alone can't find these because there's no champion image
//         to match.
// Bans:   contour-find rectangular regions in top-left + top-right strips.
//
// Output: candidate slot centers + radii / rect sizes per region. Caller
// post-processes (filter by 5-per-region, vertical/horizontal alignment).

import { ensureOpenCv, type OpenCV } from './opencv-loader';

export type DetectRegion = 'myPick' | 'enemyPick' | 'myBan' | 'enemyBan';

export interface CircleHit {
  cx: number; cy: number; r: number;
  region: DetectRegion;
}
export interface RectHit {
  cx: number; cy: number; w: number; h: number;
  region: DetectRegion;
}

/**
 * Detect circular pick slots inside a rectangular subregion of the
 * captured frame. Returns up to ~12 candidates per region — caller
 * filters to the strongest 5 with vertical alignment.
 */
export async function detectPickCircles(
  sourceCanvas: HTMLCanvasElement,
  regionRect: { x: number; y: number; w: number; h: number },
  regionName: 'myPick' | 'enemyPick',
  expectedRadius: number,         // best guess for the portrait radius in source pixels
): Promise<CircleHit[]> {
  const cv = await ensureOpenCv();

  // Crop the region into a fresh canvas so we feed cv.imread a small image
  // (faster) and don't have to translate coords back.
  const sub = document.createElement('canvas');
  sub.width = regionRect.w;
  sub.height = regionRect.h;
  const sctx = sub.getContext('2d');
  if (!sctx) return [];
  sctx.drawImage(
    sourceCanvas,
    regionRect.x, regionRect.y, regionRect.w, regionRect.h,
    0, 0, regionRect.w, regionRect.h,
  );

  const src  = cv.imread(sub);
  const gray = new cv.Mat();
  const circles = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // Mild blur stabilises HoughCircles against the glow/border noise on
    // selected slots.
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 1.5, 1.5);

    const minR = Math.max(8, Math.round(expectedRadius * 0.75));
    const maxR = Math.round(expectedRadius * 1.30);
    // minDist ~ 2× radius keeps detector from clustering multiple hits
    // on the same portrait.
    const minDist = Math.max(20, Math.round(expectedRadius * 1.6));
    cv.HoughCircles(
      gray, circles, cv.HOUGH_GRADIENT,
      /* dp */ 1,
      /* minDist */ minDist,
      /* param1 (Canny upper) */ 100,
      /* param2 (accumulator threshold) */ 28,
      minR, maxR,
    );

    const out: CircleHit[] = [];
    // HoughCircles output is a 1×N×3 Mat: [cx, cy, r] triples.
    for (let i = 0; i < circles.cols; i++) {
      const cx = circles.data32F[i * 3];
      const cy = circles.data32F[i * 3 + 1];
      const r  = circles.data32F[i * 3 + 2];
      if (cx === undefined || cy === undefined || r === undefined) continue;
      out.push({
        cx: regionRect.x + cx,
        cy: regionRect.y + cy,
        r,
        region: regionName,
      });
    }
    return out;
  } finally {
    src.delete(); gray.delete(); circles.delete();
  }
}

/**
 * Detect small rectangular ban slots via contour-find on a thresholded
 * edge image. Bans are typically a 5-icon row at the top corners.
 */
export async function detectBanRects(
  sourceCanvas: HTMLCanvasElement,
  regionRect: { x: number; y: number; w: number; h: number },
  regionName: 'myBan' | 'enemyBan',
  expectedSize: number,
): Promise<RectHit[]> {
  const cv = await ensureOpenCv();

  const sub = document.createElement('canvas');
  sub.width = regionRect.w;
  sub.height = regionRect.h;
  const sctx = sub.getContext('2d');
  if (!sctx) return [];
  sctx.drawImage(
    sourceCanvas,
    regionRect.x, regionRect.y, regionRect.w, regionRect.h,
    0, 0, regionRect.w, regionRect.h,
  );

  const src   = cv.imread(sub);
  const gray  = new cv.Mat();
  const edges = new cv.Mat();
  const cont  = new cv.MatVector();
  const hier  = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Canny(gray, edges, 60, 160);
    // Close gaps in the rectangle outline so findContours can pick up
    // dashed borders.
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    kernel.delete();

    cv.findContours(edges, cont, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const out: RectHit[] = [];
    const minSide = Math.max(8, Math.round(expectedSize * 0.6));
    const maxSide = Math.round(expectedSize * 1.6);
    for (let i = 0; i < cont.size(); i++) {
      const c = cont.get(i);
      const r = cv.boundingRect(c);
      c.delete();
      // Filter by size + squareness.
      if (r.width < minSide || r.width > maxSide) continue;
      if (r.height < minSide || r.height > maxSide) continue;
      const ratio = r.width / r.height;
      if (ratio < 0.7 || ratio > 1.4) continue;
      out.push({
        cx: regionRect.x + r.x + r.width / 2,
        cy: regionRect.y + r.y + r.height / 2,
        w: r.width,
        h: r.height,
        region: regionName,
      });
    }
    return out;
  } finally {
    src.delete(); gray.delete(); edges.delete(); cont.delete(); hier.delete();
  }
}

/** Reusable initialization probe for UI status — resolves once cv is ready. */
export async function warmupOpenCv(): Promise<OpenCV> {
  return ensureOpenCv();
}
