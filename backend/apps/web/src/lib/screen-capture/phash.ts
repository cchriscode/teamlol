// 64-bit perceptual hash (DCT-based). Standard recipe:
//   1. Resize to 32x32 grayscale
//   2. 2D DCT
//   3. Take top-left 8x8 (low frequencies)
//   4. Bit = 1 if coefficient > median (excluding DC), else 0
// 64 bits packed into two 32-bit halves (high, low) for Hamming distance
// via XOR + popcount. ~5-8 bits of distance ≈ same image; 25+ ≈ different.

export type PHash = { hi: number; lo: number };

/** Hamming distance between two 64-bit pHashes. */
export function hashDistance(a: PHash, b: PHash): number {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

/** Compute pHash from a canvas/image source (any size, any aspect). */
export function computePHash(source: CanvasImageSource): PHash {
  // 1) Downscale to 32x32 grayscale via an offscreen canvas.
  const SIZE = 32;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  const img = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Grayscale: luma 0.299/0.587/0.114
  const gray = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 2) 2D DCT — we only need the top-left 8x8, so compute that band directly
  //    via the naive O(N^4) formula for the requested coefficients. Inputs
  //    are 32x32 → 32^4 = ~1M ops for the full DCT, fine for a one-off.
  const dct = compute8x8LowFreqDCT(gray, SIZE);

  // 3) Threshold against median of low-freq coefficients (skip DC at [0,0]).
  const flat: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (i === 0) continue; // exclude DC
    flat.push(dct[i]);
  }
  flat.sort((a, b) => a - b);
  const median = flat[Math.floor(flat.length / 2)];

  // 4) Pack 64 bits — but the first cell (DC) is unused; conventional
  //    pHash uses 63 bits + 0 for DC, which still discriminates well.
  let hi = 0, lo = 0;
  for (let i = 0; i < 64; i++) {
    const bit = i === 0 ? 0 : (dct[i] > median ? 1 : 0);
    if (i < 32) hi = (hi | (bit << i)) >>> 0;
    else        lo = (lo | (bit << (i - 32))) >>> 0;
  }
  return { hi, lo };
}

// Compute only the top-left 8x8 DCT-II band of an NxN signal.
function compute8x8LowFreqDCT(input: Float64Array, N: number): Float64Array {
  const out = new Float64Array(64);
  const PI_2N = Math.PI / (2 * N);
  // Precompute cosine table to avoid N^4 trig calls.
  const cos = new Float64Array(8 * N);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < N; x++) {
      cos[u * N + x] = Math.cos((2 * x + 1) * u * PI_2N);
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < N; x++) {
        const cosU = cos[u * N + x];
        for (let y = 0; y < N; y++) {
          sum += input[x * N + y] * cosU * cos[v * N + y];
        }
      }
      out[u * 8 + v] = sum;
    }
  }
  return out;
}
