// Shared response types for the Fastify backend. Mirrors the shapes returned
// by apps/api/src/routes/*.ts. Keep in sync manually for now; switch to Zod
// schemas once the API surface stabilizes.

export type Lane = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
export type Bracket = 'emerald+' | 'diamond+' | 'master+' | 'gm+' | 'challenger';

export interface ChampionTierRow {
  championId: number;
  lane: Lane;
  wr: number;        // 0-100
  pickrate: number;  // 0-100
  banrate: number;   // 0-100
  n: number;
  avgKda: number | null;
}

export interface ChampionTierResponse {
  patch: string;
  bracket: Bracket;
  lane: Lane | 'all';
  generatedAt?: string;
  totalSample: number;
  rows: ChampionTierRow[];
  message?: string;
}

export interface ChampionTierMeta {
  available: Array<{ patch: string; bracket: string }>;
}
