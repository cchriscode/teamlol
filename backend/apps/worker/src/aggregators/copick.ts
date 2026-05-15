// W7 — copick-aggregator (P(partner | anchor)).
//
// Spec: docs/pick-recommend-spec.md §17. Bucket by tier of the ANCHOR player
// (the row representing player A whose pick we're conditioning on).

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface CopickOpts {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
  alpha?: number;
}

interface RawAnchorRow { anchorRole: string; anchorId: number; tier: RankedTier | null; total: number; }
interface RawCoRow {
  anchorRole: string; anchorId: number;
  partnerRole: string; partnerId: number;
  tier: RankedTier | null; cooccur: number;
}

export async function aggregateCopick(opts: CopickOpts = {}) {
  const queueId = opts.queueId ?? 420;
  const alpha = opts.alpha ?? 1.0;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'copick', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no patch'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }
  }

  // Eligible partner pool per lane — independent of bracket (used as Dirichlet N).
  const eligibleRows = await db.execute(sql`
    SELECT lane, COUNT(DISTINCT champion_id)::int AS n_eligible
    FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY lane
  `);
  const eligibleByLane = new Map(
    (eligibleRows as unknown as Array<{ lane: string; n_eligible: number }>).map((r) => [r.lane, r.n_eligible]),
  );

  const anchorRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT mp.lane         AS "anchorRole",
           mp.champion_id  AS "anchorId",
           pt.tier         AS tier,
           COUNT(*)::int   AS total
    FROM match_participants mp
    JOIN matches m            ON m.match_id = mp.match_id
    LEFT JOIN player_tier pt  ON pt.puuid = mp.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY mp.lane, mp.champion_id, pt.tier
  `) as unknown as RawAnchorRow[];

  const coRows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    )
    SELECT a.lane         AS "anchorRole",
           a.champion_id  AS "anchorId",
           b.lane         AS "partnerRole",
           b.champion_id  AS "partnerId",
           pt.tier        AS tier,
           COUNT(*)::int  AS cooccur
    FROM match_participants a
    JOIN matches m              ON m.match_id = a.match_id
    JOIN match_participants b   ON b.match_id = a.match_id AND b.team = a.team AND b.lane <> a.lane
    LEFT JOIN player_tier pt    ON pt.puuid = a.puuid
    WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
    GROUP BY a.lane, a.champion_id, b.lane, b.champion_id, pt.tier
  `) as unknown as RawCoRow[];

  if (coRows.length === 0) { log.warn({ patch }, 'no co-pick rows'); return { totalRows: 0, bracketsWritten: [] as Bracket[] }; }

  const written: Bracket[] = [];
  let totalRows = 0;
  type OutRow = {
    patch: string; bracket: Bracket;
    anchorRole: string; anchorId: number;
    partnerRole: string; partnerId: number;
    cooccurCount: number; anchorTotal: number; prob: number;
  };

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);

    const anchorTotal = new Map<string, number>();
    for (const r of anchorRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.anchorRole}|${r.anchorId}`;
      anchorTotal.set(k, (anchorTotal.get(k) ?? 0) + r.total);
    }

    const buckets = new Map<string, { anchorRole: string; anchorId: number; partnerRole: string; partnerId: number; cooccur: number }>();
    for (const r of coRows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.anchorRole}|${r.anchorId}|${r.partnerRole}|${r.partnerId}`;
      const cur = buckets.get(k);
      if (cur) cur.cooccur += r.cooccur;
      else buckets.set(k, { anchorRole: r.anchorRole, anchorId: r.anchorId, partnerRole: r.partnerRole, partnerId: r.partnerId, cooccur: r.cooccur });
    }

    const values: OutRow[] = [];
    for (const r of buckets.values()) {
      const total = anchorTotal.get(`${r.anchorRole}|${r.anchorId}`) ?? 0;
      const nEligible = eligibleByLane.get(r.partnerRole) ?? 1;
      const prob = (r.cooccur + alpha) / (total + alpha * nEligible);
      values.push({
        patch: patch!, bracket,
        anchorRole: r.anchorRole, anchorId: r.anchorId,
        partnerRole: r.partnerRole, partnerId: r.partnerId,
        cooccurCount: r.cooccur,
        anchorTotal: total,
        prob: Math.round(prob * 100000) / 100000,
      });
    }

    if (values.length === 0) {
      await db.delete(schema.copickProbs).where(
        sql`${schema.copickProbs.patch} = ${patch} AND ${schema.copickProbs.bracket} = ${bracket}`,
      );
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.copickProbs).where(
        sql`${schema.copickProbs.patch} = ${patch} AND ${schema.copickProbs.bracket} = ${bracket}`,
      );
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(schema.copickProbs).values(values.slice(i, i + CHUNK));
      }
    });

    written.push(bracket);
    totalRows += values.length;
  }

  log.info({ patch, totalRows, brackets: written }, 'copick aggregation done');
  return { patch, totalRows, bracketsWritten: written };
}
