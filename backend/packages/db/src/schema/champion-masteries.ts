import { pgTable, text, integer, bigint, boolean, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// CHAMPION-MASTERY-V4 mirror. One row per (puuid × champion).
// Used to show "this player's most-played champs" on summoner profile.
export const championMasteries = pgTable(
  'champion_masteries',
  {
    puuid: text('puuid').notNull(),
    championId: integer('champion_id').notNull(),
    level: integer('level').notNull(),
    points: integer('points').notNull(),
    lastPlayedAt: bigint('last_played_at', { mode: 'number' }).notNull(),  // epoch ms
    chestGranted: boolean('chest_granted').default(false).notNull(),
    tokensEarned: integer('tokens_earned').default(0).notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.puuid, t.championId] }),
    puuidPointsIdx: index('mastery_puuid_points_idx').on(t.puuid, t.points),
  }),
);

export type ChampionMastery = typeof championMasteries.$inferSelect;
export type NewChampionMastery = typeof championMasteries.$inferInsert;
