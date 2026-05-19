// Processes pending GDPR data deletion requests.
//
// Picks up rows from deletion_requests where status='pending', does the
// multi-table DELETE for that puuid (or resolves it via accounts table),
// adds the puuid to blocked_puuids so BFS/search won't re-ingest, then
// marks the request 'processed'. Runs hourly.

import { db, sql, schema } from '@lol-tracker/db';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.js';

const MAX_PER_RUN = 50;

export async function processDeletions(): Promise<{
  processed: number;
  failed: number;
}> {
  const log = logger.child({ aggregator: 'process-deletions' });

  const pending = await db.execute(sql`
    SELECT id, puuid, riot_id, region
    FROM deletion_requests
    WHERE status = 'pending'
    ORDER BY requested_at ASC
    LIMIT ${MAX_PER_RUN}
  `);
  const rows = pending as unknown as Array<{ id: string; puuid: string | null; riot_id: string; region: string }>;
  if (rows.length === 0) return { processed: 0, failed: 0 };

  log.info({ pending: rows.length }, 'processing deletion requests');
  let processed = 0, failed = 0;

  for (const req of rows) {
    try {
      // Resolve puuid if API request couldn't (Riot 404 / new account that
      // we still happen to have a search log for).
      let puuid = req.puuid;
      if (!puuid) {
        const [name, tag] = (req.riot_id ?? '').split('#');
        if (name && tag) {
          const acct = await db.query.accounts.findFirst({
            where: (a, { and: aAnd, eq: aEq }) =>
              aAnd(aEq(a.gameName, name.trim()), aEq(a.tagLine, tag.trim())),
          });
          puuid = acct?.puuid ?? null;
        }
      }

      if (!puuid) {
        // Nothing to delete — still record an attempt + block by riotId-only
        // would be unsafe, so we just close the request.
        await db.execute(sql`
          UPDATE deletion_requests
          SET status = 'processed', processed_at = NOW(),
              rows_deleted = 0,
              note = 'puuid not resolvable (no data on record)'
          WHERE id = ${req.id}
        `);
        processed += 1;
        continue;
      }

      // Multi-table DELETE inside a single transaction. We also count rows.
      const counts = await db.transaction(async (tx) => {
        const stats = { mp: 0, sm: 0, ac: 0, le: 0, ms: 0, sl: 0, rh: 0 };
        const r1 = await tx.execute(sql`DELETE FROM match_participants WHERE puuid = ${puuid}`);
        const r2 = await tx.execute(sql`DELETE FROM summoners          WHERE puuid = ${puuid}`);
        const r3 = await tx.execute(sql`DELETE FROM accounts           WHERE puuid = ${puuid}`);
        const r4 = await tx.execute(sql`DELETE FROM league_entries     WHERE puuid = ${puuid}`);
        const r5 = await tx.execute(sql`DELETE FROM champion_masteries WHERE puuid = ${puuid}`);
        const r6 = await tx.execute(sql`DELETE FROM search_logs        WHERE matched_puuid = ${puuid}`);
        const r7 = await tx.execute(sql`DELETE FROM player_rank_history WHERE puuid = ${puuid}`);
        stats.mp = (r1 as { rowCount?: number }).rowCount ?? 0;
        stats.sm = (r2 as { rowCount?: number }).rowCount ?? 0;
        stats.ac = (r3 as { rowCount?: number }).rowCount ?? 0;
        stats.le = (r4 as { rowCount?: number }).rowCount ?? 0;
        stats.ms = (r5 as { rowCount?: number }).rowCount ?? 0;
        stats.sl = (r6 as { rowCount?: number }).rowCount ?? 0;
        stats.rh = (r7 as { rowCount?: number }).rowCount ?? 0;
        // Block the puuid permanently (until manual unblock) so search/BFS
        // won't re-create the rows we just removed.
        await tx.insert(schema.blockedPuuids).values({
          puuid: puuid!, reason: 'gdpr-deletion',
        }).onConflictDoNothing();
        return stats;
      });

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      await db.execute(sql`
        UPDATE deletion_requests
        SET status = 'processed', processed_at = NOW(),
            rows_deleted = ${total},
            note = ${`match_participants=${counts.mp}, summoners=${counts.sm}, accounts=${counts.ac}, league_entries=${counts.le}, masteries=${counts.ms}, search_logs=${counts.sl}, rank_history=${counts.rh}`}
        WHERE id = ${req.id}
      `);
      processed += 1;
      log.info({ requestId: req.id, puuid, total }, 'deletion processed');
    } catch (e) {
      failed += 1;
      const err = (e as Error).message;
      await db.execute(sql`
        UPDATE deletion_requests
        SET status = 'failed', processed_at = NOW(), note = ${err.slice(0, 500)}
        WHERE id = ${req.id}
      `).catch(() => undefined);
      log.error({ requestId: req.id, err }, 'deletion failed');
    }
  }

  log.info({ processed, failed }, 'deletion batch done');
  return { processed, failed };
}
