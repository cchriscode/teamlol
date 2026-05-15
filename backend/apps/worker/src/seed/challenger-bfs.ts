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

export interface SeedOptions {
  region: Region;
  queue?: 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR';
  includeMaster?: boolean;
  /** Cap to avoid swamping a dev key. */
  limit?: number;
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
