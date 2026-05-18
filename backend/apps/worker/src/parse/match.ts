// Convert raw Riot MATCH-V5 + timeline DTOs into rows ready for INSERT.
//
// This is the single place where Riot's wire format meets our schema.
// Anything we don't extract here can still be pulled from rawDetail/rawTimeline
// JSONB later — no need to re-fetch from Riot.
//
// Spec references:
//   docs/ai-score-spec.md §3 (PlayerStats)
//   docs/ai-score-spec.md §6 (anti-stat-padding)

import {
  MatchDto, MatchTimelineDto, ParticipantDto,
  teamPositionToLane, teamId,
} from '@lol-tracker/riot';
import { Lane } from '@lol-tracker/shared';

export interface ParsedMatch {
  matchRow: {
    matchId: string;
    region: string;
    patch: string;
    queueId: number;
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    mapId: number;
    bluewin: number | null;
    rawDetail: unknown;
  };
  participants: ParsedParticipant[];
  timelineRow: { matchId: string; rawTimeline: unknown };
  /** PUUIDs we discovered in this match (for BFS). */
  participantPuuids: string[];
}

export interface ParsedParticipant {
  matchId: string;
  puuid: string;
  slot: number;
  team: 'blue' | 'red';
  lane: Lane | null;
  role: string | null;
  championId: number;
  championKey: string;
  win: boolean;

  // KDA
  kills: number;
  deaths: number;
  assists: number;
  kp: number | null;

  // Farm
  cs: number;
  csAt14: number | null;
  csDiffAt14: number | null;

  // Economy
  goldPerMin: number;
  xpPerMin: number;

  // Damage
  dmgToChampPerMin: number;
  dmgToObj: number;
  damageTakenPerMin: number;
  dmgMitigatedPerMin: number;

  // Vision
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;

  // Death
  timeDeadPct: number;

  // Bonuses
  soloKills: number;
  multiKills: number;

  // Skill / impact signals (from Riot challenges)
  firstBloodKill: boolean;
  firstBloodAssist: boolean;
  firstTowerKill: boolean;
  dragonTakedowns: number;
  baronTakedowns: number;
  heraldTakedowns: number;

  // Items + spells
  items: number[];
  spells: number[];
  runes: unknown;

  rawParticipant: unknown;
}

/**
 * Convert Riot DTOs to row-ready data. Pure function; no DB or HTTP calls.
 */
export function parseMatch(
  matchId: string,
  region: string,
  detail: MatchDto,
  timeline: MatchTimelineDto,
): ParsedMatch {
  const info = detail.info;
  const patch = info.gameVersion.split('.').slice(0, 2).join('.'); // "14.10"
  const blueTeam = info.teams.find((t) => t.teamId === 100);
  const bluewin = blueTeam ? (blueTeam.win ? 1 : 0) : null;

  // Compute team kill totals for KP%
  const teamKills = { 100: 0, 200: 0 };
  for (const p of info.participants) teamKills[p.teamId] += p.kills;

  // Pre-index participants by id for timeline event resolution.
  const byParticipantId = new Map<number, ParticipantDto>();
  for (const p of info.participants) byParticipantId.set(p.participantId, p);

  // Per-participant computed stats from timeline.
  const tlStats = computeTimelineStats(timeline, byParticipantId);

  const participants: ParsedParticipant[] = info.participants.map((p) => {
    const lane = teamPositionToLane(p.teamPosition);
    const team = teamId(p.teamId);
    const ts = tlStats.get(p.participantId);
    const minutes = Math.max(1, info.gameDuration / 60);
    const kp = teamKills[p.teamId] > 0
      ? Math.round(((p.kills + p.assists) / teamKills[p.teamId]) * 1000) / 10
      : null;

    return {
      matchId, puuid: p.puuid, slot: p.participantId - 1,
      team,
      lane,
      role: p.individualPosition || null,
      championId: p.championId,
      championKey: p.championName,
      win: p.win,
      kills: p.kills, deaths: p.deaths, assists: p.assists, kp,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      csAt14: ts?.csAt14 ?? null,
      csDiffAt14: ts?.csDiffAt14 ?? null,
      goldPerMin: round2(p.goldEarned / minutes),
      xpPerMin: ts?.xpPerMin ?? 0,
      dmgToChampPerMin: round2(p.totalDamageDealtToChampions / minutes),
      dmgToObj: p.damageDealtToObjectives,
      damageTakenPerMin: round2(p.totalDamageTaken / minutes),
      dmgMitigatedPerMin: round2(p.damageSelfMitigated / minutes),
      visionScore: p.visionScore,
      wardsPlaced: p.wardsPlaced,
      wardsKilled: p.wardsKilled,
      timeDeadPct: round2((p.totalTimeSpentDead / info.gameDuration) * 100),
      soloKills: p.soloKills ?? ts?.soloKills ?? 0,
      multiKills: p.doubleKills + p.tripleKills + p.quadraKills + p.pentaKills,
      // Riot challenges block carries first-blood / first-tower booleans
      // and per-objective takedown counts. Optional chaining because the
      // block can be missing on old/edge matches.
      firstBloodKill:   !!(p as any).firstBloodKill,
      firstBloodAssist: !!(p as any).firstBloodAssist,
      firstTowerKill:   !!(p as any).firstTowerKill,
      dragonTakedowns:  Number((p as any).challenges?.dragonTakedowns ?? 0),
      baronTakedowns:   Number((p as any).challenges?.baronTakedowns ?? 0),
      heraldTakedowns:  Number((p as any).challenges?.riftHeraldTakedowns ?? 0),
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      spells: [p.summoner1Id, p.summoner2Id],
      runes: p.perks,
      rawParticipant: p,
    };
  });

  return {
    matchRow: {
      matchId, region, patch,
      queueId: info.queueId,
      gameCreation: info.gameCreation,
      gameDuration: info.gameDuration,
      gameVersion: info.gameVersion,
      mapId: info.mapId,
      bluewin,
      rawDetail: detail,
    },
    participants,
    timelineRow: { matchId, rawTimeline: timeline },
    participantPuuids: detail.metadata.participants,
  };
}

// ---- Timeline scan ----------------------------------------------------

interface TimelineParticipantStats {
  csAt14?: number;
  csDiffAt14?: number;
  xpPerMin?: number;
  soloKills: number;
}

function computeTimelineStats(
  timeline: MatchTimelineDto,
  byParticipantId: Map<number, ParticipantDto>,
): Map<number, TimelineParticipantStats> {
  const out = new Map<number, TimelineParticipantStats>();
  for (const id of byParticipantId.keys()) {
    out.set(id, { soloKills: 0 });
  }

  // Find frame nearest 14:00 for CS@14 / CS diff
  const target14 = 14 * 60 * 1000;
  let frame14: typeof timeline.info.frames[number] | null = null;
  for (const f of timeline.info.frames) {
    if (f.timestamp <= target14) frame14 = f;
    else break;
  }

  if (frame14) {
    for (const id of byParticipantId.keys()) {
      const pf = frame14.participantFrames[String(id)];
      if (!pf) continue;
      const stat = out.get(id)!;
      stat.csAt14 = pf.minionsKilled + pf.jungleMinionsKilled;
    }
  }

  // CS diff @14 vs same-lane opposite-team participant
  if (frame14) {
    const byLaneTeam = new Map<string, number>(); // `${lane}:${team}` → cs
    for (const [id, p] of byParticipantId.entries()) {
      const lane = p.teamPosition || '';
      const cs = (frame14.participantFrames[String(id)]?.minionsKilled ?? 0)
               + (frame14.participantFrames[String(id)]?.jungleMinionsKilled ?? 0);
      byLaneTeam.set(`${lane}:${p.teamId}`, cs);
    }
    for (const [id, p] of byParticipantId.entries()) {
      const lane = p.teamPosition || '';
      const opp = p.teamId === 100 ? 200 : 100;
      const myCs = byLaneTeam.get(`${lane}:${p.teamId}`) ?? 0;
      const oppCs = byLaneTeam.get(`${lane}:${opp}`);
      if (oppCs != null) {
        out.get(id)!.csDiffAt14 = myCs - oppCs;
      }
    }
  }

  // Last frame for total XP → xpPerMin
  const last = timeline.info.frames[timeline.info.frames.length - 1];
  if (last) {
    const minutes = Math.max(1, last.timestamp / 60000);
    for (const id of byParticipantId.keys()) {
      const pf = last.participantFrames[String(id)];
      if (pf) {
        out.get(id)!.xpPerMin = round2(pf.xp / minutes);
      }
    }
  }

  // Walk events for solo-kill detection (Riot's p.soloKills field is sometimes absent).
  for (const frame of timeline.info.frames) {
    for (const ev of frame.events) {
      if (ev.type !== 'CHAMPION_KILL') continue;
      const e = ev as { type: 'CHAMPION_KILL'; killerId: number; assistingParticipantIds?: number[] };
      if (e.killerId > 0 && (e.assistingParticipantIds?.length ?? 0) === 0) {
        out.get(e.killerId)!.soloKills += 1;
      }
    }
  }

  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
