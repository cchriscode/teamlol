import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

// GDPR Article 17 — user data deletion requests. Created on form submit,
// processed asynchronously by the worker's deletion job.
export const deletionRequests = pgTable(
  'deletion_requests',
  {
    id: text('id').primaryKey(),
    puuid: text('puuid'),
    riotId: text('riot_id').notNull(),
    region: text('region').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    rowsDeleted: integer('rows_deleted'),
    note: text('note'),
  },
  (t) => ({
    statusIdx: index('dr_status_idx').on(t.status, t.requestedAt),
  }),
);

// Permanent block list — once a puuid is here, search + BFS skip it so we
// don't re-ingest the user's data after honoring their deletion request.
export const blockedPuuids = pgTable(
  'blocked_puuids',
  {
    puuid: text('puuid').primaryKey(),
    reason: text('reason').notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true }).defaultNow().notNull(),
  },
);
