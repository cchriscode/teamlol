import { pgTable, text, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Append-only history of league_entries — every upsert appends a row here
// so we can reconstruct LP changes per-match by locating snapshot pairs
// straddling a match's gameCreation timestamp.
export const lpSnapshots = pgTable(
  'lp_snapshots',
  {
    puuid: text('puuid').notNull(),
    queueType: text('queue_type').notNull(),
    tier: text('tier').notNull(),
    rank: text('rank').notNull().default(''),
    leaguePoints: integer('league_points').notNull(),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.puuid, t.queueType, t.recordedAt] }),
    lookupIdx: index('lp_snap_puuid_q_time_idx').on(t.puuid, t.queueType, t.recordedAt),
  }),
);

export type LpSnapshot = typeof lpSnapshots.$inferSelect;
export type NewLpSnapshot = typeof lpSnapshots.$inferInsert;
