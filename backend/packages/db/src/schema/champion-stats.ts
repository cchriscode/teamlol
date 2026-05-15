import { pgTable, text, integer, real, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Output of W3 tier-aggregator. Drives `champions.html` + pick-engine metaScore.
export const championStats = pgTable(
  'champion_stats',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),       // 'emerald+' | 'diamond+' | ...
    lane: text('lane').notNull(),
    championId: integer('champion_id').notNull(),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    pickrate: real('pickrate').notNull(),     // %
    banrate: real('banrate').notNull(),       // %
    avgKda: real('avg_kda'),
    psScore: real('ps_score'),                 // computed by tier-engine, cached
    sampleN: integer('sample_n').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.lane, t.championId] }),
    bracketLaneIdx: index('cs_bracket_lane_idx').on(t.bracket, t.lane, t.psScore),
  }),
);
