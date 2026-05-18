// Builds the engine-shaped PickData from the API response. Engine consumes
// champion KEYS (e.g. "Aatrox"), but the API gives championIds — convert via
// the Data Dragon meta lookup.

import type { PickData, Lane, ChampionMeta } from '@/lib/pick-types';
import type { ChampionMeta as DdChampionMeta } from '@/lib/champion-meta';

interface PickRecommendApi {
  patch: string;
  bracket: string;
  laneAvgWr?: Record<Lane, number>;
  tier: Array<{ championId: number; lane: Lane; wr: number; pickrate: number; banrate: number; n: number; tierScore: number | null; apShare?: number | null; adShare?: number | null }>;
  tierPrev?: Array<{ championId: number; lane: Lane; wr: number; pickrate: number; banrate: number; n: number }>;
  matchups: Array<{ a: number; b: number; lane: Lane; wr: number; n: number }>;
  synergies: Array<{ a: number; b: number; wr: number; n: number }>;
  botDuos?: Array<{ adcId: number; supId: number; wr: number; n: number; delta: number }>;
  copickProbs?: Array<{ anchorRole: string; anchorId: number; partnerRole: string; partnerId: number; prob: number }>;
}

interface DdMeta {
  byId: Map<number, { id: string; name: string; tags: string[]; info?: { difficulty?: number } }>;
  byKey: Map<string, { id: string; name: string; tags: string[]; info?: { difficulty?: number } }>;
}

const ROLE_MAP: Record<string, string> = {
  Tank: 'Tank', Fighter: 'Bruiser', Mage: 'Mage',
  Marksman: 'Marksman', Assassin: 'Assassin', Support: 'Support',
};

const LANES: Lane[] = ['top', 'jungle', 'mid', 'adc', 'support'];

// Heuristic champion archetype defaults from Riot tags. Composition analysis
// (engage / hard-CC / AD-AP balance) was always reading zeros because the
// previous build only set the cosmetic `role` field. This is rougher than the
// hand-curated table in lib/pick-data.ts but covers all 170+ champs.
type MetaShape = Pick<ChampionMeta,
  'damageType' | 'ccLevel' | 'engageType' | 'scaling' | 'waveClear' | 'archetypeAffinity' | 'blindPickSafe'>;
function inferMeta(tags: string[]): MetaShape {
  const t = new Set(tags);
  const isTank = t.has('Tank');
  const isFighter = t.has('Fighter');
  const isMage = t.has('Mage');
  const isMarksman = t.has('Marksman');
  const isAssassin = t.has('Assassin');
  const isSupport = t.has('Support');

  let damageType: ChampionMeta['damageType'] = 'Mixed';
  if (isMarksman) damageType = 'AD';
  else if (isMage) damageType = isAssassin || isFighter ? 'Mixed' : 'AP';
  else if (isFighter || isAssassin) damageType = 'AD';
  else if (isSupport) damageType = isTank ? 'Mixed' : 'AP';
  else if (isTank) damageType = 'Mixed';

  let ccLevel = 0;
  if (isTank) ccLevel = 3;
  else if (isSupport && !isMarksman) ccLevel = 2;
  else if (isMage) ccLevel = 1;
  else if (isFighter) ccLevel = 1;

  let engageType: ChampionMeta['engageType'] = 'none';
  if (isTank) engageType = 'hard';
  else if (isFighter && !isMarksman) engageType = 'soft';
  else if (isAssassin) engageType = 'pick';
  else if (isMage && isSupport) engageType = 'soft';

  const archetypeAffinity: string[] = [];
  if (isTank) archetypeAffinity.push('engage');
  if (isAssassin) archetypeAffinity.push('pick');
  if (isMage && !isAssassin) archetypeAffinity.push('poke');
  if (isSupport && !isTank) archetypeAffinity.push('protect');
  if (isFighter && !isTank) archetypeAffinity.push('split');

  return {
    damageType,
    ccLevel,
    engageType,
    scaling: isMarksman || (isMage && !isAssassin) ? 'late' : 'mid',
    waveClear: isMage ? 2 : isMarksman ? 1 : isFighter ? 1 : 0,
    archetypeAffinity,
    // Mage / Marksman / Enchanter-y picks tend to be blind-pick safer; melee
    // fighters/assassins less so. Rough cutoff.
    blindPickSafe: isMage || isMarksman || (isSupport && !isFighter),
  };
}

export function buildPickData(api: PickRecommendApi, meta: DdMeta): PickData {
  // Build CHAMPIONS — one entry per known champion in the dd meta. Lanes are
  // populated from the API tier rows (only lanes the champ actually plays).
  const CHAMPIONS: Record<string, ChampionMeta> = {};
  // Default damageRatio from binary damageType — overridden below when real
  // build data is available.
  const fallbackRatio = (dt: ChampionMeta['damageType']) =>
    dt === 'AD' ? { ap: 0, ad: 1 } :
    dt === 'AP' ? { ap: 1, ad: 0 } :
                  { ap: 0.5, ad: 0.5 };

  for (const c of meta.byKey.values()) {
    const tags = c.tags ?? [];
    const inferred = inferMeta(tags);
    CHAMPIONS[c.id] = {
      nameKr: c.name,
      lanes: [],
      role: tags.map((t) => ROLE_MAP[t] ?? t),
      difficulty: c.info?.difficulty ?? 5,
      ...inferred,
      damageRatio: fallbackRatio(inferred.damageType),
    };
  }

  // Aggregate per-champion ap/ad shares (weighted average across lanes by
  // games), then overwrite damageRatio when the aggregator has populated it.
  const ratioAccum = new Map<string, { apW: number; adW: number; total: number }>();
  for (const t of api.tier) {
    if (t.apShare == null || t.adShare == null) continue;
    const champ = meta.byId.get(t.championId);
    if (!champ) continue;
    const cur = ratioAccum.get(champ.id) ?? { apW: 0, adW: 0, total: 0 };
    cur.apW += t.apShare * t.n;
    cur.adW += t.adShare * t.n;
    cur.total += t.n;
    ratioAccum.set(champ.id, cur);
  }
  for (const [key, v] of ratioAccum) {
    if (v.total <= 0) continue;
    const ap = v.apW / v.total;
    const ad = v.adW / v.total;
    const sum = ap + ad;
    if (sum > 0 && CHAMPIONS[key]) {
      CHAMPIONS[key].damageRatio = { ap: ap / sum, ad: ad / sum };
    }
  }

  // TIER_DATA + populate CHAMPIONS.lanes
  const TIER_DATA: PickData['TIER_DATA'] = {};
  const MIN_LANE_PICKRATE = 1.5;
  const MIN_LANE_GAMES = 50;
  for (const t of api.tier) {
    const champ = meta.byId.get(t.championId);
    if (!champ) continue;
    const key = champ.id;
    if (!TIER_DATA[key]) TIER_DATA[key] = {};
    TIER_DATA[key][t.lane] = {
      wr: t.wr, pickrate: t.pickrate, banrate: t.banrate, n: t.n,
      // Aggregator now writes tier_score directly; fall through to null only
      // when no rated participants existed yet (engine has a raw-stats path).
      tierScore: t.tierScore ?? null,
    };
    if (CHAMPIONS[key] && t.pickrate >= MIN_LANE_PICKRATE && t.n >= MIN_LANE_GAMES && !CHAMPIONS[key].lanes.includes(t.lane)) {
      CHAMPIONS[key].lanes.push(t.lane);
    }
  }
  // Fallback: a champ that didn't pass threshold still needs a lanes[].
  for (const key of Object.keys(CHAMPIONS)) {
    if (CHAMPIONS[key].lanes.length === 0 && TIER_DATA[key]) {
      let bestLane: string | null = null;
      let bestN = 0;
      for (const ln of LANES) {
        const st = TIER_DATA[key][ln];
        if (st && st.n > bestN) { bestN = st.n; bestLane = ln; }
      }
      if (bestLane) CHAMPIONS[key].lanes.push(bestLane);
    }
  }

  // TIER_DATA_PREV from snapshot (≥3 days old) — tier-engine.detectTrend
  // diffs current vs this. Without it, trend was stuck at "stable / 0%".
  let TIER_DATA_PREV: PickData['TIER_DATA_PREV'];
  if (api.tierPrev && api.tierPrev.length > 0) {
    TIER_DATA_PREV = {};
    for (const t of api.tierPrev) {
      const champ = meta.byId.get(t.championId);
      if (!champ) continue;
      const key = champ.id;
      if (!TIER_DATA_PREV[key]) TIER_DATA_PREV[key] = {};
      TIER_DATA_PREV[key][t.lane] = { wr: t.wr, pickrate: t.pickrate, banrate: t.banrate, n: t.n };
    }
  }

  // MATCHUPS — { lane: { a: { b: {wr, n} } } }, mirrored.
  const MATCHUPS: PickData['MATCHUPS'] = { top: {}, jungle: {}, mid: {}, adc: {}, support: {} };
  for (const m of api.matchups) {
    const aKey = meta.byId.get(m.a)?.id;
    const bKey = meta.byId.get(m.b)?.id;
    if (!aKey || !bKey || !MATCHUPS[m.lane]) continue;
    if (!MATCHUPS[m.lane][aKey]) MATCHUPS[m.lane][aKey] = {};
    MATCHUPS[m.lane][aKey][bKey] = { wr: m.wr, n: m.n };
    if (!MATCHUPS[m.lane][bKey]) MATCHUPS[m.lane][bKey] = {};
    MATCHUPS[m.lane][bKey][aKey] = { wr: Math.round((100 - m.wr) * 100) / 100, n: m.n };
  }

  // SYNERGIES — { a: { b: {wr, n} } }, mirrored.
  const SYNERGIES: PickData['SYNERGIES'] = {};
  for (const s of api.synergies) {
    const aKey = meta.byId.get(s.a)?.id;
    const bKey = meta.byId.get(s.b)?.id;
    if (!aKey || !bKey) continue;
    if (!SYNERGIES[aKey]) SYNERGIES[aKey] = {};
    SYNERGIES[aKey][bKey] = { wr: s.wr, n: s.n };
    if (!SYNERGIES[bKey]) SYNERGIES[bKey] = {};
    SYNERGIES[bKey][aKey] = { wr: s.wr, n: s.n };
  }

  // BOT_DUO_SYNERGY — keyed by champion KEY (ddragon string id).
  // API field names are `adcId`/`supId`/`delta`; previously this used `adc`/`sup`
  // and recomputed delta on the client, so the duo signal was effectively dead.
  const BOT_DUO_SYNERGY: PickData['BOT_DUO_SYNERGY'] = {};
  for (const d of api.botDuos ?? []) {
    const adcKey = meta.byId.get(d.adcId)?.id;
    const supKey = meta.byId.get(d.supId)?.id;
    if (!adcKey || !supKey) continue;
    if (!BOT_DUO_SYNERGY[adcKey]) BOT_DUO_SYNERGY[adcKey] = {};
    BOT_DUO_SYNERGY[adcKey][supKey] = { wr: d.wr, n: d.n, delta: d.delta };
  }

  // COPICK_PROBS — flatten API array into nested
  // { anchorKey: { partnerLane: { partnerKey: prob } } } shape that the engine
  // expects. Previously the engine got an empty object so D.copickProb()
  // always returned null and the predicted-pick distribution lost the "this
  // jungler tends to go with this mid" signal entirely.
  const COPICK_PROBS: NonNullable<PickData['COPICK_PROBS']> = {};
  for (const c of api.copickProbs ?? []) {
    const anchorKey = meta.byId.get(c.anchorId)?.id;
    const partnerKey = meta.byId.get(c.partnerId)?.id;
    if (!anchorKey || !partnerKey) continue;
    const partnerLane = c.partnerRole as Lane;
    if (!LANES.includes(partnerLane)) continue;
    if (!COPICK_PROBS[anchorKey]) COPICK_PROBS[anchorKey] = {};
    const byLane = COPICK_PROBS[anchorKey]!;
    if (!byLane[partnerLane]) byLane[partnerLane] = {};
    byLane[partnerLane]![partnerKey] = c.prob;
  }

  // LANE_META_PRIORS — per-lane normalized pickrate share (sums to 1 per
  // lane). Used as fallback popularity prior in predictEnemyDistribution
  // when no copick anchor exists.
  const LANE_META_PRIORS: NonNullable<PickData['LANE_META_PRIORS']> = {};
  for (const ln of LANES) LANE_META_PRIORS[ln] = {};
  for (const t of api.tier) {
    const champ = meta.byId.get(t.championId);
    if (!champ) continue;
    const bucket = LANE_META_PRIORS[t.lane];
    if (!bucket) continue;
    bucket[champ.id] = t.pickrate || 0.01;
  }
  for (const ln of LANES) {
    const bucket = LANE_META_PRIORS[ln];
    if (!bucket) continue;
    const total = Object.values(bucket).reduce((a, b) => a + b, 0);
    if (total > 0) for (const k of Object.keys(bucket)) bucket[k] = bucket[k]! / total;
  }

  return {
    PATCH: api.patch,
    BRACKET: api.bracket,
    CHAMPIONS,
    TIER_DATA,
    TIER_DATA_PREV,
    TIER_AVG_WR: (api.laneAvgWr ?? {}) as Partial<Record<Lane, number>>,
    MATCHUPS,
    SYNERGIES,
    BOT_DUO_SYNERGY,
    COPICK_PROBS,
    LANE_META_PRIORS,
    nameKr: (key: string) => CHAMPIONS[key]?.nameKr ?? key,
  };
}
