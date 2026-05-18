import { pgTable, text, integer, real, date, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Daily snapshot of champion_stats for trend detection (spec §7).
// 30-day retention; older rows pruned by W9.
export const tierSnapshots = pgTable(
  'tier_snapshots',
  {
    snapshotDate: date('snapshot_date').notNull(),
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    lane: text('lane').notNull(),
    championId: integer('champion_id').notNull(),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    pickrate: real('pickrate').notNull(),
    banrate: real('banrate').notNull(),
    tierScore: real('tier_score'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.snapshotDate, t.patch, t.bracket, t.lane, t.championId] }),
    dateIdx: index('ts_date_idx').on(t.snapshotDate, t.bracket, t.lane),
  }),
);
