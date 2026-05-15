import { pgTable, text, integer, real, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Same-team champion pair (lane-agnostic). W5 output.
// Used by pick-engine.synergyScore.
// Stored with championA < championB to avoid duplicate rows.
export const championSynergies = pgTable(
  'champion_synergies',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    championA: integer('champion_a').notNull(),  // smaller id
    championB: integer('champion_b').notNull(),  // larger id
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    pairWinrate: real('pair_winrate').notNull(),
    synergyDelta: real('synergy_delta').notNull(), // pair_wr − (a_solo + b_solo)/2
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.championA, t.championB] }),
    aIdx: index('cs_a_idx').on(t.championA, t.synergyDelta),
  }),
);
