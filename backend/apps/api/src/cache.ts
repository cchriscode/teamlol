// Tiny Redis cache wrapper. JSON-encoded, TTL in seconds.
//
// Usage:
//   const data = await cache(`champions:${lane}:${bracket}`, 300, async () => { ... });
//
// Single-flight: when a key is missing, one process acquires a Redis-level
// lock and recomputes; concurrent callers poll the cache briefly until the
// winner publishes. Prevents N parallel identical DB scans on a cold miss.

import { redis } from './redis.js';

const LOCK_TTL_SEC = 15;          // hard cap so a crashed worker can't stall others
const POLL_INTERVAL_MS = 75;
const MAX_POLLS = 80;             // 80 × 75ms = 6s ceiling

export async function cache<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) {
    try { return JSON.parse(hit) as T; } catch { /* fall through */ }
  }

  // Try to claim the lock. NX = set only if not exists.
  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SEC, 'NX');
  if (acquired === 'OK') {
    try {
      const value = await compute();
      await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
      return value;
    } finally {
      await redis.del(lockKey).catch(() => undefined);
    }
  }

  // Lost the race — poll for the winner's result, then fall back to compute.
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const v = await redis.get(key);
    if (v) {
      try { return JSON.parse(v) as T; } catch { break; }
    }
  }
  // Winner failed or timed out; compute ourselves so we don't 500.
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
