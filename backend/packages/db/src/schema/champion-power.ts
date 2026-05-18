import { pgTable, text, integer, real, timestamp, primaryKey } from 'drizzle-orm/pg-core';

// Champion power curve — game-length bucketed winrate.
// Output of the champion-power aggregator. Read by the champion detail
// page to plot "이 챔프 게임 길이별 강함" line chart.
export const championPower = pgTable(
  'champion_power',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    lane: text('lane').notNull(),
    championId: integer('champion_id').notNull(),
    bucket: text('bucket').notNull(),       // 'short' | 'mid_short' | 'mid' | 'mid_long' | 'long'
    minMinute: integer('min_minute').notNull(),
    maxMinute: integer('max_minute').notNull(),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    wr: real('wr').notNull(),               // 0~100
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.lane, t.championId, t.bucket] }),
  }),
);
