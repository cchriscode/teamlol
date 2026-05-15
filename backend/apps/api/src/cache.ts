// Tiny Redis cache wrapper. JSON-encoded, TTL in seconds.
//
// Usage:
//   const data = await cache(`champions:${lane}:${bracket}`, 300, async () => { ... });
//
// Single-flight is intentionally NOT included — for our hot paths the
// computed payload is cheap (~50ms DB query) and cache stampedes are rare.

import { redis } from './redis.js';

export async function cache<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) {
    try { return JSON.parse(hit) as T; } catch { /* fall through */ }
  }
  const value = await compute();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
  return value;
}

export async function invalidate(pattern: string): Promise<number> {
  // SCAN-based invalidation (KEYS is O(N), avoid in prod).
  let cursor = '0', count = 0;
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (batch.length > 0) {
      count += await redis.del(...batch);
    }
  } while (cursor !== '0');
  return count;
}
