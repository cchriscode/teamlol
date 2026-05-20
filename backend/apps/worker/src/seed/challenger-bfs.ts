// Bootstrap seeder: pull Challenger / GM / Master league entries, prime the
// PUUID queue. Spec §3 — track A (BFS 90% weight).
//
// Run on boot if SEED_ON_BOOT=true, or manually via CLI: `pnpm cli seed`.
// Idempotent: re-running just enqueues the same PUUIDs (BullMQ dedupes via priority
// ordering — they're already in DB, so W1 simply finds 0 new match ids).

import { riot } from '../riot-client.js';
import { logger } from '../logger.js';
import { Region } from '@lol-tracker/shared';
import { enqueuePuuid } from '../queues.js';

type Division = 'I' | 'II' | 'III' | 'IV';

export interface SeedOptions {
  region: Region;
  queue?: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';
  includeMaster?: boolean;
  /** Cap to avoid swamping a dev key. */
  limit?: number;
}

/** How deep to scan each divisioned tier. Each page is ~205 entries. */
export interface LadderSeedOptions {
  region: Region;
  queue?: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';
  /** Page cap per tier (per division). 0 = skip that tier entirely. */
  diamondPages?: number;     // default 10 — ~2000 entries per division × 4 = 8000
  emeraldPages?: number;     // default 5  — ~1000 entries per division × 4 = 4000
  platinumPages?: number;    // default 0  — opt-in; full plat scan is heavy
}

export async function seedFromHighElo(opts: SeedOptions): Promise<number> {
  const queue = opts.queue ?? 'RANKED_SOLO_5x5';
  const log = logger.child({ seed: 'high-elo', region: opts.region, queue });

  const [challenger, gm, master] = await Promise.all([
    riot.league.challenger(opts.region, queue),
    riot.league.grandmaster(opts.region, queue),
    opts.includeMaster ? riot.league.master(opts.region, queue) : Promise.resolve({ entries: [] }),
  ]);

  const all = [
    ...challenger.entries,
    ...gm.entries,
    ...((master as { entries: typeof challenger.entries }).entries ?? []),
  ];
  log.info({
    challenger: challenger.entries.length,
    gm: gm.entries.length,
    master: ((master as { entries: typeof challenger.entries }).entries ?? []).length,
    total: all.length,
  }, 'seeding from high-elo leagues');

  const limited = opts.limit ? all.slice(0, opts.limit) : all;
  let enqueued = 0;
  for (const entry of limited) {
    if (!entry.puuid) continue;
    await enqueuePuuid({ puuid: entry.puuid, region: opts.region, reason: 'seed' });
    enqueued++;
  }
  log.info({ enqueued, capped: limited.length < all.length }, 'seed done');
  return enqueued;
}

/**
 * Wider ladder seed — scans divisioned tiers (Diamond I-IV by default,
 * optionally Emerald and Platinum) page by page and enqueues each puuid.
 *
 * Sample-size impact: doubles or triples the puuid pool vs challenger-only,
 * giving natural BFS more chances to surface niche champs in higher-bracket
 * games. Designed to run nightly (the ladderSeed aggregator).
 */
export async function seedFromLadder(opts: LadderSeedOptions): Promise<{
  enqueued: number; byTier: Record<string, number>;
}> {
  const queue = opts.queue ?? 'RANKED_SOLO_5x5';
  const diamondPages  = opts.diamondPages  ?? 10;
  const emeraldPages  = opts.emeraldPages  ?? 5;
  const platinumPages = opts.platinumPages ?? 0;
  const log = logger.child({ seed: 'ladder', region: opts.region, queue });

  const divisions: Division[] = ['I', 'II', 'III', 'IV'];
  const tiers: Array<{ name: 'DIAMOND' | 'EMERALD' | 'PLATINUM'; pages: number }> = [
    { name: 'DIAMOND',  pages: diamondPages },
    { name: 'EMERALD',  pages: emeraldPages },
    { name: 'PLATINUM', pages: platinumPages },
  ].filter((t) => t.pages > 0) as typeof tiers;

  let totalEnqueued = 0;
  const byTier: Record<string, number> = {};
  const seen = new Set<string>();    // dedupe across pages

  for (const { name: tier, pages } of tiers) {
    let tierCount = 0;
    for (const div of divisions) {
      for (let page = 1; page <= pages; page++) {
        try {
          const entries = await riot.league.entriesByDivision(opts.region, queue, tier, div, page);
          if (!entries || entries.length === 0) break;        // past last page for this division
          for (const e of entries) {
            if (!e.puuid || seen.has(e.puuid)) continue;
            seen.add(e.puuid);
            await enqueuePuuid({ puuid: e.puuid, region: opts.region, reason: 'seed' });
            tierCount += 1;
            totalEnqueued += 1;
          }
        } catch (err) {
          log.warn({ tier, div, page, err: (err as Error).message }, 'ladder seed page failed');
          break;     // stop drilling this division on error
        }
      }
    }
    byTier[tier] = tierCount;
    log.info({ tier, enqueued: tierCount }, 'tier scan done');
  }

  log.info({ enqueued: totalEnqueued, byTier }, 'ladder seed done');
  return { enqueued: totalEnqueued, byTier };
}
