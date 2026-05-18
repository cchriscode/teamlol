// W3d — champion-power aggregator.
//
// Bucketed winrate by game duration. Drives the "파워 그래프" on the
// champion detail page — five buckets that read as "short games / mid /
// long games" so you can spot scaling vs early-game champs at a glance.
//
// Bucket choice mirrors solo-queue distribution (median game ~28 min):
//   short      :   0 ≤ min < 20    (snowball or surrender)
//   mid_short  :  20 ≤ min < 25    (typical early carry close-outs)
//   mid        :  25 ≤ min < 30    (median window)
//   mid_long   :  30 ≤ min < 35
//   long       :  35 ≤ min         (scaling champ territory)

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

interface RawRow {
  lane: string;
  championId: number;
  tier: RankedTier | null;
  bucket: string;
  games: number;
  wins: number;
}

const BUCKETS: Array<{ key: string; min: number; max: number }> = [
  { key: 'short',     min: 0,  max: 20 },
  { key: 'mid_short', min: 20, max: 25 },
  { key: 'mid',       min: 25, max: 30 },
  { key: 'mid_long',  min: 30, max: 35 },
  { key: 'long',      min: 35, max: 999 },
];

export interface ChampionPowerOptions {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
}

export async function aggregateChampionPower(opts: ChampionPowerOptions = {}): Promise<{
  patch: string;
  bracketsWritten: Bracket[];
  totalRows: number;
}> {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'champion-power', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no patch'); return { patch: '', bracketsWritten: [], totalRows: 0 }; }
  }
  log.info({ patch }, 'aggregating');

  const rows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT mp.lane                                AS lane,
           mp.champion_id                         AS "championId",
           pt.tier                                AS tier,
           CASE
             WHEN m.game_duration <  1200 THEN 'short'
             WHEN m.game_duration <  1500 THEN 'mid_short'
             WHEN m.game_duration <  1800 THEN 'mid'
             WHEN m.game_duration <  2100 THEN 'mid_long'
             ELSE 'long'
           END                                    AS bucket,
           COUNT(*)::int                          AS games,
           COUNT(*) FILTER (WHERE mp.win)::int    AS wins
    FROM match_participants mp
    JOIN matches m         ON m.match_id = mp.match_id
    LEFT JOIN player_tier pt ON pt.puuid = mp.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId} AND m.game_duration > 600
    GROUP BY mp.lane, mp.champion_id, pt.tier, bucket
  `) as unknown as RawRow[];

  if (rows.length === 0) {
    log.warn({ patch }, 'no rows'); return { patch, bracketsWritten: [], totalRows: 0 };
  }

  const written: Bracket[] = [];
  let totalRows = 0;

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);
    type Bucket = { games: number; wins: number };
    const buckets = new Map<string, Bucket>(); // key: `${lane}|${champId}|${bucket}`
    for (const r of rows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.lane}|${r.championId}|${r.bucket}`;
      const cur = buckets.get(k) ?? { games: 0, wins: 0 };
      cur.games += r.games; cur.wins += r.wins;
      buckets.set(k, cur);
    }

    type OutRow = {
      patch: string; bracket: Bracket; lane: string; championId: number;
      bucket: string; minMinute: number; maxMinute: number;
      games: number; wins: number; wr: number;
    };
    const insert: OutRow[] = [];
    for (const [k, v] of buckets) {
      const [lane, cidStr, bucketKey] = k.split('|');
      if (!lane || !cidStr || !bucketKey) continue;
      const meta = BUCKETS.find((b) => b.key === bucketKey);
      if (!meta) continue;
      insert.push({
        patch: patch!,
        bracket,
        lane,
        championId: Number(cidStr),
        bucket: bucketKey,
        minMinute: meta.min,
        maxMinute: meta.max,
        games: v.games,
        wins: v.wins,
        wr: v.games > 0 ? Math.round((v.wins / v.games) * 10000) / 100 : 0,
      });
    }
    if (insert.length === 0) continue;

    await db.transaction(async (tx) => {
      await tx.delete(schema.championPower).where(
        sql`${schema.championPower.patch} = ${patch} AND ${schema.championPower.bracket} = ${bracket}`,
      );
      const CHUNK = 500;
      for (let i = 0; i < insert.length; i += CHUNK) {
        await tx.insert(schema.championPower).values(insert.slice(i, i + CHUNK));
      }
    });
    written.push(bracket);
    totalRows += insert.length;
    log.info({ bracket, rows: insert.length }, 'bracket written');
  }
  log.info({ patch, brackets: written, totalRows }, 'champion-power done');
  return { patch, bracketsWritten: written, totalRows };
}
