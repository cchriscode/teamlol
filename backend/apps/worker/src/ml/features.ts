// Feature extraction for the pick-recommendation logistic regression.
//
// One game becomes a sparse feature vector:
//   - 1-way: which champion is on which side (340 features: 170 × 2)
//   - 2-way same-team: each unordered pair of champs on blue/red
//   - 2-way cross-team: each (blue_champ, red_champ) ordered pair
//   - 3-way same-team: triples on either side (only top-N frequent ones)
//   - bias
//
// Feature IDs are deterministic given the dictionary, so re-training can
// warm-start from prior weights for matching features.
//
// Cutoffs (≥30 for pairs, ≥50 for triples) keep the feature space small
// (~10-15K live features after L1) and avoid noise from rare combos.

export type Champion = number;
export type Side = 'blue' | 'red';

export interface RawSample {
  championIds: number[];   // length 10, ordered by (team, slot): blue 5 then red 5
  bluewin: boolean;
}

export interface GameState {
  blue: Champion[];        // up to 5
  red:  Champion[];        // up to 5
}

export type FeatureType = 'bias' | 'champ' | 'pair' | 'cross' | 'triple';

export interface FeatureMeta {
  type: FeatureType;
  a?: number;     // champion id
  b?: number;
  c?: number;
  side?: Side;
  ourSide?: Side; // for cross-team
}

export class FeatureDict {
  private idByKey = new Map<string, number>();
  private metaById: FeatureMeta[] = [];
  readonly bias: number;

  constructor() {
    this.bias = this.add('bias|', { type: 'bias' });
  }

  private add(key: string, meta: FeatureMeta): number {
    const existing = this.idByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.metaById.length;
    this.idByKey.set(key, id);
    this.metaById.push(meta);
    return id;
  }

  // 1-way
  champKey(side: Side, c: number): string { return `c|${side}|${c}`; }
  addChamp(side: Side, c: number): number {
    return this.add(this.champKey(side, c), { type: 'champ', a: c, side });
  }
  getChamp(side: Side, c: number): number | undefined {
    return this.idByKey.get(this.champKey(side, c));
  }

  // 2-way same-team (a<b for canonical ordering)
  pairKey(side: Side, a: number, b: number): string {
    const [x, y] = a < b ? [a, b] : [b, a];
    return `p|${side}|${x}|${y}`;
  }
  addPair(side: Side, a: number, b: number): number {
    const [x, y] = a < b ? [a, b] : [b, a];
    return this.add(this.pairKey(side, x, y), { type: 'pair', a: x, b: y, side });
  }
  getPair(side: Side, a: number, b: number): number | undefined {
    return this.idByKey.get(this.pairKey(side, a, b));
  }

  // 2-way cross-team (our champ + their champ); ourSide = which team is "ours"
  // Important: cross features must be SYMMETRIC across game flips — i.e.,
  // a feature for (ourSide=blue, a=Yasuo, b=Riven) should encode the same
  // physical situation as (ourSide=red, a=Yasuo, b=Riven). We store keyed
  // by champ pair only (a<b) and learn separate weights per ourSide so the
  // model captures asymmetric counter directions.
  crossKey(ourSide: Side, ourChamp: number, theirChamp: number): string {
    return `x|${ourSide}|${ourChamp}|${theirChamp}`;
  }
  addCross(ourSide: Side, ourChamp: number, theirChamp: number): number {
    return this.add(this.crossKey(ourSide, ourChamp, theirChamp),
      { type: 'cross', a: ourChamp, b: theirChamp, ourSide });
  }
  getCross(ourSide: Side, ourChamp: number, theirChamp: number): number | undefined {
    return this.idByKey.get(this.crossKey(ourSide, ourChamp, theirChamp));
  }

  // 3-way same-team
  tripleKey(side: Side, a: number, b: number, c: number): string {
    const sorted = [a, b, c].sort((p, q) => p - q);
    const x = sorted[0]!, y = sorted[1]!, z = sorted[2]!;
    return `t|${side}|${x}|${y}|${z}`;
  }
  addTriple(side: Side, a: number, b: number, c: number): number {
    const sorted = [a, b, c].sort((p, q) => p - q);
    const x = sorted[0]!, y = sorted[1]!, z = sorted[2]!;
    return this.add(this.tripleKey(side, x, y, z), { type: 'triple', a: x, b: y, c: z, side });
  }
  getTriple(side: Side, a: number, b: number, c: number): number | undefined {
    return this.idByKey.get(this.tripleKey(side, a, b, c));
  }

  size(): number { return this.metaById.length; }
  lookup(id: number): FeatureMeta | undefined { return this.metaById[id]; }
  entries(): IterableIterator<[string, number]> { return this.idByKey.entries(); }
}

// Sparse vector: list of [featureId, value]. Most values are 1 (binary
// indicator), so we just need the id.
export type SparseVector = number[];   // sorted feature ids

/** Convert a raw 10-champ sample into a sparse feature vector. */
export function vectorizeRaw(sample: RawSample, dict: FeatureDict): SparseVector {
  const blue = sample.championIds.slice(0, 5);
  const red  = sample.championIds.slice(5, 10);
  return vectorize({ blue, red }, dict);
}

/** Convert a partial / full GameState into a sparse feature vector. */
export function vectorize(state: GameState, dict: FeatureDict): SparseVector {
  const out: number[] = [dict.bias];
  // 1-way
  for (const c of state.blue) { const id = dict.getChamp('blue', c); if (id !== undefined) out.push(id); }
  for (const c of state.red)  { const id = dict.getChamp('red',  c); if (id !== undefined) out.push(id); }
  // 2-way same team
  for (let i = 0; i < state.blue.length; i++)
    for (let j = i + 1; j < state.blue.length; j++) {
      const id = dict.getPair('blue', state.blue[i]!, state.blue[j]!);
      if (id !== undefined) out.push(id);
    }
  for (let i = 0; i < state.red.length; i++)
    for (let j = i + 1; j < state.red.length; j++) {
      const id = dict.getPair('red', state.red[i]!, state.red[j]!);
      if (id !== undefined) out.push(id);
    }
  // 2-way cross team — learn from BOTH perspectives so weights are
  // populated whether the user picks for blue or red.
  for (const ourChamp of state.blue)
    for (const theirChamp of state.red) {
      const id = dict.getCross('blue', ourChamp, theirChamp);
      if (id !== undefined) out.push(id);
    }
  for (const ourChamp of state.red)
    for (const theirChamp of state.blue) {
      const id = dict.getCross('red', ourChamp, theirChamp);
      if (id !== undefined) out.push(id);
    }
  // 3-way same team (only those present in dict — sparse)
  for (let i = 0; i < state.blue.length; i++)
    for (let j = i + 1; j < state.blue.length; j++)
      for (let k = j + 1; k < state.blue.length; k++) {
        const id = dict.getTriple('blue', state.blue[i]!, state.blue[j]!, state.blue[k]!);
        if (id !== undefined) out.push(id);
      }
  for (let i = 0; i < state.red.length; i++)
    for (let j = i + 1; j < state.red.length; j++)
      for (let k = j + 1; k < state.red.length; k++) {
        const id = dict.getTriple('red', state.red[i]!, state.red[j]!, state.red[k]!);
        if (id !== undefined) out.push(id);
      }
  return out;
}

// ---- Dictionary builder -------------------------------------------------

export interface DictBuildOptions {
  minPairGames: number;       // include same-team pair feature if seen ≥ N times
  minCrossGames: number;      // include cross feature if seen ≥ N times
  minTripleGames: number;     // include triple feature if seen ≥ N times
  maxTriples: number;         // hard cap on number of triple features (top by frequency)
}

/**
 * Single-pass scan of training samples → frequency table → dict with
 * cutoff applied. Returns dict + diagnostics.
 */
export function buildFeatureDict(
  samples: RawSample[],
  opts: DictBuildOptions = {
    minPairGames: 30,
    minCrossGames: 30,
    minTripleGames: 50,
    maxTriples: 1000,
  },
): { dict: FeatureDict; stats: { pairs: number; cross: number; triples: number; champs: number } } {
  // Count frequencies (string keys for cross-runtime portability).
  const champFreq = new Map<string, number>();   // 'blue|266'
  const pairFreq  = new Map<string, number>();   // 'p|blue|266|142'
  const crossFreq = new Map<string, number>();
  const tripleFreq = new Map<string, number>();

  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const s of samples) {
    const blue = s.championIds.slice(0, 5);
    const red  = s.championIds.slice(5, 10);

    for (const c of blue) bump(champFreq, `c|blue|${c}`);
    for (const c of red)  bump(champFreq, `c|red|${c}`);

    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const a = blue[i]!, b = blue[j]!;
        const [x, y] = a < b ? [a, b] : [b, a];
        bump(pairFreq, `p|blue|${x}|${y}`);
      }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const a = red[i]!, b = red[j]!;
        const [x, y] = a < b ? [a, b] : [b, a];
        bump(pairFreq, `p|red|${x}|${y}`);
      }

    for (const ourC of blue) for (const theirC of red) bump(crossFreq, `x|blue|${ourC}|${theirC}`);
    for (const ourC of red)  for (const theirC of blue) bump(crossFreq, `x|red|${ourC}|${theirC}`);

    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++) {
          const [x, y, z] = [blue[i]!, blue[j]!, blue[k]!].sort((p, q) => p - q);
          bump(tripleFreq, `t|blue|${x}|${y}|${z}`);
        }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++)
        for (let k = j + 1; k < 5; k++) {
          const [x, y, z] = [red[i]!, red[j]!, red[k]!].sort((p, q) => p - q);
          bump(tripleFreq, `t|red|${x}|${y}|${z}`);
        }
  }

  // Build dict (apply cutoffs).
  const dict = new FeatureDict();
  let champsAdded = 0, pairsAdded = 0, crossAdded = 0, triplesAdded = 0;

  // Champs: always add if seen at least once (170 × 2 = 340 max, tiny).
  for (const [key, n] of champFreq) {
    if (n < 1) continue;
    const [, side, c] = key.split('|');
    dict.addChamp(side as Side, Number(c));
    champsAdded += 1;
  }
  // Pairs
  for (const [key, n] of pairFreq) {
    if (n < opts.minPairGames) continue;
    const [, side, a, b] = key.split('|');
    dict.addPair(side as Side, Number(a), Number(b));
    pairsAdded += 1;
  }
  // Cross
  for (const [key, n] of crossFreq) {
    if (n < opts.minCrossGames) continue;
    const [, ourSide, a, b] = key.split('|');
    dict.addCross(ourSide as Side, Number(a), Number(b));
    crossAdded += 1;
  }
  // Triples — apply hard cap by frequency desc
  const tripleSorted = [...tripleFreq.entries()]
    .filter(([, n]) => n >= opts.minTripleGames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.maxTriples);
  for (const [key] of tripleSorted) {
    const [, side, a, b, c] = key.split('|');
    dict.addTriple(side as Side, Number(a), Number(b), Number(c));
    triplesAdded += 1;
  }

  return {
    dict,
    stats: { pairs: pairsAdded, cross: crossAdded, triples: triplesAdded, champs: champsAdded },
  };
}
