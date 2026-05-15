import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

// Riot Account (PUUID-rooted, region-agnostic).
// PUUID is the universal identifier; gameName + tagLine + region change.
export const accounts = pgTable(
  'accounts',
  {
    puuid: text('puuid').primaryKey(),
    gameName: text('game_name').notNull(),
    tagLine: text('tag_line').notNull(),
    region: text('region').notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    riotIdIdx: index('accounts_riot_id_idx').on(t.gameName, t.tagLine, t.region),
    regionIdx: index('accounts_region_idx').on(t.region),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
