// DB upserts for matches + participants + timelines.
// Single transaction per match — atomicity matters for re-runs.
//
// TOCTOU note: we use INSERT ... ON CONFLICT DO NOTHING RETURNING to atomically
// claim the match row. If RETURNING is empty, another worker beat us — bail out
// without re-inserting participants/timeline.

import { db, schema, sql } from '@lol-tracker/db';
import { inArray } from 'drizzle-orm';
import { ParsedMatch, ParsedParticipant } from '../parse/match.js';
import { computeAIScore, teamTotalsFrom, TeamTotals } from '../ai-score/engine.js';

/**
 * Returns true if this match was just inserted (we won the race), false if it
 * already existed. Idempotent: caller can re-enqueue without harm.
 */
export async function persistMatch(parsed: ParsedMatch): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(schema.matches)
      .values({
        matchId: parsed.matchRow.matchId,
        region: parsed.matchRow.region,
        patch: parsed.matchRow.patch,
        queueId: parsed.matchRow.queueId,
        gameCreation: parsed.matchRow.gameCreation,
        gameDuration: parsed.matchRow.gameDuration,
        gameVersion: parsed.matchRow.gameVersion,
        mapId: parsed.matchRow.mapId,
        bluewin: parsed.matchRow.bluewin,
        rawDetail: parsed.matchRow.rawDetail as never,
      })
      .onConflictDoNothing()
      .returning({ matchId: schema.matches.matchId });

    if (claimed.length === 0) return false;

    if (parsed.participants.length > 0) {
      const totals = teamTotalsFrom(parsed.participants);
      const rows = parsed.participants.map((p) =>
        toParticipantRow(p, totals, parsed.matchRow.gameDuration));
      await tx.insert(schema.matchParticipants).values(rows).onConflictDoNothing();
    }

    await tx.insert(schema.matchTimelines).values({
      matchId: parsed.timelineRow.matchId,
      rawTimeline: parsed.timelineRow.rawTimeline as never,
    }).onConflictDoNothing();

    return true;
  });
}

function toParticipantRow(p: ParsedParticipant, totals: TeamTotals, gameDurationSec: number) {
  const ai = computeAIScore(p, totals, gameDurationSec);
  return {
    matchId: p.matchId,
    puuid: p.puuid,
    slot: p.slot,
    team: p.team,
    lane: p.lane ?? 'mid',     // schema requires NOT NULL; default to 'mid' if Riot returned ''
    role: p.role,
    championId: p.championId,
    championKey: p.championKey,
    win: p.win,
    kills: p.kills, deaths: p.deaths, assists: p.assists,
    kp: p.kp,
    cs: p.cs, csAt14: p.csAt14, csDiffAt14: p.csDiffAt14,
    goldPerMin: p.goldPerMin, xpPerMin: p.xpPerMin,
    dmgToChampPerMin: p.dmgToChampPerMin, dmgToObj: p.dmgToObj,
    damageTakenPerMin: p.damageTakenPerMin, dmgMitigatedPerMin: p.dmgMitigatedPerMin,
    visionScore: p.visionScore, wardsPlaced: p.wardsPlaced, wardsKilled: p.wardsKilled,
    timeDeadPct: p.timeDeadPct,
    soloKills: p.soloKills, multiKills: p.multiKills,
    firstBloodKill: p.firstBloodKill, firstBloodAssist: p.firstBloodAssist,
    firstTowerKill: p.firstTowerKill,
    dragonTakedowns: p.dragonTakedowns, baronTakedowns: p.baronTakedowns,
    heraldTakedowns: p.heraldTakedowns,
    items: p.items as never, spells: p.spells as never, runes: p.runes as never,
    aiScoreCached: ai?.score ?? null,
    aiScoreLetter: ai?.letter ?? null,
    aiScoreAlgoVersion: ai?.algoVersion ?? null,
    rawParticipant: p.rawParticipant as never,
  };
}

/** Filter a list of match IDs down to those NOT in DB. Used by W1. */
export async function filterUnknownMatchIds(matchIds: string[]): Promise<string[]> {
  if (matchIds.length === 0) return [];
  const known = await db
    .select({ matchId: schema.matches.matchId })
    .from(schema.matches)
    .where(inArray(schema.matches.matchId, matchIds));
  const knownSet = new Set(known.map((r) => r.matchId));
  return matchIds.filter((id) => !knownSet.has(id));
}

/** Filter PUUIDs down to those NOT in accounts table. */
export async function filterUnknownPuuids(puuids: string[]): Promise<string[]> {
  if (puuids.length === 0) return [];
  const known = await db
    .select({ puuid: schema.accounts.puuid })
    .from(schema.accounts)
    .where(inArray(schema.accounts.puuid, puuids));
  const knownSet = new Set(known.map((r) => r.puuid));
  return puuids.filter((p) => !knownSet.has(p));
}

/** Insert minimal account stub (placeholder gameName/tagLine, filled later by W1). */
export async function upsertAccountStub(puuid: string, region: string) {
  await db.insert(schema.accounts).values({
    puuid, gameName: '', tagLine: '', region,
  }).onConflictDoNothing();
}

/** Upsert account with full Riot ID (gameName/tagLine). */
export async function upsertAccountFull(puuid: string, region: string, gameName: string, tagLine: string) {
  await db.insert(schema.accounts).values({
    puuid, gameName, tagLine, region,
  }).onConflictDoUpdate({
    target: schema.accounts.puuid,
    set: { gameName, tagLine, region, lastSeenAt: new Date() },
  });
}

/** Upsert champion mastery rows (one row per champion). */
export async function upsertChampionMasteries(
  puuid: string,
  dtos: Array<{
    championId: number; championLevel: number; championPoints: number;
    lastPlayTime: number; chestGranted: boolean; tokensEarned: number;
  }>,
) {
  if (dtos.length === 0) return;
  const rows = dtos.map((d) => ({
    puuid,
    championId: d.championId,
    level: d.championLevel,
    points: d.championPoints,
    lastPlayedAt: d.lastPlayTime,
    chestGranted: d.chestGranted,
    tokensEarned: d.tokensEarned,
    refreshedAt: new Date(),
  }));
  // Bulk upsert; chunked to avoid statement bloat.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.championMasteries).values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [schema.championMasteries.puuid, schema.championMasteries.championId],
        set: {
          level: sql`excluded.level`,
          points: sql`excluded.points`,
          lastPlayedAt: sql`excluded.last_played_at`,
          chestGranted: sql`excluded.chest_granted`,
          tokensEarned: sql`excluded.tokens_earned`,
          refreshedAt: new Date(),
        },
      });
  }
}

/** Upsert summoner profile (icon, level, revision). */
export async function upsertSummonerProfile(puuid: string, region: string, dto: {
  profileIconId: number; summonerLevel: number; revisionDate: number;
}) {
  await db.insert(schema.summoners).values({
    puuid, region,
    profileIconId: dto.profileIconId,
    summonerLevel: dto.summonerLevel,
    revisionDate: dto.revisionDate,
  }).onConflictDoUpdate({
    target: schema.summoners.puuid,
    set: {
      profileIconId: dto.profileIconId,
      summonerLevel: dto.summonerLevel,
      revisionDate: dto.revisionDate,
      refreshedAt: new Date(),
    },
  });
}

/** Upsert league entries (one per queue type) for a puuid. */
export async function upsertLeagueEntries(
  puuid: string,
  dtos: Array<{
    queueType: string;
    tier: string;
    rank: string | '';
    leaguePoints: number;
    wins: number;
    losses: number;
    veteran: boolean;
    inactive: boolean;
    freshBlood: boolean;
    hotStreak: boolean;
  }>,
) {
  if (dtos.length === 0) return;
  for (const dto of dtos) {
    await db.insert(schema.leagueEntries).values({
      puuid,
      queueType: dto.queueType,
      tier: dto.tier,
      rank: dto.rank ?? '',
      leaguePoints: dto.leaguePoints,
      wins: dto.wins,
      losses: dto.losses,
      veteran: dto.veteran,
      inactive: dto.inactive,
      freshBlood: dto.freshBlood,
      hotStreak: dto.hotStreak,
      refreshedAt: new Date(),
    }).onConflictDoUpdate({
      target: [schema.leagueEntries.puuid, schema.leagueEntries.queueType],
      set: {
        tier: dto.tier,
        rank: dto.rank ?? '',
        leaguePoints: dto.leaguePoints,
        wins: dto.wins,
        losses: dto.losses,
        veteran: dto.veteran,
        inactive: dto.inactive,
        freshBlood: dto.freshBlood,
        hotStreak: dto.hotStreak,
        refreshedAt: new Date(),
      },
    });
  }
}
