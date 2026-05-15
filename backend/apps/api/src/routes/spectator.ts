// GET /api/live/:region/:puuid
//   Calls SPECTATOR-V5 + boosts each participant with rank + recent matches.
//   Cached in Redis 30s to avoid hammering Riot during refresh polling.

import type { FastifyInstance } from 'fastify';
import { db, schema } from '@lol-tracker/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Region, REGION_TO_REGIONAL } from '@lol-tracker/shared';
import { riot } from '../riot-client.js';
import { redis } from '../redis.js';
import { RiotApiError } from '@lol-tracker/riot';

const TTL_SEC = 30;

export default async function spectatorRoutes(app: FastifyInstance) {
  app.get<{ Params: { region: string; puuid: string } }>(
    '/api/live/:region/:puuid',
    async (req, reply) => {
      const region = req.params.region as Region;
      if (!REGION_TO_REGIONAL[region]) return reply.status(400).send({ error: 'invalid region' });
      const puuid = req.params.puuid;

      const cacheKey = `live:${region}:${puuid}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      let game;
      try {
        game = await riot.spectator.activeBySummonerPuuid(region, puuid);
      } catch (e) {
        if (e instanceof RiotApiError && e.status === 404) {
          const out = { inGame: false };
          await redis.set(cacheKey, JSON.stringify(out), 'EX', TTL_SEC);
          return out;
        }
        throw e;
      }
      if (!game) {
        const out = { inGame: false };
        await redis.set(cacheKey, JSON.stringify(out), 'EX', TTL_SEC);
        return out;
      }

      // Boost each participant with rank from DB (best-effort).
      // IMPORTANT: filter by puuid IN (...) — without this we full-scan
      // league_entries (millions of rows) and filter in JS.
      const puuids = game.participants.map((p) => p.puuid);
      const ranks = puuids.length === 0 ? [] : await db.select().from(schema.leagueEntries)
        .where(and(
          eq(schema.leagueEntries.queueType, 'RANKED_SOLO_5x5'),
          inArray(schema.leagueEntries.puuid, puuids),
        ));
      const rankByPuuid = new Map(ranks.map((r) => [r.puuid, r]));

      const out = {
        inGame: true,
        gameId: game.gameId,
        gameStartTime: game.gameStartTime,
        gameLength: game.gameLength,
        queueId: game.gameQueueConfigId,
        mapId: game.mapId,
        bans: game.bannedChampions.map((b) => ({
          championId: b.championId, teamId: b.teamId, pickTurn: b.pickTurn,
        })),
        participants: game.participants.map((p) => {
          const r = rankByPuuid.get(p.puuid);
          return {
            puuid: p.puuid,
            teamId: p.teamId,
            championId: p.championId,
            spell1Id: p.spell1Id, spell2Id: p.spell2Id,
            tier: r?.tier ?? null, rank: r?.rank ?? null, lp: r?.leaguePoints ?? null,
            wins: r?.wins ?? null, losses: r?.losses ?? null,
          };
        }),
      };
      await redis.set(cacheKey, JSON.stringify(out), 'EX', TTL_SEC);
      return out;
    },
  );
}
