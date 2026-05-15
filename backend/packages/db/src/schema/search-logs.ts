import { pgTable, text, serial, timestamp, index } from 'drizzle-orm/pg-core';

// Anonymous search log for popular-search aggregation (F-103).
// IP is hashed. No PII.
export const searchLogs = pgTable(
  'search_logs',
  {
    id: serial('id').primaryKey(),
    riotId: text('riot_id').notNull(),         // 'name#tag' as typed
    region: text('region').notNull(),
    matchedPuuid: text('matched_puuid'),       // null if 404
    ipHash: text('ip_hash').notNull(),
    searchedAt: timestamp('searched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    timeIdx: index('sl_time_idx').on(t.searchedAt),
    riotIdIdx: index('sl_riot_id_idx').on(t.riotId),
  }),
);
