// W4 — matchup-aggregator (same-lane champion vs champion).
//
// For each (patch, bracket, lane, championA, championB), count games + championA wins.
// Bucket by tier of the focal participant (blue side).
//
// championA = blue lane player, championB = red lane player. championA wins if blue won.
// Self-join match_participants by (match_id, lane) with team filter.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface MatchupOpts {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
}

interface RawRow {
  lane: string;
  championA: number;
  championB: number;
  tier: RankedTier | null;
  games: number;
  aWins: number;
  csDiffSum: number;
}

export async function aggregateMatchups(opts: MatchupOpts = {}) {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'matchup', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no patch'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }
  }

  const rows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT
      a.lane                                     AS lane,
      a.champion_id                              AS "championA",
      b.champion_id                              AS "championB",
      pt.tier                                    AS tier,
      COUNT(*)::int                              AS games,
      COUNT(*) FILTER (WHERE a.win)::int         AS "aWins",
      SUM(COALESCE(a.cs_diff_at_14, 0))::float   AS "csDiffSum"
    FROM match_participants a
    JOIN matches m              ON m.match_id = a.match_id
    JOIN match_participants b   ON b.match_id = a.match_id AND b.lane = a.lane AND b.team <> a.team
    LEFT JOIN player_tier pt    ON pt.puuid = a.puuid
    WHERE a.team = 'blue' AND m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY a.lane, a.champion_id, b.champion_id, pt.tier
  `) as unknown as RawRow[];

  if (rows.length === 0) {
    log.warn({ patch }, 'no rows'); return { totalRows: 0, bracketsWritten: [] as Bracket[] };
  }

  const written: Bracket[] = [];
  let totalRows = 0;
  type OutRow = {
    patch: string; bracket: Bracket; lane: string;
    championA: number; championB: number;
    games: number; aWins: number; aWinrate: number;
    avgGoldDiffAt15: number | null; avgCsDiffAt14: number | null;
  };

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);
    const buckets = new Map<string, { lane: string; a: number; b: number; games: number; aWins: number; csSum: number }>();
    for (const r of rows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.lane}|${r.championA}|${r.championB}`;
      const cur = buckets.get(k);
      if (cur) { cur.games += r.games; cur.aWins += r.aWins; cur.csSum += r.csDiffSum; }
      else buckets.set(k, { lane: r.lane, a: r.championA, b: r.championB, games: r.games, aWins: r.aWins, csSum: r.csDiffSum });
    }

    const values: OutRow[] = [];
    for (const b of buckets.values()) {
      values.push({
        patch: patch!, bracket,
        lane: b.lane, championA: b.a, championB: b.b,
        games: b.games, aWins: b.aWins,
        aWinrate: Math.round((b.aWins / b.games) * 10000) / 100,
        avgGoldDiffAt15: null,
        avgCsDiffAt14: b.games > 0 ? Math.round((b.csSum / b.games) * 100) / 100 : null,
      });
    }

    if (values.length === 0) {
      await db.delete(schema.championMatchups).where(
        sql`${schema.championMatchups.patch} = ${patch} AND ${schema.championMatchups.bracket} = ${bracket}`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.championMatchups).where(
        sql`${schema.championMatchups.patch} = ${patch} AND ${schema.championMatchups.bracket} = ${bracket}`,
      );
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(schema.championMatchups).values(values.slice(i, i + CHUNK));
      }
    });

    written.push(bracket);
    totalRows += values.length;
  }

  log.info({ patch, totalRows, brackets: written }, 'matchup aggregation done');
  return { patch, totalRows, bracketsWritten: written };
}
