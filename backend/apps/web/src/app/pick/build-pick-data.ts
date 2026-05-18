// Builds the engine-shaped PickData from the API response. Engine consumes
// champion KEYS (e.g. "Aatrox"), but the API gives championIds — convert via
// the Data Dragon meta lookup.

import type { PickData, Lane, ChampionMeta } from '@/lib/pick-types';
import type { ChampionMeta as DdChampionMeta } from '@/lib/champion-meta';

interface PickRecommendApi {
  patch: string;
  bracket: string;
  laneAvgWr?: Record<Lane, number>;
  tier: Array<{ championId: number; lane: Lane; wr: number; pickrate: number; banrate: number; n: number; psScore: number | null }>;
  matchups: Array<{ a: number; b: number; lane: Lane; wr: number; n: number }>;
  synergies: Array<{ a: number; b: number; wr: number; n: number }>;
  botDuos?: Array<{ adc: number; sup: number; wr: number; n: number }>;
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
  for (const c of meta.byKey.values()) {
    const tags = c.tags ?? [];
    const inferred = inferMeta(tags);
    CHAMPIONS[c.id] = {
      nameKr: c.name,
      lanes: [],
      role: tags.map((t) => ROLE_MAP[t] ?? t),
      difficulty: c.info?.difficulty ?? 5,
      ...inferred,
    };
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
      // Keep null when the aggregator hasn't populated ps_score yet — engine's
      // metaScore falls back to raw-stats math (wr/pickrate/ban) in that case.
      psScore: t.psScore ?? null,
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

  // BOT_DUO_SYNERGY
  const BOT_DUO_SYNERGY: PickData['BOT_DUO_SYNERGY'] = {};
  for (const d of api.botDuos ?? []) {
    const adcKey = meta.byId.get(d.adc)?.id;
    const supKey = meta.byId.get(d.sup)?.id;
    if (!adcKey || !supKey) continue;
    if (!BOT_DUO_SYNERGY[adcKey]) BOT_DUO_SYNERGY[adcKey] = {};
    BOT_DUO_SYNERGY[adcKey][supKey] = { wr: d.wr, n: d.n };
  }

  return {
    PATCH: api.patch,
    BRACKET: api.bracket,
    CHAMPIONS,
    TIER_DATA,
    TIER_AVG_WR: (api.laneAvgWr ?? {}) as Partial<Record<Lane, number>>,
    MATCHUPS,
    SYNERGIES,
    BOT_DUO_SYNERGY,
    nameKr: (key: string) => CHAMPIONS[key]?.nameKr ?? key,
  };
}
