// W3b — damage-profile aggregator.
//
// Reads match_participants × static_items and writes per-champion average AP
// and AD shares back into champion_stats.{ap_share, ad_share}.
//
// Why: pick-engine composition analysis used to bucket each champion into
// {AD, AP, Mixed, True} with Mixed = flat 50/50 split, so Katarina/Akali/etc.
// always contributed exactly 0.5 AP. We now compute the real ratio from
// completed-item builds in the current patch, so mage-builds-tank or
// assassin-with-AP-itemization shows up as the actual share.
//
// Per-row formula: ap = SUM(item.FlatMagicDamageMod)
//                  ad = SUM(item.FlatPhysicalDamageMod)
// Per-champion lane: average of (ap / (ap+ad)) across participants with
//                    at least one damage item built.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';
import { Bracket, BRACKETS, TIERS_FOR_BRACKET, RankedTier } from '@lol-tracker/shared';

export interface DamageProfileOptions {
  patch?: string;
  brackets?: readonly Bracket[];
  queueId?: number;
}

interface ProfileRow {
  lane: string;
  championId: number;
  tier: RankedTier | null;
  apSum: number;
  adSum: number;
  rated: number;        // participants with ap+ad > 0
}

export async function aggregateDamageProfile(opts: DamageProfileOptions = {}): Promise<{
  patch: string;
  bracketsWritten: Bracket[];
  totalUpdated: number;
}> {
  const queueId = opts.queueId ?? 420;
  const brackets = opts.brackets ?? BRACKETS;
  const log = logger.child({ aggregator: 'damage-profile', queueId });

  let patch = opts.patch;
  if (!patch) {
    const r = await db.execute(sql`
      SELECT patch FROM matches WHERE queue_id = ${queueId}
      GROUP BY patch ORDER BY MAX(game_creation) DESC LIMIT 1
    `);
    patch = (r as unknown as Array<{ patch: string }>)[0]?.patch;
    if (!patch) { log.warn('no matches yet, skipping'); return { patch: '', bracketsWritten: [], totalUpdated: 0 }; }
  }
  log.info({ patch }, 'aggregating');

  // static_items uses ddragon-style patch labels (e.g. '16.10.1') while
  // matches.patch is the in-game version ('16.10.776.5552'). Strip to the
  // major.minor prefix for matching.
  const patchPrefix = patch.split('.').slice(0, 2).join('.');

  // 1) Per participant: sum AP and AD across items[]. Items array is
  //    jsonb (number[7]). Skip rows whose ap+ad == 0 (boots-only / support builds
  //    with mostly utility items) to avoid pulling the average toward zero.
  //    Then bucket by (lane, champion_id, participant_tier).
  const rows = await db.execute(sql`
    WITH player_tier AS (
      SELECT DISTINCT ON (puuid) puuid, tier
      FROM league_entries
      WHERE queue_type = 'RANKED_SOLO_5x5'
      ORDER BY puuid, refreshed_at DESC
    ),
    item_stats AS (
      SELECT
        mp.match_id,
        mp.puuid,
        mp.lane,
        mp.champion_id,
        COALESCE(SUM((si.raw_data->'stats'->>'FlatMagicDamageMod')::float),    0) AS ap,
        COALESCE(SUM((si.raw_data->'stats'->>'FlatPhysicalDamageMod')::float), 0) AS ad
      FROM match_participants mp
      JOIN matches m  ON m.match_id = mp.match_id
      LEFT JOIN LATERAL jsonb_array_elements(mp.items) AS item_id ON true
      LEFT JOIN static_items si ON si.id = (item_id::text)::int
        AND si.patch LIKE ${patchPrefix + '%'}
      WHERE m.patch = ${patch} AND m.queue_id = ${queueId}
      GROUP BY mp.match_id, mp.puuid, mp.lane, mp.champion_id
    )
    SELECT
      ist.lane                          AS lane,
      ist.champion_id                   AS "championId",
      pt.tier                           AS tier,
      SUM(ist.ap)::float                AS "apSum",
      SUM(ist.ad)::float                AS "adSum",
      COUNT(*) FILTER (WHERE ist.ap + ist.ad > 0)::int AS rated
    FROM item_stats ist
    LEFT JOIN player_tier pt ON pt.puuid = ist.puuid
    WHERE ist.ap + ist.ad > 0
    GROUP BY ist.lane, ist.champion_id, pt.tier
  `) as unknown as ProfileRow[];

  if (rows.length === 0) {
    log.warn({ patch }, 'no rated participants — skipping all brackets');
    return { patch, bracketsWritten: [], totalUpdated: 0 };
  }

  const written: Bracket[] = [];
  let totalUpdated = 0;

  for (const bracket of brackets) {
    const tierSet = new Set<RankedTier>(TIERS_FOR_BRACKET[bracket]);
    type Bucket = { apSum: number; adSum: number; rated: number };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      if (r.tier == null || !tierSet.has(r.tier)) continue;
      const k = `${r.lane}|${r.championId}`;
      const cur = buckets.get(k);
      if (cur) { cur.apSum += r.apSum; cur.adSum += r.adSum; cur.rated += r.rated; }
      else buckets.set(k, { apSum: r.apSum, adSum: r.adSum, rated: r.rated });
    }
    if (buckets.size === 0) continue;

    // UPDATE — leaves all other champion_stats columns untouched. Per-key
    // updates are necessary because there's no usable VALUES-based UPDATE
    // syntax in Drizzle for compound keys; we batch in a single CTE.
    const tuples: Array<{ lane: string; cid: number; ap: number; ad: number }> = [];
    for (const [k, b] of buckets) {
      const [lane, cidStr] = k.split('|');
      if (!lane || !cidStr) continue;
      const total = b.apSum + b.adSum;
      if (total <= 0) continue;
      const ap = b.apSum / total;
      const ad = b.adSum / total;
      tuples.push({ lane, cid: Number(cidStr), ap, ad });
    }

    if (tuples.length === 0) continue;

    // Bulk update via jsonb_to_recordset — single statement, parameterized.
    const payload = JSON.stringify(tuples.map((t) => ({ lane: t.lane, cid: t.cid, ap: t.ap, ad: t.ad })));
    await db.execute(sql`
      UPDATE champion_stats AS cs
      SET ap_share = v.ap, ad_share = v.ad
      FROM jsonb_to_recordset(${payload}::jsonb)
        AS v(lane text, cid int, ap real, ad real)
      WHERE cs.patch = ${patch}
        AND cs.bracket = ${bracket}
        AND cs.lane = v.lane
        AND cs.champion_id = v.cid
    `);
    written.push(bracket);
    totalUpdated += tuples.length;
    log.info({ bracket, rows: tuples.length }, 'bracket updated');
  }

  log.info({ patch, brackets: written, totalUpdated }, 'damage profile aggregation done');
  return { patch, bracketsWritten: written, totalUpdated };
}
