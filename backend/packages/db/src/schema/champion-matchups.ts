import { pgTable, text, integer, real, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Same-lane champion vs champion. W4 output.
// Used by pick-engine.counterScore (spec §5.2 lolalytics PBI delta).
export const championMatchups = pgTable(
  'champion_matchups',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    lane: text('lane').notNull(),
    championA: integer('champion_a').notNull(),
    championB: integer('champion_b').notNull(),
    games: integer('games').notNull(),
    aWins: integer('a_wins').notNull(),
    aWinrate: real('a_winrate').notNull(),       // %
    avgGoldDiffAt15: real('avg_gold_diff_at_15'),
    avgCsDiffAt14: real('avg_cs_diff_at_14'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.lane, t.championA, t.championB] }),
    aIdx: index('cmu_a_idx').on(t.lane, t.championA, t.aWinrate),
  }),
);
