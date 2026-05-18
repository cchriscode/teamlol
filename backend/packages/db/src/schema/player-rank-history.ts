import { pgTable, text, integer, date, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Daily snapshot of league_entries — drives tier-progression dots and LP
// trend chart on the summoner overview. Populated by rank-history aggregator.
export const playerRankHistory = pgTable(
  'player_rank_history',
  {
    puuid: text('puuid').notNull(),
    queueType: text('queue_type').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    tier: text('tier').notNull(),
    rank: text('rank').notNull(),
    lp: integer('lp').notNull(),
    wins: integer('wins').notNull(),
    losses: integer('losses').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.puuid, t.queueType, t.snapshotDate] }),
    puuidDateIdx: index('prh_puuid_date_idx').on(t.puuid, t.snapshotDate),
  }),
);
