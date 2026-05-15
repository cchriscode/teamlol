// GET /api/leaderboard/:region?queue=RANKED_SOLO_5x5&tier=challenger
//   Calls Riot LEAGUE-V4. Cached 10 minutes.
//   Joins with our accounts table so the frontend can link by Riot ID.

import type { FastifyInstance } from 'fastify';
import { Region, REGION_TO_REGIONAL, QueueType } from '@lol-tracker/shared';
import { db, schema } from '@lol-tracker/db';
import { inArray } from 'drizzle-orm';
import { riot } from '../riot-client.js';
import { redis } from '../redis.js';

const TTL_SEC = 10 * 60;

interface Query { queue?: string; tier?: string; }

export default async function leaderboardRoutes(app: FastifyInstance) {
  app.get<{ Params: { region: string }; Querystring: Query }>(
    '/api/leaderboard/:region',
    async (req, reply) => {
      const region = req.params.region as Region;
      if (!REGION_TO_REGIONAL[region]) return reply.status(400).send({ error: 'invalid region' });
      const queue = (req.query.queue as QueueType) ?? 'RANKED_SOLO_5x5';
      const tier = (req.query.tier ?? 'challenger').toLowerCase();

      const cacheKey = `leaderboard:${region}:${queue}:${tier}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      let league;
      switch (tier) {
        case 'challenger':  league = await riot.league.challenger(region, queue); break;
        case 'grandmaster': league = await riot.league.grandmaster(region, queue); break;
        case 'master':      league = await riot.league.master(region, queue); break;
        default: return reply.status(400).send({ error: 'tier must be challenger|grandmaster|master' });
      }

      const sorted = [...league.entries].sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, 200);
      const puuids = sorted.map((e) => e.puuid);
      const accountRows = puuids.length > 0
        ? await db.select({
            puuid: schema.accounts.puuid,
            gameName: schema.accounts.gameName,
            tagLine: schema.accounts.tagLine,
          }).from(schema.accounts).where(inArray(schema.accounts.puuid, puuids))
        : [];
      const accountMap = new Map(accountRows.map((r) => [r.puuid, r]));

      const out = {
        region, queue, tier: league.tier,
        leagueName: league.name,
        generatedAt: new Date().toISOString(),
        count: sorted.length,
        entries: sorted.map((e, i) => {
          const acct = accountMap.get(e.puuid);
          return {
            rank: i + 1,
            puuid: e.puuid,
            gameName: acct?.gameName || null,
            tagLine: acct?.tagLine || null,
            tier: league.tier, division: e.rank,
            lp: e.leaguePoints,
            wins: e.wins, losses: e.losses,
            winrate: (e.wins + e.losses) > 0
              ? Math.round((e.wins / (e.wins + e.losses)) * 1000) / 10
              : 0,
            veteran: e.veteran, freshBlood: e.freshBlood, hotStreak: e.hotStreak,
          };
        }),
      };
      await redis.set(cacheKey, JSON.stringify(out), 'EX', TTL_SEC);
      return out;
    },
  );
}
