import { pgTable, text, integer, bigint, timestamp, index } from 'drizzle-orm/pg-core';

// SUMMONER-V4 mirror. One row per puuid (and region for routing).
export const summoners = pgTable(
  'summoners',
  {
    puuid: text('puuid').primaryKey(),
    region: text('region').notNull(),
    profileIconId: integer('profile_icon_id').notNull(),
    summonerLevel: integer('summoner_level').notNull(),
    revisionDate: bigint('revision_date', { mode: 'number' }).notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    regionIdx: index('summoners_region_idx').on(t.region),
    refreshedIdx: index('summoners_refreshed_idx').on(t.refreshedAt),
  }),
);

export type Summoner = typeof summoners.$inferSelect;
export type NewSummoner = typeof summoners.$inferInsert;
