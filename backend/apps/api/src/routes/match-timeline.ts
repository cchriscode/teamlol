// GET /api/match/:matchId/timeline-summary
//   Compact per-frame snapshot + curated events for the match-detail graphs.
//   Cache: forever (matches are immutable after Riot publishes them).
//
// Output is deliberately small so the SVG renderer doesn't ship a megabyte
// of raw timeline JSON to the browser.

import type { FastifyInstance } from 'fastify';
import { db, schema } from '@lol-tracker/db';
import { eq } from 'drizzle-orm';
import { redis } from '../redis.js';

interface TimelineDto {
  info: {
    frameInterval: number;
    frames: Array<{
      timestamp: number;
      participantFrames: Record<string, {
        totalGold?: number; currentGold?: number;
        level?: number; xp?: number;
      }>;
      events: Array<{
        type: string;
        timestamp: number;
        killerId?: number;
        victimId?: number;
        teamId?: number;
        buildingType?: string;
        towerType?: string;
        monsterType?: string;
        monsterSubType?: string;
        assistingParticipantIds?: number[];
        participantId?: number;
        itemId?: number;
        afterId?: number;
        beforeId?: number;
        skillSlot?: number;
        levelUpType?: string;
      }>;
    }>;
  };
}

interface CompactFrame {
  ts: number;                   // seconds since game start
  blue: { totalGold: number; totalXp: number; kills: number };
  red:  { totalGold: number; totalXp: number; kills: number };
}

interface CompactEvent {
  ts: number;
  type: 'KILL' | 'TOWER' | 'INHIBITOR' | 'DRAGON' | 'BARON' | 'HERALD' | 'GRUBS' | 'ATAKHAN' | 'ELDER';
  team: 'blue' | 'red';
  subType?: string | null;      // e.g. INFERNAL/MOUNTAIN for DRAGON
  killerSlot?: number;          // 0..9
  victimSlot?: number;
}

interface PlayerSeries {
  slot: number;
  totalGold: number[];
  totalXp: number[];
  level: number[];
  itemEvents: Array<{ ts: number; itemId: number; type: 'BUY' | 'SELL' | 'UNDO' }>;
  skillEvents: Array<{ ts: number; skillSlot: 1 | 2 | 3 | 4 }>;
}

// Trinkets, biscuits, control wards, potions — too noisy for build timeline.
const SKIP_ITEM_IDS = new Set<number>([
  2003, 2004, 2010, 2031, 2033, 2055, 2056, 2138, 2139, 2140,
  3340, 3363, 3364,    // trinkets
  3865, 3866, 3867, 3869,  // ward upgrades
]);

export default async function matchTimelineRoutes(app: FastifyInstance) {
  app.get<{ Params: { matchId: string } }>(
    '/api/match/:matchId/timeline-summary',
    async (req, reply) => {
      const matchId = req.params.matchId;
      const cacheKey = `tl-summary:${matchId}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const m = await db.query.matches.findFirst({ where: eq(schema.matches.matchId, matchId) });
      if (!m) return reply.status(404).send({ error: 'match not found' });

      const tl = await db.query.matchTimelines.findFirst({ where: eq(schema.matchTimelines.matchId, matchId) });
      if (!tl) return reply.status(404).send({ error: 'timeline not found' });

      const raw = tl.rawTimeline as unknown as TimelineDto;
      const frames = raw?.info?.frames ?? [];
      const frameInterval = raw?.info?.frameInterval ?? 60_000;
      const out = compact(frames, m.gameDuration);

      const payload = {
        matchId,
        gameDuration: m.gameDuration,
        frameIntervalSec: Math.round(frameInterval / 1000),
        frames: out.frames,
        perPlayer: out.perPlayer,
        events: out.events,
      };

      // Permanent cache — match data never changes once persisted.
      await redis.set(cacheKey, JSON.stringify(payload));
      return payload;
    },
  );
}

// participantId 1..10 → slot 0..9 (matches our match_participants.slot convention).
function participantToSlot(pid: number): number { return pid - 1; }

function compact(frames: TimelineDto['info']['frames'], gameDurationSec: number): {
  frames: CompactFrame[];
  perPlayer: PlayerSeries[];
  events: CompactEvent[];
} {
  const compactFrames: CompactFrame[] = [];
  const events: CompactEvent[] = [];
  const perPlayer: PlayerSeries[] = Array.from({ length: 10 }, (_, i) => ({
    slot: i, totalGold: [], totalXp: [], level: [], itemEvents: [], skillEvents: [],
  }));

  // Running team kill counters built from event types.
  let blueKills = 0, redKills = 0;

  for (const f of frames) {
    const tsSec = Math.round(f.timestamp / 1000);

    let blueGold = 0, redGold = 0, blueXp = 0, redXp = 0;
    for (let pid = 1; pid <= 10; pid++) {
      const pf = f.participantFrames[String(pid)];
      const slot = participantToSlot(pid);
      const series = perPlayer[slot];
      if (!pf || !series) continue;
      series.totalGold.push(pf.totalGold ?? 0);
      series.totalXp.push(pf.xp ?? 0);
      series.level.push(pf.level ?? 0);
      if (pid <= 5) { blueGold += pf.totalGold ?? 0; blueXp += pf.xp ?? 0; }
      else          { redGold  += pf.totalGold ?? 0; redXp  += pf.xp ?? 0; }
    }

    // Process events to update kill counters and emit notable timeline events.
    for (const ev of f.events) {
      const evTs = Math.round(ev.timestamp / 1000);
      switch (ev.type) {
        case 'CHAMPION_KILL': {
          const killer = ev.killerId ?? 0;
          if (killer >= 1 && killer <= 5) blueKills += 1;
          else if (killer >= 6 && killer <= 10) redKills += 1;
          if (killer >= 1 && killer <= 10) {
            events.push({
              ts: evTs, type: 'KILL',
              team: killer <= 5 ? 'blue' : 'red',
              killerSlot: participantToSlot(killer),
              victimSlot: ev.victimId != null ? participantToSlot(ev.victimId) : undefined,
            });
          }
          break;
        }
        case 'BUILDING_KILL': {
          // teamId is the team that LOST the building. Convert to attacker team.
          const lostTeam = ev.teamId ?? 0;
          const team: 'blue' | 'red' = lostTeam === 100 ? 'red' : 'blue';
          const subType = ev.buildingType === 'INHIBITOR_BUILDING' ? 'INHIBITOR' : 'TOWER';
          events.push({
            ts: evTs,
            type: subType === 'INHIBITOR' ? 'INHIBITOR' : 'TOWER',
            team, subType: ev.towerType ?? null,
          });
          break;
        }
        case 'ITEM_PURCHASED': {
          const pid = ev.participantId ?? 0;
          const itemId = ev.itemId ?? 0;
          if (pid >= 1 && pid <= 10 && itemId > 0 && !SKIP_ITEM_IDS.has(itemId)) {
            perPlayer[participantToSlot(pid)]!.itemEvents.push({ ts: evTs, itemId, type: 'BUY' });
          }
          break;
        }
        case 'ITEM_SOLD': {
          const pid = ev.participantId ?? 0;
          const itemId = ev.itemId ?? 0;
          if (pid >= 1 && pid <= 10 && itemId > 0) {
            perPlayer[participantToSlot(pid)]!.itemEvents.push({ ts: evTs, itemId, type: 'SELL' });
          }
          break;
        }
        case 'ITEM_UNDO': {
          // Riot encodes undos so the prior purchase is reverted; mark and let
          // the frontend collapse pairs.
          const pid = ev.participantId ?? 0;
          const itemId = ev.beforeId ?? ev.afterId ?? 0;
          if (pid >= 1 && pid <= 10 && itemId > 0) {
            perPlayer[participantToSlot(pid)]!.itemEvents.push({ ts: evTs, itemId, type: 'UNDO' });
          }
          break;
        }
        case 'SKILL_LEVEL_UP': {
          const pid = ev.participantId ?? 0;
          const ss = (ev as { skillSlot?: number }).skillSlot ?? 0;
          if (pid >= 1 && pid <= 10 && ss >= 1 && ss <= 4) {
            perPlayer[participantToSlot(pid)]!.skillEvents.push({ ts: evTs, skillSlot: ss as 1 | 2 | 3 | 4 });
          }
          break;
        }
        case 'ELITE_MONSTER_KILL': {
          const killer = ev.killerId ?? 0;
          const team: 'blue' | 'red' = killer <= 5 ? 'blue' : 'red';
          let mappedType: CompactEvent['type'] = 'DRAGON';
          if (ev.monsterType === 'BARON_NASHOR') mappedType = 'BARON';
          else if (ev.monsterType === 'RIFTHERALD') mappedType = 'HERALD';
          else if (ev.monsterType === 'HORDE') mappedType = 'GRUBS';
          else if (ev.monsterType === 'ATAKHAN') mappedType = 'ATAKHAN';
          else if (ev.monsterType === 'DRAGON' && ev.monsterSubType === 'ELDER_DRAGON') mappedType = 'ELDER';
          events.push({
            ts: evTs, type: mappedType, team,
            subType: ev.monsterSubType ?? null,
          });
          break;
        }
        default: break;
      }
    }

    compactFrames.push({
      ts: tsSec,
      blue: { totalGold: blueGold, totalXp: blueXp, kills: blueKills },
      red:  { totalGold: redGold,  totalXp: redXp,  kills: redKills },
    });
  }

  // Trim trailing frames past game end (rare with Riot data, defensive).
  const cutoff = gameDurationSec + 30;
  const filtered = compactFrames.filter((f) => f.ts <= cutoff);
  return { frames: filtered, perPlayer, events: events.filter((e) => e.ts <= cutoff) };
}
