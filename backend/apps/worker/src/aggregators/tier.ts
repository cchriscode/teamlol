// W3 — tier-aggregator.
//
// Reads from `match_participants` + `matches` + `league_entries` and writes
// summary rows into `champion_stats` (one row per patch × bracket × lane × champion_id).
//
// Bucketing: each match_participant is bucketed by their CURRENT
// (latest-refresh) ranked-solo tier. A participant in CHALLENGER counts toward
// every bracket whose `TIERS_FOR_BRACKET` set contains CHALLENGER (i.e. all
// from 'challenger' through 'iron+').
//
// Drives champions.html tier table + pick-engine M_meta.
// Spec: docs/tier-spec.md §10.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface TierAggregateOptions {
  patch?: string;             // default: latest patch in matches table
  brackets?: readonly Bracket[]; // default: all 9 brackets
  queueId?: number;           // default 420 (solo)
}

interface RawPickRow {
  lane: string;
  championId: number;
  tier: RankedTier | null;
  games: number;
  wins: number;
  kdaSum: number;
}

interface BanCountRow {
  championId: number;
  tier: RankedTier | null;
  bans: number;
}

export async function aggregateTier(opts: TierAggregateOptions = {}): Promise<{
  patch: string;
  bracketsWritten: Bracket[];
  totalRows: number;
}> {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'tier', queueId, brackets: brackets.length });

  // 1) Resolve patch.
  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) {
      log.warn('no matches yet, skipping');
      return { patch: '', bracketsWritten: [], totalRows: 0 };
    }
  }
  log.info({ patch }, 'aggregating');

  // 2) Per-(lane, champion_id, participant_tier) picks. JOIN league_entries for
  // each puuid; LEFT JOIN so unranked-but-collected players count as tier=NULL
  // (they get aggregated separately and only matter for very-low brackets).
  const pickRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT
      mp.lane                                                     AS lane,
      mp.champion_id                                              AS "championId",
      pt.tier                                                     AS tier,
      COUNT(*)::int                                               AS games,
      COUNT(*) FILTER (WHERE mp.win)::int                         AS wins,
      SUM((mp.kills + mp.assists)::float / GREATEST(mp.deaths, 1))::float AS "kdaSum"
    FROM match_participants mp
    JOIN matches m         ON m.match_id = mp.match_id
    LEFT JOIN player_tier pt ON pt.puuid = mp.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY mp.lane, mp.champion_id, pt.tier
  `) as unknown as RawPickRow[];

  if (pickRows.length === 0) {
    log.warn({ patch }, 'no participants for this patch');
    return { patch, bracketsWritten: [], totalRows: 0 };
  }

  // 3) Bans: bucket by the BANNER's tier (best effort — JSONB extract).
  // Each match has 10 ban entries (5 per team). We attribute each ban to the
  // tier of the picker via team_id → puuid → tier. If puuid isn't known, the
  // ban falls into the NULL tier bucket.
  const banRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    ),
    ban_pairs AS (
      SELECT
        ((bans_obj ->> 'championId')::int)              AS champion_id,
        ((team_obj ->> 'teamId')::int)                  AS team_id,
        m.match_id                                      AS match_id
      FROM matches m,
           LATERAL jsonb_array_elements(m.raw_detail -> 'info' -> 'teams') AS team_obj,
           LATERAL jsonb_array_elements(team_obj -> 'bans') AS bans_obj
      WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    ),
    ban_with_tier AS (
      -- Attribute each ban to the average tier of its team's participants.
      -- Since a team has 5 players, we count one ban per team-banner; we use
      -- the team's HIGHEST-tier participant as the bracket key (matches lol.ps
      -- "this ban happened in a Diamond+ game" semantics).
      SELECT bp.champion_id,
             (
               SELECT pt.tier
               FROM match_participants mp
               LEFT JOIN player_tier pt ON pt.puuid = mp.puuid
               WHERE mp.match_id = bp.match_id
                 AND mp.team = (CASE WHEN bp.team_id = 100 THEN 'blue' ELSE 'red' END)
                 AND pt.tier IS NOT NULL
               ORDER BY CASE pt.tier
                 WHEN 'CHALLENGER' THEN 10 WHEN 'GRANDMASTER' THEN 9 WHEN 'MASTER' THEN 8
                 WHEN 'DIAMOND' THEN 7 WHEN 'EMERALD' THEN 6 WHEN 'PLATINUM' THEN 5
                 WHEN 'GOLD' THEN 4 WHEN 'SILVER' THEN 3 WHEN 'BRONZE' THEN 2
                 WHEN 'IRON' THEN 1 ELSE 0 END DESC
               LIMIT 1
             ) AS tier
      FROM ban_pairs bp
      WHERE bp.champion_id > 0
    )
    SELECT champion_id AS "championId", tier, COUNT(*)::int AS bans
    FROM ban_with_tier
    GROUP BY champion_id, tier
  `) as unknown as BanCountRow[];

  // 4) For each requested bracket, aggregate + UPSERT.
  const written: Bracket[] = [];
  let totalRows = 0;

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);

    // Filter pick rows to this bracket's tiers, then re-group.
    type Bucket = { lane: string; championId: number; games: number; wins: number; kdaSum: number };
    const buckets = new Map<string, Bucket>();
    for (const r of pickRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.lane}|${r.championId}`;
      const b = buckets.get(k);
      if (b) { b.games += r.games; b.wins += r.wins; b.kdaSum += r.kdaSum; }
      else buckets.set(k, { lane: r.lane, championId: r.championId, games: r.games, wins: r.wins, kdaSum: r.kdaSum });
    }

    // Lane-relative pickrate: denominator is total picks in this lane × bracket
    // (not match count — each match has 2 participants per lane, and bracket
    // filtering further trims).
    const laneTotals = new Map<string, number>();
    for (const b of buckets.values()) laneTotals.set(b.lane, (laneTotals.get(b.lane) ?? 0) + b.games);

    // Bans for this bracket.
    const banByChamp = new Map<number, number>();
    let totalBanGames = 0;
    for (const r of banRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      banByChamp.set(r.championId, (banByChamp.get(r.championId) ?? 0) + r.bans);
      totalBanGames += r.bans;
    }
    // Banrate denominator: total bans in this bracket / 10 ≈ matches in this bracket.
    // (Each match has up to 10 bans; using bans/10 normalizes across patches.)
    const banDenom = Math.max(1, Math.round(totalBanGames / 10));

    type Row = {
      patch: string; bracket: Bracket; lane: string; championId: number;
      games: number; wins: number; pickrate: number; banrate: number;
      avgKda: number | null; psScore: number | null; sampleN: number;
    };
    const valuesToInsert: Row[] = [];
    for (const b of buckets.values()) {
      const laneTotal = laneTotals.get(b.lane) ?? b.games;
      const pickrate = laneTotal > 0 ? Math.round((b.games / laneTotal) * 10000) / 100 : 0;
      const banrate = Math.round(((banByChamp.get(b.championId) ?? 0) / banDenom) * 10000) / 100;
      const avgKda = b.games > 0 ? Math.round((b.kdaSum / b.games) * 100) / 100 : null;
      valuesToInsert.push({
        patch: patch!,
        bracket,
        lane: b.lane,
        championId: b.championId,
        games: b.games,
        wins: b.wins,
        pickrate,
        banrate,
        avgKda,
        psScore: null as number | null,
        sampleN: b.games,
      });
    }

    if (valuesToInsert.length === 0) {
      log.info({ bracket }, 'no participants in this bracket — clearing prior rows');
      await db.delete(schema.championStats).where(
        sql`${schema.championStats.patch} = ${patch} AND ${schema.championStats.bracket} = ${bracket}`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.championStats).where(
        sql`${schema.championStats.patch} = ${patch} AND ${schema.championStats.bracket} = ${bracket}`,
      );
      // Chunk insert to avoid statement-size limits.
      const CHUNK = 500;
      for (let i = 0; i < valuesToInsert.length; i += CHUNK) {
        await tx.insert(schema.championStats).values(valuesToInsert.slice(i, i + CHUNK));
      }
    });

    written.push(bracket);
    totalRows += valuesToInsert.length;
    log.info({ bracket, rows: valuesToInsert.length }, 'bracket written');
  }

  log.info({ patch, brackets: written, totalRows }, 'tier aggregation done');
  return { patch, bracketsWritten: written, totalRows };
}
