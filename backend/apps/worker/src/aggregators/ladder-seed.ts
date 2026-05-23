// Periodic ladder refresh — re-seeds the BFS queue with active ranked players
// across multiple tiers and queues so the puuid pool keeps growing into new
// player networks (rather than churning on the same friend cluster).
//
// Two-pass strategy:
//   Pass 1 — Solo queue: Diamond/Emerald/Platinum. Primary signal for all
//            tier-bucketed aggregators (tier table, synergies, pick stats).
//   Pass 2 — Flex queue: Diamond/Emerald. Different player base, surfaces
//            off-meta picks and players who don't appear in solo seeds.
//
// Combined with jobId dedup in enqueuePuuid, the queue stays bounded even
// when overlapping puuids appear across tiers/queues/days.

import { seedFromLadder } from '../seed/challenger-bfs.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { Region } from '@lol-tracker/shared';

export async function ladderSeed(): Promise<{
  enqueued: number;
  byQueue: Record<string, number>;
  byTier: Record<string, number>;
}> {
  const log = logger.child({ aggregator: 'ladder-seed' });
  const region = (env.SEED_REGION as Region) ?? 'kr';

  // Solo queue — wider net than before. Platinum opt-in to broaden the lower
  // bound of the emerald+ bracket. bottleneck inside riot-client caps RPS so
  // this just runs longer rather than 429ing.
  const solo = await seedFromLadder({
    region,
    queue: 'RANKED_SOLO_5x5',
    diamondPages:  15,    // ~12K entries (4 div × ~205 × 15)
    emeraldPages:  10,    // ~8K entries
    platinumPages: 5,     // ~4K entries — variety + emerald-bracket floor
  });

  // Flex queue — narrower coverage; main goal is reaching players who don't
  // queue solo. Many flex-only stacks have very different champion preferences.
  const flex = await seedFromLadder({
    region,
    queue: 'RANKED_FLEX_SR',
    diamondPages:  5,
    emeraldPages:  3,
    platinumPages: 0,
  });

  const byTier: Record<string, number> = { ...solo.byTier };
  for (const [t, n] of Object.entries(flex.byTier)) byTier[`flex_${t}`] = n;
  const out = {
    enqueued: solo.enqueued + flex.enqueued,
    byQueue: { solo: solo.enqueued, flex: flex.enqueued },
    byTier,
  };
  log.info(out, 'ladder seed cycle done');
  return out;
}
