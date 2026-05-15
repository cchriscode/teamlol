// Shared Redis connection for BullMQ + caches.
// BullMQ requires `maxRetriesPerRequest: null` to avoid spurious aborts.
import IORedis, { Redis } from 'ioredis';
import { env } from './env.js';

export const redis: Redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] error', err);
});
