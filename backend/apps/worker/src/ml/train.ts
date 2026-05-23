// L1-regularized logistic regression with mini-batch SGD + proximal L1.
//
// Why this rather than a library:
//   - Pure Node (no Python infra)
//   - Sparse features per sample (~80 non-zero out of ~60K) → linear-in-
//     active-features per update step, very fast
//   - L1 via proximal gradient zeros out unimportant weights
//   - Warm-startable from prior model weights (re-training stays cheap)
//
// Training time on the current dataset (112K games × ~80 features × 10
// epochs) is well under 2 minutes in pure Node.

import { type FeatureDict, type SparseVector, vectorizeRaw, type RawSample } from './features.js';

export interface TrainSample {
  features: SparseVector;
  label: 0 | 1;
}

export interface TrainOptions {
  lambda: number;            // L1 strength (try 1e-5 to 1e-3)
  learningRate: number;      // 0.05 ~ 0.2
  epochs: number;            // 5 ~ 15
  batchSize: number;         // 256 typical
  testFraction: number;      // 0.2 — time-aware: last N% is test
  seed: number;              // for shuffle / determinism
  warmStart?: Float32Array;  // optional initial weights (must match dict.size())
  verbose?: boolean;
}

export interface TrainResult {
  weights: Float32Array;     // length = dict.size()
  liveWeights: number;       // non-zero count after L1
  trainAuc: number;
  testAuc: number;
  testLogLoss: number;
  trainSize: number;
  testSize: number;
}

/** Deterministic shuffle using xorshift32 for reproducibility. */
function shuffle<T>(arr: T[], seed: number): void {
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s = s >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

/** Dot product of weights with sparse feature indicator vector. */
function dot(weights: Float32Array, features: SparseVector): number {
  let s = 0;
  for (let i = 0; i < features.length; i++) s += weights[features[i]!]!;
  return s;
}

/** Log-loss for a single (label, prob) pair. */
function logLoss(y: number, p: number): number {
  const eps = 1e-15;
  const pc = Math.max(eps, Math.min(1 - eps, p));
  return -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
}

/** Trapezoidal AUC computation. Inputs: parallel arrays of (score, label). */
function computeAuc(scores: number[], labels: number[]): number {
  const n = scores.length;
  const idx = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => scores[b]! - scores[a]!);
  let tp = 0, fp = 0;
  const pos = labels.reduce((s, l) => s + l, 0);
  const neg = n - pos;
  if (pos === 0 || neg === 0) return 0.5;
  let auc = 0;
  let prevTpr = 0, prevFpr = 0;
  for (const i of idx) {
    if (labels[i] === 1) tp++; else fp++;
    const tpr = tp / pos, fpr = fp / neg;
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
    prevTpr = tpr; prevFpr = fpr;
  }
  return auc;
}

export function train(
  samples: TrainSample[],
  dictSize: number,
  opts: TrainOptions,
): TrainResult {
  // Time-aware split: assume samples are pre-sorted oldest→newest at the
  // caller level. Last testFraction goes to test.
  const splitAt = Math.floor(samples.length * (1 - opts.testFraction));
  const train = samples.slice(0, splitAt);
  const test = samples.slice(splitAt);
  if (opts.verbose) console.log(`[train] split: ${train.length} train / ${test.length} test`);

  const weights = opts.warmStart
    ? new Float32Array(opts.warmStart)
    : new Float32Array(dictSize);
  // L1 shrinkage amount per step.
  const l1Step = opts.learningRate * opts.lambda;

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    // Shuffle training set indices per epoch.
    const order = Array.from({ length: train.length }, (_, i) => i);
    shuffle(order, opts.seed + epoch);

    let lossSum = 0;
    for (let b = 0; b < train.length; b += opts.batchSize) {
      const end = Math.min(b + opts.batchSize, train.length);
      // Accumulate gradient over batch — but for sparse features and
      // simplicity, apply per-sample updates (true SGD). Still fast.
      for (let k = b; k < end; k++) {
        const s = train[order[k]!]!;
        const z = dot(weights, s.features);
        const p = sigmoid(z);
        const grad = p - s.label;
        // Update only active features (sparse): w_i -= lr * grad * x_i = lr*grad (since x_i=1)
        const step = opts.learningRate * grad;
        for (let i = 0; i < s.features.length; i++) {
          weights[s.features[i]!]! -= step;
        }
        lossSum += logLoss(s.label, p);
      }
      // Proximal L1: shrink ALL weights toward 0 by l1Step.
      // (Done per batch to amortize cost.)
      for (let i = 1; i < weights.length; i++) {   // skip bias (i=0)
        const w = weights[i]!;
        if (w > l1Step) weights[i] = w - l1Step;
        else if (w < -l1Step) weights[i] = w + l1Step;
        else weights[i] = 0;
      }
    }
    if (opts.verbose) {
      const avgLoss = lossSum / train.length;
      console.log(`[train] epoch ${epoch+1}/${opts.epochs}: avg loss ${avgLoss.toFixed(4)}`);
    }
  }

  // Evaluate on train + test
  const trainScores: number[] = [], trainLabels: number[] = [];
  for (const s of train) {
    const p = sigmoid(dot(weights, s.features));
    trainScores.push(p); trainLabels.push(s.label);
  }
  const testScores: number[] = [], testLabels: number[] = [];
  let testLoss = 0;
  for (const s of test) {
    const p = sigmoid(dot(weights, s.features));
    testScores.push(p); testLabels.push(s.label);
    testLoss += logLoss(s.label, p);
  }
  const liveWeights = weights.reduce((acc, w) => acc + (w !== 0 ? 1 : 0), 0);

  return {
    weights,
    liveWeights,
    trainAuc: computeAuc(trainScores, trainLabels),
    testAuc: computeAuc(testScores, testLabels),
    testLogLoss: testLoss / test.length,
    trainSize: train.length,
    testSize: test.length,
  };
}

/** Convenience: vectorize raw samples in time order, then train. */
export function vectorizeAndTrain(
  rawSamples: Array<{ championIds: number[]; bluewin: boolean }>,
  dict: FeatureDict,
  opts: TrainOptions,
): TrainResult {
  const samples: TrainSample[] = rawSamples.map((r) => ({
    features: vectorizeRaw(r, dict),
    label: r.bluewin ? 1 : 0,
  }));
  return train(samples, dict.size(), opts);
}
