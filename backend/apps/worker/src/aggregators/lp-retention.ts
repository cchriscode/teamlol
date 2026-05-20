// Tiered retention for lp_snapshots — without this, the table grows by
// ~3K rows/day forever (BFS + polling) and queries against it (per-match
// LP delta lookup, future stats) slow down linearly.
//
// Policy:
//   < 90 days old  → keep all (fine-grained, used for per-match deltas)
//   90d - 1 year   → keep 1 snapshot per (puuid, queueType, ISO week)
//   > 1 year       → delete
//
// Runs once daily; bounded delete count per run so a backlog doesn't
// thrash the table. Append-only writes continue normally.

import { db, sql } from '@lol-tracker/db';
import { logger } from '../logger.js';

const MAX_DELETE_PER_RUN = 50_000;

export async function pruneLpSnapshots(): Promise<{
  deletedOld: number; deletedDownsampled: number;
}> {
  const log = logger.child({ aggregator: 'lp-retention' });

  // 1) Hard delete anything older than 1 year.
  const oldDel = await db.execute(sql`
    DELETE FROM lp_snapshots
    WHERE recorded_at < NOW() - INTERVAL '1 year'
    AND ctid IN (
      SELECT ctid FROM lp_snapshots
      WHERE recorded_at < NOW() - INTERVAL '1 year'
      LIMIT ${MAX_DELETE_PER_RUN}
    )
  `);
  const deletedOld = (oldDel as { rowCount?: number }).rowCount ?? 0;

  // 2) Downsample the 90d–1y window: keep the OLDEST snapshot per
  //    (puuid, queue_type, ISO-week), delete the rest in that window.
  //    Uses a per-(puuid, queue_type, week) row_number; row_number=1 is
  //    the keeper, everything else gets deleted in this bucket.
  const downsampleDel = await db.execute(sql`
    WITH bucketed AS (
      SELECT ctid,
             ROW_NUMBER() OVER (
               PARTITION BY puuid, queue_type, date_trunc('week', recorded_at)
               ORDER BY recorded_at ASC
             ) AS rn
      FROM lp_snapshots
      WHERE recorded_at >= NOW() - INTERVAL '1 year'
        AND recorded_at <  NOW() - INTERVAL '90 days'
    )
    DELETE FROM lp_snapshots
    WHERE ctid IN (
      SELECT ctid FROM bucketed WHERE rn > 1
      LIMIT ${MAX_DELETE_PER_RUN}
    )
  `);
  const deletedDownsampled = (downsampleDel as { rowCount?: number }).rowCount ?? 0;

  log.info({ deletedOld, deletedDownsampled }, 'lp_snapshots retention pass done');
  return { deletedOld, deletedDownsampled };
}
