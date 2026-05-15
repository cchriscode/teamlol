import IORedis, { Redis } from 'ioredis';

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL not set');

export const redis: Redis = new IORedis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
redis.on('error', (e) => { /* eslint-disable-next-line no-console */ console.error('[redis-api]', e.message); });
