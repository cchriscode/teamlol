// Aggregator scheduler. Hourly cron-like loop run inside the worker process.
// (For production we'd use a proper cron / BullMQ repeatable jobs; for the
// prototype, a simple setInterval is enough.)

import { logger } from '../logger.js';
import { env } from '../env.js';
import { aggregateTier } from './tier.js';
import { aggregateMatchups } from './matchup.js';
import { aggregateSynergies } from './synergy.js';
import { aggregateBotDuos } from './bot-duo.js';
import { aggregateCopick } from './copick.js';
import { syncStaticData } from './static-data.js';
import { aggregateDamageProfile } from './damage-profile.js';
import { snapshotTier } from './tier-snapshot.js';
import { aggregateChampionPower } from './champion-power.js';
import { snapshotRankHistory } from './rank-history.js';
import { processDeletions } from './process-deletions.js';
import { pollLpSnapshots } from './lp-poll.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Aggregator = { name: string; intervalMs: number; run: () => Promise<unknown> };

export function startAggregators() {
  const log = logger.child({ component: 'aggregators' });

  // All aggregators are now bracket-aware: they write ALL 5 brackets
  // (chal/gm+/master+/diamond+/emerald+) in one pass. No bracket param needed.
  const all: Aggregator[] = [
    { name: 'tier',    intervalMs: HOUR_MS, run: () => aggregateTier() },
    // Damage profile depends on champion_stats rows existing (it UPDATEs),
    // so schedule it shortly after tier with the same cadence.
    { name: 'dmgProfile', intervalMs: HOUR_MS, run: () => aggregateDamageProfile() },
    { name: 'matchup', intervalMs: DAY_MS,  run: () => aggregateMatchups() },
    { name: 'synergy', intervalMs: DAY_MS,  run: () => aggregateSynergies() },
    { name: 'botDuo',  intervalMs: DAY_MS,  run: () => aggregateBotDuos() },
    { name: 'copick',  intervalMs: DAY_MS,  run: () => aggregateCopick() },
    { name: 'static',  intervalMs: HOUR_MS, run: () => syncStaticData() },
    // Daily snapshot of champion_stats — feeds the "변동" / wrDelta columns.
    { name: 'tierSnap', intervalMs: DAY_MS,  run: () => snapshotTier() },
    { name: 'chPower',  intervalMs: HOUR_MS, run: () => aggregateChampionPower() },
    { name: 'rankHist', intervalMs: DAY_MS,  run: () => snapshotRankHistory() },
    // GDPR deletion queue — runs every 30 minutes so requests are honored
    // within an hour even on a quiet day.
    { name: 'deletions', intervalMs: 30 * 60 * 1000, run: () => processDeletions() },
    // LP snapshot polling — every 3 min picks 50 oldest-refreshed accounts
    // and calls LEAGUE-V4 → upsert appends to lp_snapshots automatically.
    // Builds the timeline required for per-match "+15 LP" display.
    { name: 'lpPoll',    intervalMs: 3 * 60 * 1000,  run: () => pollLpSnapshots() },
  ];

  for (const agg of all) {
    const tick = async () => {
      try { await agg.run(); }
      catch (e) { log.error({ err: (e as Error).message, agg: agg.name }, 'aggregator failed'); }
    };
    const offsetMs = 30_000 + all.indexOf(agg) * 10_000;
    setTimeout(() => { tick(); setInterval(tick, agg.intervalMs); }, offsetMs);
  }

  log.info({ aggregators: all.map((a) => a.name) }, 'aggregators scheduled');
}
