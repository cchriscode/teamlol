// GET /api/summoner/:puuid/masteries?limit=10
//   Returns top-N champion masteries for a puuid (by points desc).
//   Joined with static_champions for name; cached 5min.

import type { FastifyInstance } from 'fastify';
import { db, schema } from '@lol-tracker/db';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { cache } from '../cache.js';

const TTL_SEC = 5 * 60;

export default async function masteryRoutes(app: FastifyInstance) {
  app.get<{ Params: { puuid: string }; Querystring: { limit?: string; patch?: string } }>(
    '/api/summoner/:puuid/masteries',
    async (req) => {
      const puuid = req.params.puuid;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10)));
      const patchFilter = req.query.patch || null;

      return cache(`masteries:${puuid}:${limit}:${patchFilter ?? 'any'}`, TTL_SEC, async () => {
        const rows = await db
          .select()
          .from(schema.championMasteries)
          .where(eq(schema.championMasteries.puuid, puuid))
          .orderBy(desc(schema.championMasteries.points))
          .limit(limit);

        if (rows.length === 0) return { puuid, count: 0, masteries: [] };

        // Resolve champion meta (name + key) — join with static_champions for the
        // current patch (or all patches if none specified).
        const championIds = rows.map((r) => r.championId);
        const metaWhere = patchFilter
          ? and(eq(schema.staticChampions.patch, patchFilter), inArray(schema.staticChampions.id, championIds))
          : inArray(schema.staticChampions.id, championIds);
        const metaRows = await db
          .select({
            id: schema.staticChampions.id,
            key: schema.staticChampions.key,
            nameKr: schema.staticChampions.nameKr,
            patch: schema.staticChampions.patch,
          })
          .from(schema.staticChampions)
          .where(metaWhere);
        // Pick the most-recent patch row per championId so frontends render the
        // latest Korean name even if older patch data lingers.
        const byId = new Map<number, { id: number; key: string; nameKr: string; patch: string }>();
        for (const m of metaRows) {
          const cur = byId.get(m.id);
          if (!cur || (m.patch > cur.patch)) byId.set(m.id, m);
        }

        return {
          puuid,
          count: rows.length,
          masteries: rows.map((r) => {
            const m = byId.get(r.championId);
            return {
              championId: r.championId,
              championKey: m?.key ?? null,
              championNameKr: m?.nameKr ?? null,
              level: r.level,
              points: r.points,
              lastPlayedAt: r.lastPlayedAt,
            };
          }),
        };
      });
    },
  );
}
