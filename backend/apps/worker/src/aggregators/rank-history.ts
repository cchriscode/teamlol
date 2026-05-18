// Daily snapshot of league_entries → player_rank_history.
// Drives the "티어 진행" dots + 30-day LP trend chart on the summoner page.
// Idempotent per (puuid, queue_type, snapshot_date) — re-running today
// overwrites today's row.

import { db, sql } from '@lol-tracker/db';
import { logger } from '../logger.js';

export async function snapshotRankHistory(opts: { date?: string } = {}): Promise<{
  date: string; rows: number;
}> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const log = logger.child({ aggregator: 'rank-history', date });

  await db.execute(sql`DELETE FROM player_rank_history WHERE snapshot_date = ${date}::date`);
  await db.execute(sql`
    INSERT INTO player_rank_history
      (puuid, queue_type, snapshot_date, tier, rank, lp, wins, losses)
    SELECT DISTINCT ON (puuid, queue_type)
      puuid, queue_type, ${date}::date, tier, rank, league_points, wins, losses
    FROM league_entries
    ORDER BY puuid, queue_type, refreshed_at DESC
  `);

  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM player_rank_history WHERE snapshot_date = ${date}::date`);
  const rows = (r as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  log.info({ date, rows }, 'rank-history snapshot done');
  return { date, rows };
}
