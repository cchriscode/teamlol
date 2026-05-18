// GET /api/pick-recommend/data?lane=mid&bracket=diamond+
//
// Returns the raw aggregates pick-engine.js needs to run:
//   - tier rows for the player's lane (and adjacent lanes for prediction)
//   - matchups (same-lane WR vs each champion)
//   - synergies (same-team pair WR)
//   - bot-duo synergy (ADC+Sup pairs)
//   - copick probabilities (anchor → partner conditional)
//   - AI Score cohort baselines (used downstream)
//
// Pick algorithm itself runs client-side (frontend pick-engine.js, single
// source of truth — same as champions.html / tier-engine.js pattern).

import type { FastifyInstance } from 'fastify';
import { db, schema, sql } from '@lol-tracker/db';
import { and, eq } from 'drizzle-orm';
import { cache } from '../cache.js';

const TTL_SEC = 5 * 60;

interface DataQuery {
  lane?: string;
  bracket?: string;
  patch?: string;
}

export default async function pickRecommendRoutes(app: FastifyInstance) {
  app.get<{ Querystring: DataQuery }>('/api/pick-recommend/data', async (req) => {
    const lane = req.query.lane;
    const bracket = req.query.bracket ?? 'diamond+';
    const patchKey = req.query.patch && req.query.patch !== 'auto' ? req.query.patch : 'auto';

    return cache(`pick-recommend:${bracket}:${patchKey}`, TTL_SEC, async () => {
    let patch = req.query.patch && req.query.patch !== 'auto' ? req.query.patch : null;
    if (!patch) {
      const r = await db.execute(sql`
        SELECT patch FROM champion_stats WHERE bracket = ${bracket}
        GROUP BY patch ORDER BY SUM(games) DESC LIMIT 1
      `);
      patch = (r as unknown as Array<{ patch: string }>)[0]?.patch ?? null;
    }
    if (!patch) {
      return {
        patch: null, bracket, message: 'no aggregates yet — wait for the worker',
        tier: [], matchups: [], synergies: [], botDuos: [], copickProbs: [], laneAvgWr: {},
      };
    }

    // Tier rows — full table (frontend filters by lane). Compact projection.
    const tier = await db.select({
      championId: schema.championStats.championId,
      lane: schema.championStats.lane,
      games: schema.championStats.games,
      wins: schema.championStats.wins,
      pickrate: schema.championStats.pickrate,
      banrate: schema.championStats.banrate,
      n: schema.championStats.sampleN,
      tierScore: schema.championStats.tierScore,
      apShare: schema.championStats.apShare,
      adShare: schema.championStats.adShare,
    }).from(schema.championStats).where(and(
      eq(schema.championStats.patch, patch),
      eq(schema.championStats.bracket, bracket),
    ));

    // Previous snapshot for trend deltas (≥3 days old, newest available).
    // Schema mirrors current tier rows so build-pick-data can reshape into
    // TIER_DATA_PREV without special-casing.
    const tierPrev = await db.execute(sql`
      WITH snap AS (
        SELECT snapshot_date
        FROM tier_snapshots
        WHERE patch = ${patch} AND bracket = ${bracket}
          AND snapshot_date <= CURRENT_DATE - 3
        ORDER BY snapshot_date DESC LIMIT 1
      )
      SELECT champion_id AS "championId", lane,
             CASE WHEN games > 0 THEN (wins::float / games) * 100 ELSE 0 END AS wr,
             pickrate, banrate, games AS n
      FROM tier_snapshots, snap
      WHERE tier_snapshots.snapshot_date = snap.snapshot_date
        AND tier_snapshots.patch = ${patch}
        AND tier_snapshots.bracket = ${bracket}
    `);

    // Lane average WR (denominator for Δ in pick-engine).
    const laneAvg = await db.execute(sql`
      SELECT lane,
             SUM(wins)::float / NULLIF(SUM(games), 0) * 100 AS avg_wr
      FROM champion_stats
      WHERE patch = ${patch} AND bracket = ${bracket}
      GROUP BY lane
    `);
    const laneAvgWr: Record<string, number> = {};
    for (const r of laneAvg as unknown as Array<{ lane: string; avg_wr: number }>) {
      laneAvgWr[r.lane] = Math.round(r.avg_wr * 100) / 100;
    }

    // Matchups — full set; relatively small (champ × champ × lane).
    const matchups = await db.select({
      lane: schema.championMatchups.lane,
      a: schema.championMatchups.championA,
      b: schema.championMatchups.championB,
      wr: schema.championMatchups.aWinrate,
      n: schema.championMatchups.games,
    }).from(schema.championMatchups).where(and(
      eq(schema.championMatchups.patch, patch),
      eq(schema.championMatchups.bracket, bracket),
    ));

    // Synergies — both ends of the distribution. Sorting by ABS keeps the
    // strongest positive AND negative pairs so the engine can also penalise
    // bad combos. Threshold 20 (not 50) because most champion-ally pairs at
    // 50+ games are popular meta only — 1.6% coverage was the reason S
    // collapsed to 0 for non-meta picks. Engine's confidence(n) factor
    // already attenuates small-sample pairs (~30% weight at n=20 vs ~70%
    // at n=200).
    const synergies = await db.execute(sql`
      SELECT champion_a AS a, champion_b AS b, pair_winrate AS wr,
             games AS n, synergy_delta AS delta
      FROM champion_synergies
      WHERE patch = ${patch} AND bracket = ${bracket}
        AND games >= 20
      ORDER BY ABS(synergy_delta) DESC
      LIMIT 5000
    `);

    // Bot duo synergies — full (much smaller).
    const botDuos = await db.select({
      adcId: schema.botDuoSynergy.adcId,
      supId: schema.botDuoSynergy.supId,
      wr: schema.botDuoSynergy.pairWinrate,
      n: schema.botDuoSynergy.games,
      delta: schema.botDuoSynergy.synergyDelta,
    }).from(schema.botDuoSynergy).where(and(
      eq(schema.botDuoSynergy.patch, patch),
      eq(schema.botDuoSynergy.bracket, bracket),
    ));

    // Copick probs — top-N per anchor to keep size sane.
    // For now we ship every (anchor, partner) row; can paginate later if it grows.
    const copickProbs = await db.execute(sql`
      SELECT anchor_role AS "anchorRole", anchor_id AS "anchorId",
             partner_role AS "partnerRole", partner_id AS "partnerId",
             prob
      FROM copick_probs
      WHERE patch = ${patch} AND bracket = ${bracket}
        AND prob > 0.005
      ORDER BY anchor_role, anchor_id, prob DESC
      LIMIT 5000
    `);

    return {
      patch, bracket, lane: lane ?? null,
      generatedAt: new Date().toISOString(),
      laneAvgWr,
      tier: tier.map((r) => ({
        championId: r.championId, lane: r.lane,
        wr: r.games > 0 ? Math.round((r.wins / r.games) * 10000) / 100 : 0,
        pickrate: r.pickrate, banrate: r.banrate, n: r.n,
        tierScore: r.tierScore ?? null,
        apShare: r.apShare ?? null, adShare: r.adShare ?? null,
      })),
      tierPrev,
      matchups,
      synergies,
      botDuos,
      copickProbs,
    };
    });
  });
}
