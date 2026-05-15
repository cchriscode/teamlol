// W6 — bot-duo-aggregator (ADC + Support pair).
//
// Spec: docs/pick-recommend-spec.md §16. Bucket by tier of the ADC player.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface BotDuoOpts {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
}

interface RawSoloRow { championId: number; tier: RankedTier | null; lane: string; games: number; wins: number; }
interface RawPairRow { adcId: number; supId: number; tier: RankedTier | null; games: number; wins: number; }

export async function aggregateBotDuos(opts: BotDuoOpts = {}) {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'bot-duo', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no patch'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }
  }

  // Per-(champion, tier, lane) solo stats — restricted to bot lanes.
  const soloRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT mp.champion_id AS "championId",
           pt.tier        AS tier,
           mp.lane        AS lane,
           COUNT(*)::int  AS games,
           COUNT(*) FILTER (WHERE mp.win)::int AS wins
    FROM match_participants mp
    JOIN matches m            ON m.match_id = mp.match_id
    LEFT JOIN player_tier pt  ON pt.puuid = mp.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
      AND mp.lane IN ('adc', 'support')
    GROUP BY mp.champion_id, pt.tier, mp.lane
  `) as unknown as RawSoloRow[];

  const pairRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT a.champion_id           AS "adcId",
           b.champion_id           AS "supId",
           pt.tier                 AS tier,
           COUNT(*)::int           AS games,
           COUNT(*) FILTER (WHERE a.win)::int AS wins
    FROM match_participants a
    JOIN matches m              ON m.match_id = a.match_id
    JOIN match_participants b   ON b.match_id = a.match_id AND b.team = a.team
                                AND a.lane = 'adc' AND b.lane = 'support'
    LEFT JOIN player_tier pt    ON pt.puuid = a.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY a.champion_id, b.champion_id, pt.tier
  `) as unknown as RawPairRow[];

  if (pairRows.length === 0) { log.warn({ patch }, 'no bot duos'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }

  const written: Bracket[] = [];
  let totalRows = 0;
  type OutRow = {
    patch: string; bracket: Bracket;
    adcId: number; supId: number;
    games: number; wins: number;
    pairWinrate: number; synergyDelta: number;
    archetype: string | null;
  };

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);

    const adcSolo = new Map<number, { games: number; wins: number }>();
    const supSolo = new Map<number, { games: number; wins: number }>();
    for (const r of soloRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const target = r.lane === 'adc' ? adcSolo : supSolo;
      const cur = target.get(r.championId);
      if (cur) { cur.games += r.games; cur.wins += r.wins; }
      else target.set(r.championId, { games: r.games, wins: r.wins });
    }

    const buckets = new Map<string, { adcId: number; supId: number; games: number; wins: number }>();
    for (const r of pairRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.adcId}|${r.supId}`;
      const cur = buckets.get(k);
      if (cur) { cur.games += r.games; cur.wins += r.wins; }
      else buckets.set(k, { adcId: r.adcId, supId: r.supId, games: r.games, wins: r.wins });
    }

    const values: OutRow[] = [];
    for (const b of buckets.values()) {
      const pairWr = (b.wins / b.games) * 100;
      const adc = adcSolo.get(b.adcId);
      const sup = supSolo.get(b.supId);
      const adcWr = adc && adc.games > 0 ? (adc.wins / adc.games) * 100 : 50;
      const supWr = sup && sup.games > 0 ? (sup.wins / sup.games) * 100 : 50;
      values.push({
        patch: patch!, bracket,
        adcId: b.adcId, supId: b.supId,
        games: b.games, wins: b.wins,
        pairWinrate: Math.round(pairWr * 100) / 100,
        synergyDelta: Math.round((pairWr - (adcWr + supWr) / 2) * 100) / 100,
        archetype: null,
      });
    }

    if (values.length === 0) {
      await db.delete(schema.botDuoSynergy).where(
        sql`${schema.botDuoSynergy.patch} = ${patch} AND ${schema.botDuoSynergy.bracket} = ${bracket}`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.botDuoSynergy).where(
        sql`${schema.botDuoSynergy.patch} = ${patch} AND ${schema.botDuoSynergy.bracket} = ${bracket}`,
      );
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(schema.botDuoSynergy).values(values.slice(i, i + CHUNK));
      }
    });

    written.push(bracket);
    totalRows += values.length;
  }

  log.info({ patch, totalRows, brackets: written }, 'bot-duo aggregation done');
  return { patch, totalRows, bracketsWritten: written };
}
