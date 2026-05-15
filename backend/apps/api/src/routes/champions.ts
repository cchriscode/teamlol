// GET /api/champions/tier
//   Query: lane=mid&bracket=diamond+&patch=auto
// Response shape consumed by champions.html (TierEngine.computePS lives client-side).

import type { FastifyInstance } from 'fastify';
import { db, schema, sql } from '@lol-tracker/db';
import { and, eq } from 'drizzle-orm';
import { LANES, Lane, Bracket } from '@lol-tracker/shared';
import { cache } from '../cache.js';

const TIER_TTL_SEC = 5 * 60;
const META_TTL_SEC = 10 * 60;

interface TierQuery {
  lane?: string;
  bracket?: string;
  patch?: string;          // 'auto' (default) → resolve from DB
  minPickrate?: string;    // optional override; default 0
}

export default async function championsRoutes(app: FastifyInstance) {
  // ---- /api/champions/tier ---------------------------------------------
  app.get<{ Querystring: TierQuery }>('/api/champions/tier', async (req, reply) => {
    const lane = req.query.lane as Lane | 'all' | undefined;
    const bracket = (req.query.bracket as Bracket) ?? 'diamond+';
    const minPickrate = req.query.minPickrate != null ? Number(req.query.minPickrate) : 0;

    if (lane && lane !== 'all' && !LANES.includes(lane as Lane)) {
      return reply.status(400).send({ error: 'invalid lane' });
    }

    const patchKey = req.query.patch && req.query.patch !== 'auto' ? req.query.patch : 'auto';
    const cacheKey = `tier:${bracket}:${lane ?? 'all'}:${patchKey}:${minPickrate}`;

    return cache(cacheKey, TIER_TTL_SEC, async () => {
      let patch = req.query.patch && req.query.patch !== 'auto' ? req.query.patch : null;
      if (!patch) {
        // Pick the patch with the largest sample for this bracket. Most-recently-
        // updated picks a freshly-released patch (e.g. 16.10) that may have only
        // a handful of games while the previous patch (16.9) still has tens of
        // thousands. Sample size = signal quality.
        const r = await db.execute(sql`
          SELECT patch FROM champion_stats WHERE bracket = ${bracket}
          GROUP BY patch ORDER BY SUM(games) DESC LIMIT 1
        `);
        patch = (r as unknown as Array<{ patch: string }>)[0]?.patch ?? null;
      }
      if (!patch) {
        return {
          patch: null, bracket, lane: lane ?? 'all',
          rows: [], totalSample: 0, message: 'no data yet — wait for tier-aggregator',
        };
      }

      const baseConditions = [
        eq(schema.championStats.patch, patch),
        eq(schema.championStats.bracket, bracket),
      ];
      if (lane && lane !== 'all') baseConditions.push(eq(schema.championStats.lane, lane));

      const rows = await db.select().from(schema.championStats).where(and(...baseConditions));
      const filtered = rows
        .filter((r) => r.pickrate >= minPickrate)
        .sort((a, b) => b.games - a.games);

      const totalSample = filtered.reduce((s, r) => s + (r.sampleN ?? 0), 0);
      return {
        patch, bracket, lane: lane ?? 'all',
        generatedAt: new Date().toISOString(),
        totalSample,
        rows: filtered.map((r) => ({
          championId: r.championId,
          lane: r.lane,
          wr: r.games > 0 ? Math.round((r.wins / r.games) * 10000) / 100 : 0,
          pickrate: r.pickrate,
          banrate: r.banrate,
          n: r.sampleN,
          avgKda: r.avgKda,
        })),
      };
    });
  });

  // ---- /api/champions/tier/meta ----------------------------------------
  // Lightweight: list available patches/brackets (for filter chips).
  app.get('/api/champions/tier/meta', async () => {
    return cache('tier:meta', META_TTL_SEC, async () => {
      const r = await db.execute(sql`
        SELECT DISTINCT patch, bracket FROM champion_stats
        ORDER BY patch DESC, bracket
      `);
      return { available: r };
    });
  });
}
