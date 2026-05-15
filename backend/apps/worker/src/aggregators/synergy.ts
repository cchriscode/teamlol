// W5 — synergy-aggregator (same-team champion pair, lane-agnostic).
//
// For each unordered pair (championA, championB) on the same team, count games + wins.
// championA < championB always (canonical order avoids double-counting).
// Synergy delta = pair WR − (a_solo_wr + b_solo_wr) / 2.
// Bucketed by tier of the FIRST player in the pair.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface SynergyOpts {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
}

interface RawPairRow {
  championA: number;
  championB: number;
  tier: RankedTier | null;
  games: number;
  wins: number;
}

export async function aggregateSynergies(opts: SynergyOpts = {}) {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'synergy', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no patch'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }
  }

  // Per-(champion, tier) solo winrate — needed for the synergy delta baseline.
  // We compute this once and look up per-bracket inside the loop.
  const soloRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT mp.champion_id AS "championId",
           pt.tier        AS tier,
           COUNT(*)::int  AS games,
           COUNT(*) FILTER (WHERE mp.win)::int AS wins
    FROM match_participants mp
    JOIN matches m            ON m.match_id = mp.match_id
    LEFT JOIN player_tier pt  ON pt.puuid = mp.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY mp.champion_id, pt.tier
  `) as unknown as Array<{ championId: number; tier: RankedTier | null; games: number; wins: number }>;

  // Pair stats per tier of player a.
  const pairRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT
      LEAST(a.champion_id, b.champion_id)    AS "championA",
      GREATEST(a.champion_id, b.champion_id) AS "championB",
      pt.tier                                 AS tier,
      COUNT(*)::int                           AS games,
      COUNT(*) FILTER (WHERE a.win)::int      AS wins
    FROM match_participants a
    JOIN matches m              ON m.match_id = a.match_id
    JOIN match_participants b   ON b.match_id = a.match_id
                                AND b.team    = a.team
                                AND b.champion_id < a.champion_id
    LEFT JOIN player_tier pt    ON pt.puuid = a.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY LEAST(a.champion_id, b.champion_id), GREATEST(a.champion_id, b.champion_id), pt.tier
  `) as unknown as RawPairRow[];

  if (pairRows.length === 0) { log.warn({ patch }, 'no pairs'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }

  const written: Bracket[] = [];
  let totalRows = 0;
  type OutRow = {
    patch: string; bracket: Bracket;
    championA: number; championB: number;
    games: number; wins: number;
    pairWinrate: number; synergyDelta: number;
  };

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);

    // Solo WR per champion in this bracket.
    const solo = new Map<number, { games: number; wins: number }>();
    for (const r of soloRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const cur = solo.get(r.championId);
      if (cur) { cur.games += r.games; cur.wins += r.wins; }
      else solo.set(r.championId, { games: r.games, wins: r.wins });
    }

    // Pairs filtered by bracket.
    const buckets = new Map<string, { a: number; b: number; games: number; wins: number }>();
    for (const r of pairRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.championA}|${r.championB}`;
      const cur = buckets.get(k);
      if (cur) { cur.games += r.games; cur.wins += r.wins; }
      else buckets.set(k, { a: r.championA, b: r.championB, games: r.games, wins: r.wins });
    }

    const values: OutRow[] = [];
    for (const b of buckets.values()) {
      const pairWr = (b.wins / b.games) * 100;
      const aSolo = solo.get(b.a);
      const bSolo = solo.get(b.b);
      const aWr = aSolo && aSolo.games > 0 ? (aSolo.wins / aSolo.games) * 100 : 50;
      const bWr = bSolo && bSolo.games > 0 ? (bSolo.wins / bSolo.games) * 100 : 50;
      values.push({
        patch: patch!, bracket,
        championA: b.a, championB: b.b,
        games: b.games, wins: b.wins,
        pairWinrate: Math.round(pairWr * 100) / 100,
        synergyDelta: Math.round((pairWr - (aWr + bWr) / 2) * 100) / 100,
      });
    }

    if (values.length === 0) {
      await db.delete(schema.championSynergies).where(
        sql`${schema.championSynergies.patch} = ${patch} AND ${schema.championSynergies.bracket} = ${bracket}`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.championSynergies).where(
        sql`${schema.championSynergies.patch} = ${patch} AND ${schema.championSynergies.bracket} = ${bracket}`,
      );
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(schema.championSynergies).values(values.slice(i, i + CHUNK));
      }
    });

    written.push(bracket);
    totalRows += values.length;
  }

  log.info({ patch, totalRows, brackets: written }, 'synergy aggregation done');
  return { patch, totalRows, bracketsWritten: written };
}
