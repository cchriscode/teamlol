// Aggregator-only entry point. Runs aggregators in their own Node process so
// heavy SQL workloads cannot block the BullMQ workers' poll loop / rate-limiter.
//
// Spawn separately from the worker process:
//   pnpm --filter @lol-tracker/worker aggregator

import { logger } from './logger.js';
import { startAggregators } from './aggregators/runner.js';
import { redis } from './redis.js';

async function main() {
  logger.info({ component: 'aggregator-process' }, 'aggregator starting');
  startAggregators();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'aggregator shutdown');
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('aggregator ready');
}

main().catch((err) => {
  logger.error({ err: err?.message ?? err, stack: err?.stack }, 'aggregator boot failed');
  process.exit(1);
});
