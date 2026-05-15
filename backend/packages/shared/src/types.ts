// Shared domain types used across packages.

export type Lane = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export const LANES: readonly Lane[] = ['top', 'jungle', 'mid', 'adc', 'support'] as const;

export type ChampionKey = string; // ddragon "key" e.g. "Aatrox"
export type ChampionId = number;  // Riot numeric id (e.g. 266 for Aatrox)
export type ItemId = number;
export type SpellKey = string;    // e.g. "SummonerFlash"

export type Region =
  | 'kr' | 'na1' | 'euw1' | 'eun1' | 'jp1'
  | 'br1' | 'la1' | 'la2' | 'oc1'
  | 'tr1' | 'ru' | 'vn2' | 'tw2' | 'sg2' | 'ph2' | 'th2';

// Regional routing — used by ACCOUNT-V1 and MATCH-V5
export type RegionalRoute = 'asia' | 'americas' | 'europe' | 'sea';

export const REGION_TO_REGIONAL: Record<Region, RegionalRoute> = {
  kr: 'asia', jp1: 'asia',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  oc1: 'sea', vn2: 'sea', tw2: 'sea', sg2: 'sea', ph2: 'sea', th2: 'sea',
};

// Tier brackets used in our aggregations.
// Limited to high elo — we seed from Chal/GM so anything below Emerald has
// effectively no sample. Platinum and lower are dropped to avoid misleading
// "Platinum+ stats" labels backed by 0 actual platinum players.
export type Bracket = 'emerald+' | 'diamond+' | 'master+' | 'gm+' | 'challenger';
export const BRACKETS: readonly Bracket[] = [
  'emerald+', 'diamond+', 'master+', 'gm+', 'challenger',
] as const;

export type RankedTier =
  | 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'EMERALD'
  | 'DIAMOND' | 'MASTER' | 'GRANDMASTER' | 'CHALLENGER';

/**
 * Tier sets per bracket (cumulative — "diamond+" includes higher tiers).
 * 'challenger' is the only non-cumulative bracket (top only).
 */
export const TIERS_FOR_BRACKET: Record<Bracket, readonly RankedTier[]> = {
  'challenger':  ['CHALLENGER'],
  'gm+':         ['CHALLENGER', 'GRANDMASTER'],
  'master+':     ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
  'diamond+':    ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'],
  'emerald+':    ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD'],
};

export type Division = 'I' | 'II' | 'III' | 'IV';

export type QueueType = 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';

// Queue IDs (Riot constants we care about)
export const QUEUE_ID = {
  SOLO: 420,
  FLEX: 440,
  ARAM: 450,
  NORMAL_DRAFT: 400,
  CLASH: 700,
} as const;

// Pick recommend / AI Score share these match-shape primitives.
export type DraftStatus = 'confirmed' | 'intent' | 'empty';

// PUUID is a 78-char string. Type alias for clarity.
export type Puuid = string;

// Riot ID is gameName#tagLine.
export interface RiotId {
  gameName: string;
  tagLine: string;
}

export function parseRiotId(s: string): RiotId | null {
  const idx = s.lastIndexOf('#');
  if (idx <= 0 || idx === s.length - 1) return null;
  return { gameName: s.slice(0, idx).trim(), tagLine: s.slice(idx + 1).trim() };
}

export function formatRiotId(r: RiotId): string {
  return `${r.gameName}#${r.tagLine}`;
}
