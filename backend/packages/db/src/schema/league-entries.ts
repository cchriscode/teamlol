import { pgTable, text, integer, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// LEAGUE-V4 entry per puuid + queue (solo or flex). Snapshot of current standing.
export const leagueEntries = pgTable(
  'league_entries',
  {
    puuid: text('puuid').notNull(),
    queueType: text('queue_type').notNull(),    // 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'
    tier: text('tier').notNull(),                // 'IRON'..'CHALLENGER'
    rank: text('rank').notNull(),                // 'I'..'IV' (or '' for master+)
    leaguePoints: integer('league_points').notNull(),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    veteran: boolean('veteran').default(false).notNull(),
    inactive: boolean('inactive').default(false).notNull(),
    freshBlood: boolean('fresh_blood').default(false).notNull(),
    hotStreak: boolean('hot_streak').default(false).notNull(),
    season: text('season'),                      // 'S2026.S1' etc.
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.puuid, t.queueType] }),
    tierIdx: index('league_entries_tier_idx').on(t.tier, t.queueType),
    refreshedIdx: index('league_entries_refreshed_idx').on(t.refreshedAt),
  }),
);

export type LeagueEntry = typeof leagueEntries.$inferSelect;
export type NewLeagueEntry = typeof leagueEntries.$inferInsert;
