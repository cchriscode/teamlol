// W3c — tier-snapshot.
//
// Copies the current champion_stats rows into tier_snapshots with today's
// date. The trend column on /champions and the wrDelta field on the home
// page's trending widget both diff today vs a snapshot ≥3 days old, but
// nothing was writing to tier_snapshots — so trend was permanently stuck
// at "stable / 0%". Daily snapshot fixes that.

import { db, sql } from '@lol-tracker/db';
import { logger } from '../logger.js';

export interface TierSnapshotOptions {
  /** Override snapshot date (YYYY-MM-DD). Defaults to today. */
  date?: string;
}

export async function snapshotTier(opts: TierSnapshotOptions = {}): Promise<{
  date: string;
  rows: number;
}> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const log = logger.child({ aggregator: 'tier-snapshot', date });

  await db.execute(sql`DELETE FROM tier_snapshots WHERE snapshot_date = ${date}::date`);
  const result = await db.execute(sql`
    INSERT INTO tier_snapshots
      (snapshot_date, patch, bracket, lane, champion_id, games, wins, pickrate, banrate, tier_score)
    SELECT
      ${date}::date, patch, bracket, lane, champion_id, games, wins, pickrate, banrate, tier_score
    FROM champion_stats
    WHERE games > 0
  `);

  const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM tier_snapshots WHERE snapshot_date = ${date}::date`);
  const rows = (r as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  log.info({ date, rows, info: (result as { rowCount?: number }).rowCount ?? '?' }, 'tier-snapshot done');
  return { date, rows };
}
