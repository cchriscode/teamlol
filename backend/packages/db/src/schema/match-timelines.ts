import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Heavy. Kept separate so basic queries don't pay the size cost.
// Used for: AI Score phase split, build timeline, GD@15, worthless death detection.
export const matchTimelines = pgTable('match_timelines', {
  matchId: text('match_id').primaryKey(),
  rawTimeline: jsonb('raw_timeline').notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
});

export type MatchTimeline = typeof matchTimelines.$inferSelect;
export type NewMatchTimeline = typeof matchTimelines.$inferInsert;
