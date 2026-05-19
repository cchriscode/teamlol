// GET /api/summoner/:puuid/champion-stats?lane=&minGames=
//   Per-champion aggregation across this player's collected matches.
//   Drives summoner-champions.html.

import type { FastifyInstance } from 'fastify';
import { db, sql } from '@lol-tracker/db';
import { cache } from '../cache.js';

interface Query { lane?: string; minGames?: string; }

export default async function summonerChampionStatsRoutes(app: FastifyInstance) {
  app.get<{ Params: { puuid: string }; Querystring: Query }>(
    '/api/summoner/:puuid/champion-stats',
    async (req) => {
      const puuid = req.params.puuid;
      const minGames = Math.max(1, Number(req.query.minGames ?? 1));
      const laneFilter = req.query.lane && req.query.lane !== 'all' ? req.query.lane : null;

      // Per-puuid cache (5 min). The aggregation re-scans this player's match
      // history every call, but the result changes at most every few minutes
      // (new game ingested), so a short cache eliminates repeat scans during
      // tab navigation / refresh bursts.
      const cacheKey = `champ-stats:${puuid}:${laneFilter ?? 'all'}:${minGames}`;
      return cache(cacheKey, 300, async () => {
      const rows = await db.execute(sql`
        SELECT
          mp.champion_id AS "championId",
          mp.champion_key AS "championKey",
          mp.lane,
          COUNT(*)::int AS games,
          COUNT(*) FILTER (WHERE mp.win)::int AS wins,
          AVG((mp.kills + mp.assists)::float / GREATEST(mp.deaths, 1))::float AS "avgKda",
          AVG(mp.cs::float / GREATEST(m.game_duration / 60.0, 1))::float AS cspm,
          AVG(mp.gold_per_min)::float AS "goldPerMin",
          AVG(mp.dmg_to_champ_per_min)::float AS "dmgPerMin",
          AVG(COALESCE(mp.cs_diff_at_14, 0)::float)::float AS "csDiffAt14",
          AVG(COALESCE(mp.ai_score_cached, 50)::float)::float AS "avgAiScore",
          MAX(m.game_creation) AS "lastPlayedAt"
        FROM match_participants mp
        JOIN matches m ON m.match_id = mp.match_id
        WHERE mp.puuid = ${puuid}
          ${laneFilter ? sql`AND mp.lane = ${laneFilter}` : sql``}
        GROUP BY mp.champion_id, mp.champion_key, mp.lane
        HAVING COUNT(*) >= ${minGames}
        ORDER BY games DESC, wins DESC
      `);

      const arr = rows as unknown as Array<{
        championId: number; championKey: string; lane: string;
        games: number; wins: number;
        avgKda: number; cspm: number;
        goldPerMin: number; dmgPerMin: number; csDiffAt14: number;
        avgAiScore: number; lastPlayedAt: number;
      }>;

      return {
        puuid,
        rows: arr.map((r) => ({
          ...r,
          winrate: r.games > 0 ? Math.round((r.wins / r.games) * 1000) / 10 : 0,
          avgKda: round2(r.avgKda),
          cspm: round2(r.cspm),
          goldPerMin: Math.round(r.goldPerMin),
          dmgPerMin: Math.round(r.dmgPerMin),
          csDiffAt14: round2(r.csDiffAt14),
          avgAiScore: round1(r.avgAiScore),
        })),
      };
      });
    },
  );
}
function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
