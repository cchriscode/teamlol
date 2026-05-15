import { pgTable, text, integer, bigint, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// MATCH-V5 detail mirror. raw_detail kept as JSONB so we can re-extract fields
// later without re-fetching from Riot.
export const matches = pgTable(
  'matches',
  {
    matchId: text('match_id').primaryKey(),         // e.g. KR_7234567890
    region: text('region').notNull(),
    patch: text('patch').notNull(),                 // '26.09'
    queueId: integer('queue_id').notNull(),         // 420, 440, 450, ...
    gameCreation: bigint('game_creation', { mode: 'number' }).notNull(),
    gameDuration: integer('game_duration').notNull(), // seconds
    gameVersion: text('game_version').notNull(),    // full Riot version
    mapId: integer('map_id').notNull(),
    bluewin: integer('bluewin'),                    // 1/0 for quick filter; null until parsed
    rawDetail: jsonb('raw_detail').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    patchQueueIdx: index('matches_patch_queue_idx').on(t.patch, t.queueId),
    creationIdx: index('matches_creation_idx').on(t.gameCreation),
    regionIdx: index('matches_region_idx').on(t.region),
  }),
);

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
