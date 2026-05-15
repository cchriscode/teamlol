// Home page widgets: popular searches + trending champions + recent activity.
// Cached aggressively (60s) since these are public, non-personalized views.

import type { FastifyInstance } from 'fastify';
import { db, sql } from '@lol-tracker/db';
import { redis } from '../redis.js';

const TTL_SEC = 60;

export default async function homeRoutes(app: FastifyInstance) {
  // ---- Popular searches (last hour) -----------------------------------
  app.get('/api/home/popular-searches', async () => {
    const cached = await redis.get('home:popular');
    if (cached) return JSON.parse(cached);

    const rows = await db.execute(sql`
      SELECT riot_id, COUNT(*)::int AS n,
             MAX(matched_puuid) AS puuid,
             MAX(region) AS region
      FROM search_logs
      WHERE searched_at > NOW() - INTERVAL '1 hour'
        AND matched_puuid IS NOT NULL
      GROUP BY riot_id
      ORDER BY n DESC
      LIMIT 10
    `);
    const out = {
      windowHours: 1,
      generatedAt: new Date().toISOString(),
      entries: (rows as unknown as Array<{ riot_id: string; n: number; puuid: string; region: string }>),
    };
    await redis.set('home:popular', JSON.stringify(out), 'EX', TTL_SEC);
    return out;
  });

  // ---- Trending champions (current vs prev snapshot) -------------------
  // Compares latest champion_stats with the most recent tier_snapshot ≥3 days old.
  app.get('/api/home/trending-champions', async () => {
    const cached = await redis.get('home:trending');
    if (cached) return JSON.parse(cached);

    const rows = await db.execute(sql`
      WITH cur AS (
        SELECT champion_id, lane,
               (wins::float / NULLIF(games, 0)) * 100 AS wr,
               pickrate, banrate, sample_n,
               MAX(updated_at) OVER () AS as_of
        FROM champion_stats
        WHERE bracket = 'diamond+' AND sample_n >= 5
      ),
      prev AS (
        SELECT champion_id, lane,
               (wins::float / NULLIF(games, 0)) * 100 AS wr_prev,
               pickrate AS pickrate_prev
        FROM tier_snapshots
        WHERE bracket = 'diamond+' AND snapshot_date < CURRENT_DATE - 2
        ORDER BY snapshot_date DESC LIMIT 200
      )
      SELECT cur.champion_id AS "championId", cur.lane,
             cur.wr, cur.pickrate, cur.banrate, cur.sample_n AS n,
             COALESCE(cur.wr - prev.wr_prev, 0) AS "wrDelta"
      FROM cur LEFT JOIN prev USING (champion_id, lane)
      ORDER BY "wrDelta" DESC NULLS LAST
      LIMIT 10
    `);
    const out = {
      generatedAt: new Date().toISOString(),
      bracket: 'diamond+',
      entries: rows,
    };
    await redis.set('home:trending', JSON.stringify(out), 'EX', TTL_SEC);
    return out;
  });

  // ---- Coverage stats — for footer / system status display -------------
  app.get('/api/home/coverage', async () => {
    const cached = await redis.get('home:coverage');
    if (cached) return JSON.parse(cached);
    const r = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM matches)            AS matches,
        (SELECT COUNT(*)::int FROM accounts)           AS accounts,
        (SELECT MAX(patch) FROM matches)               AS latest_patch,
        (SELECT MAX(ingested_at) FROM matches)         AS last_match_at
    `);
    const out = (r as unknown as Array<unknown>)[0] ?? {};
    await redis.set('home:coverage', JSON.stringify(out), 'EX', TTL_SEC);
    return out;
  });
}
