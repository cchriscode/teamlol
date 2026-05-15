// Worker entry point. Spawns all BullMQ workers in one Node process.
//
// To split across machines later: launch separate processes that each call
// only the workers they own (set via WORKER_KINDS env). For now: all in one.
//
// Boot options (env):
//   SEED_ON_BOOT=true           — auto-trigger challenger seed on startup
//   SEED_ON_BOOT_LIMIT=50       — cap seed PUUIDs (defaults to 50 on dev key, unlimited on prod)

import { logger } from './logger.js';
import { env } from './env.js';
import { startMatchIdFetcher } from './workers/match-id-fetcher.js';
import { startMatchDetailFetcher } from './workers/match-detail-fetcher.js';
import { closeAllQueues } from './queues.js';
import { redis } from './redis.js';
import { seedFromHighElo } from './seed/challenger-bfs.js';
import { startAggregators } from './aggregators/runner.js';
import { Region } from '@lol-tracker/shared';

async function main() {
  logger.info({
    region: env.SEED_REGION,
    bracket: env.SEED_BRACKET,
    keyTier: env.RIOT_KEY_TIER,
    matchIdConcurrency: env.WORKER_MATCH_ID_CONCURRENCY,
    matchDetailConcurrency: env.WORKER_MATCH_DETAIL_CONCURRENCY,
  }, 'worker starting');

  const workers = [
    ...(env.WORKER_MATCH_ID_CONCURRENCY > 0 ? [startMatchIdFetcher()] : []),
    startMatchDetailFetcher(),
  ];
  if (env.WORKER_MATCH_ID_CONCURRENCY === 0) {
    logger.warn('puuid worker disabled (WORKER_MATCH_ID_CONCURRENCY=0) — BFS paused');
  }

  // Aggregators: tier (W3). Bot-duo / synergy / cohort = PR-4.
  if (process.env.AGGREGATORS_ENABLED !== 'false') {
    startAggregators();
  }

  if (process.env.SEED_ON_BOOT === 'true') {
    const limit = process.env.SEED_ON_BOOT_LIMIT
      ? Number(process.env.SEED_ON_BOOT_LIMIT)
      : (env.RIOT_KEY_TIER === 'dev' ? 50 : undefined);
    seedFromHighElo({ region: env.SEED_REGION as Region, limit })
      .then((n) => logger.info({ seeded: n }, 'boot seed complete'))
      .catch((e) => logger.error({ err: e?.message ?? e }, 'boot seed failed'));
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown initiated');
    await Promise.all(workers.map((w) => w.close()));
    await closeAllQueues();
    await redis.quit();
    logger.info('shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('worker ready — waiting for jobs');
}

main().catch((err) => {
  logger.error({ err: err?.message ?? err, stack: err?.stack }, 'worker boot failed');
  process.exit(1);
});
