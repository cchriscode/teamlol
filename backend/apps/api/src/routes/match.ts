// GET /api/match/:matchId
//   Full match with 10 participants — used by match-detail.html.

import type { FastifyInstance } from 'fastify';
import { db, schema } from '@lol-tracker/db';
import { eq } from 'drizzle-orm';

export default async function matchRoutes(app: FastifyInstance) {
  app.get<{ Params: { matchId: string } }>('/api/match/:matchId', async (req, reply) => {
    const matchId = req.params.matchId;
    const m = await db.query.matches.findFirst({ where: eq(schema.matches.matchId, matchId) });
    if (!m) return reply.status(404).send({ error: 'match not found' });

    const participants = await db.select().from(schema.matchParticipants)
      .where(eq(schema.matchParticipants.matchId, matchId));

    return {
      matchId: m.matchId,
      patch: m.patch,
      queueId: m.queueId,
      gameCreation: m.gameCreation,
      gameDuration: m.gameDuration,
      gameVersion: m.gameVersion,
      bluewin: m.bluewin,
      participants: participants
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({
          puuid: p.puuid, slot: p.slot,
          team: p.team, lane: p.lane,
          championId: p.championId, championKey: p.championKey,
          win: p.win,
          k: p.kills, d: p.deaths, a: p.assists, kp: p.kp,
          cs: p.cs, csAt14: p.csAt14, csDiffAt14: p.csDiffAt14,
          goldPerMin: p.goldPerMin, xpPerMin: p.xpPerMin,
          dmgToChampPerMin: p.dmgToChampPerMin, dmgToObj: p.dmgToObj,
          damageTakenPerMin: p.damageTakenPerMin,
          visionScore: p.visionScore, wardsPlaced: p.wardsPlaced, wardsKilled: p.wardsKilled,
          timeDeadPct: p.timeDeadPct,
          soloKills: p.soloKills, multiKills: p.multiKills,
          items: p.items, spells: p.spells,
          aiScore: p.aiScoreCached,
          aiScoreLetter: p.aiScoreLetter,
        })),
    };
  });
}
