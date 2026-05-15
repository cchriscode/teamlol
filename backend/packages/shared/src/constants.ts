// App-wide constants. Keep this file the single source of truth.

export const DEFAULT_REGION = 'kr' as const;
export const DEFAULT_BRACKET = 'diamond+' as const;
export const DEFAULT_LOCALE = 'ko_KR' as const;

// Riot API
export const RIOT_BASE_PLATFORM = (region: string) => `https://${region}.api.riotgames.com`;
export const RIOT_BASE_REGIONAL = (regional: string) => `https://${regional}.api.riotgames.com`;

// Refresh cooldown (per F-213 spec). 2 minutes.
export const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

// Match collection knobs
export const MATCH_IDS_PER_PUUID = 100;       // Riot single-call max; richer per-puuid history
export const SEED_BFS_DEPTH = 2;              // 1 = challenger only; 2 = + their match peers
export const TIER_DATA_RECENT_DAYS = 14;      // window used for current-patch tier table
export const TIER_SNAPSHOT_RETENTION_DAYS = 30;

// AI Score
export const AI_SCORE_COHORT_MIN_N = 200;
export const AI_SCORE_PRIOR_N = 50;

// BullMQ
export const QUEUE_NAMES = {
  PUUID: 'puuid',
  MATCH_ID: 'match-id',
  AGGREGATE: 'aggregate',
} as const;

export const JOB_PRIORITY = {
  USER_TRIGGERED: 1,
  USER_NEARBY: 5,
  BULK_SEED: 10,
  BACKFILL: 20,
} as const;
