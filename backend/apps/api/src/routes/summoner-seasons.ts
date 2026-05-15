// GET /api/summoner/:puuid/seasons
//   Per-patch / per-month aggregation across the player's matches.
//   We don't store rank history (Riot doesn't expose it cleanly), so we
//   group by patch + queue and surface play volume + avg AI Score.

import type { FastifyInstance } from 'fastify';
import { db, sql } from '@lol-tracker/db';

export default async function summonerSeasonsRoutes(app: FastifyInstance) {
  app.get<{ Params: { puuid: string } }>(
    '/api/summoner/:puuid/seasons',
    async (req) => {
      const puuid = req.params.puuid;

      // Per-patch aggregation
      const patchRows = await db.execute(sql`
        SELECT
          m.patch,
          COUNT(*)::int AS games,
          COUNT(*) FILTER (WHERE mp.win)::int AS wins,
          AVG(COALESCE(mp.ai_score_cached, 50)::float)::float AS "avgAiScore",
          MIN(m.game_creation) AS "firstAt",
          MAX(m.game_creation) AS "lastAt"
        FROM match_participants mp
        JOIN matches m ON m.match_id = mp.match_id
        WHERE mp.puuid = ${puuid}
        GROUP BY m.patch
        ORDER BY MAX(m.game_creation) DESC
      `);

      // Top 3 champions per patch
      const champRows = await db.execute(sql`
        WITH ranked AS (
          SELECT m.patch, mp.champion_key AS "championKey", mp.champion_id AS "championId",
                 COUNT(*)::int AS games,
                 COUNT(*) FILTER (WHERE mp.win)::int AS wins,
                 ROW_NUMBER() OVER (PARTITION BY m.patch ORDER BY COUNT(*) DESC) AS rn
          FROM match_participants mp
          JOIN matches m ON m.match_id = mp.match_id
          WHERE mp.puuid = ${puuid}
          GROUP BY m.patch, mp.champion_key, mp.champion_id
        )
        SELECT * FROM ranked WHERE rn <= 3
      `);

      const byPatch = new Map<string, Array<{ championKey: string; championId: number; games: number; wins: number }>>();
      for (const r of champRows as unknown as Array<{ patch: string; championKey: string; championId: number; games: number; wins: number }>) {
        const arr = byPatch.get(r.patch) ?? [];
        arr.push({ championKey: r.championKey, championId: r.championId, games: r.games, wins: r.wins });
        byPatch.set(r.patch, arr);
      }

      const arr = patchRows as unknown as Array<{ patch: string; games: number; wins: number; avgAiScore: number; firstAt: number; lastAt: number }>;
      return {
        puuid,
        patches: arr.map((p) => ({
          patch: p.patch,
          games: p.games,
          wins: p.wins,
          winrate: p.games > 0 ? Math.round((p.wins / p.games) * 1000) / 10 : 0,
          avgAiScore: Math.round(p.avgAiScore * 10) / 10,
          firstAt: Number(p.firstAt),
          lastAt: Number(p.lastAt),
          topChampions: byPatch.get(p.patch) ?? [],
        })),
      };
    },
  );
}
