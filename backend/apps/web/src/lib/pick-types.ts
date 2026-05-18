// Types for pick-engine. Loose typing — the engine is an existing JS module
// that operates on these shapes; matching the runtime structure exactly.

export type Lane = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

export interface SlotState {
  pickOrder: number;
  champion?: string;
  lane?: Lane;
  status: 'empty' | 'intent' | 'confirmed';
  isMine?: boolean;
}

export interface DraftState {
  pickPhaseGlobal: number;
  myTeam: SlotState[];
  enemyTeam: SlotState[];
  myBans: string[];
  enemyBans: string[];
  mySide?: 'blue' | 'red';
  tierBracket?: string;
}

export interface ChampionMeta {
  nameKr: string;
  lanes: string[];
  damageType: 'AD' | 'AP' | 'Mixed' | 'True';
  role: string[];
  ccLevel: number;
  engageType: 'none' | 'soft' | 'pick' | 'engage' | 'hard';
  scaling: 'early' | 'mid' | 'late';
  waveClear: number;
  blindPickSafe: boolean;
  difficulty: number;
  archetypeAffinity: string[];
}

export interface PickData {
  PATCH: string;
  BRACKET: string;
  CHAMPIONS: Record<string, ChampionMeta>;
  TIER_DATA: Record<string, Partial<Record<Lane, { wr: number; pickrate: number; banrate: number; n: number; psScore?: number }>>>;
  TIER_AVG_WR: Partial<Record<Lane, number>>;
  MATCHUPS: Record<Lane, Record<string, Record<string, { wr: number; n: number }>>>;
  SYNERGIES: Record<string, Record<string, { wr: number; n: number }>>;
  BOT_DUO_SYNERGY?: Record<string, Record<string, { wr: number; n: number }>>;
  COPICK_PROBS?: Record<string, Record<string, number>>;
  BOT_DUO_ARCHETYPES?: Record<string, { label: string }>;
  // Functions added by data layer:
  nameKr: (key: string) => string;
}

export interface RecommendCandidate {
  champion: string;
  score: number;
  breakdown: Record<string, number>;
  reasonText: string;
  reasonTags: string[];
  masteryInfo: { difficulty: string; message: string; seasonGames: number };
  isBanned: boolean;
  bannedBy: 'us' | 'enemy' | null;
}

export interface RecommendResult {
  candidates: RecommendCandidate[];
  composition: unknown;
  banSuggestions: Array<{ champion: string; reason: string; opScore: number }>;
  predictions: { my: unknown[]; enemy: unknown[] };
  meta: {
    patch: string;
    tierBracket: string;
    sampleStaleness: string;
    scenario: string;
    weights: Record<string, number>;
    computedAt: string;
  };
}
