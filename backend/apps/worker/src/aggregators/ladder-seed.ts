// Nightly ladder refresh — re-seeds the BFS queue from Diamond + Emerald
// ranked entries so the puuid pool stays current. New active players get
// pulled in; inactive ones naturally fall out as new matches stop
// appearing in their history.
//
// Trades ~250-350 Riot API calls per night for a 3-5× wider puuid pool,
// which lets BFS surface niche champion samples without us having to
// guess who plays them.

import { seedFromLadder } from '../seed/challenger-bfs.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { Region } from '@lol-tracker/shared';

export async function ladderSeed(): Promise<{ enqueued: number; byTier: Record<string, number> }> {
  const log = logger.child({ aggregator: 'ladder-seed' });
  const region = (env.SEED_REGION as Region) ?? 'kr';

  // Conservative defaults — bottleneck inside riot-client throttles to
  // app/method rate limits, so this just takes longer rather than 429ing.
  const out = await seedFromLadder({
    region,
    queue: 'RANKED_SOLO_5x5',
    diamondPages: 10,    // ~8000 entries (4 div × ~205 × 10)
    emeraldPages: 5,     // ~4000 entries (4 div × ~205 × 5)
    platinumPages: 0,    // opt-in only — full plat is heavy
  });
  log.info(out, 'ladder seed cycle done');
  return out;
}
