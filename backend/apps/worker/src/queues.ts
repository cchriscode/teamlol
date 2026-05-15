// BullMQ queue + worker definitions. Names + payload shapes only —
// the actual job handlers live in src/workers/*.ts (PR-2).

import { Queue, QueueEvents, JobsOptions } from 'bullmq';
import { redis } from './redis.js';
import { QUEUE_NAMES, JOB_PRIORITY } from '@lol-tracker/shared';

// ---- Job payload shapes ----------------------------------------------
export interface PuuidJob {
  puuid: string;
  region: string;            // 'kr', 'na1', ...
  reason: 'seed' | 'user-search' | 'bfs' | 'refresh' | 'deep-collect' | 'rank-only';
  /** For 'deep-collect' only: how many pages of 100 IDs to walk (default 5 → 500). */
  deepPages?: number;
  /** When true, fetch only account/summoner/league/mastery and skip match-id list.
   *  Used to ensure rank info is collected without expanding the BFS graph. */
  skipMatchIds?: boolean;
}

export interface MatchIdJob {
  matchId: string;           // e.g. 'KR_7234567890'
  regional: string;          // 'asia', 'americas', ...
  region: string;            // best-effort home region
  discoveredFromPuuid?: string;
  /** When true, W2 skips BFS — used for deep-collect to avoid runaway expansion. */
  skipBfs?: boolean;
}

export interface AggregateJob {
  kind: 'tier' | 'matchup' | 'synergy' | 'bot-duo' | 'copick' | 'cohort' | 'snapshot' | 'static-data';
  patch?: string;
  bracket?: string;
}

// ---- Queues (lazy singletons) ----------------------------------------
const connection = { connection: redis };

export const puuidQueue = new Queue<PuuidJob>(QUEUE_NAMES.PUUID, connection);
export const matchIdQueue = new Queue<MatchIdJob>(QUEUE_NAMES.MATCH_ID, connection);
export const aggregateQueue = new Queue<AggregateJob>(QUEUE_NAMES.AGGREGATE, connection);

export const puuidEvents = new QueueEvents(QUEUE_NAMES.PUUID, connection);
export const matchIdEvents = new QueueEvents(QUEUE_NAMES.MATCH_ID, connection);

// ---- Convenience enqueuers -------------------------------------------
export function enqueuePuuid(job: PuuidJob, opts?: JobsOptions) {
  return puuidQueue.add('puuid', job, {
    priority: priorityFor(job.reason),
    // Hangs are not transient — retrying many times wastes slots. Fail fast.
    attempts: 2,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 10_000 },
    removeOnFail: { age: 24 * 3600 },
    ...opts,
  });
}

export function enqueueMatchId(job: MatchIdJob, opts?: JobsOptions) {
  return matchIdQueue.add('match-id', job, {
    jobId: `match__${job.matchId}`,
    priority: opts?.priority ?? JOB_PRIORITY.BULK_SEED,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 50_000 },
    removeOnFail: { age: 24 * 3600 },
    ...opts,
  });
}

export function enqueueAggregate(job: AggregateJob, opts?: JobsOptions) {
  return aggregateQueue.add(job.kind, job, {
    jobId: `agg__${job.kind}__${job.patch ?? 'cur'}__${job.bracket ?? 'all'}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...opts,
  });
}

function priorityFor(reason: PuuidJob['reason']): number {
  switch (reason) {
    case 'user-search':
    case 'refresh': return JOB_PRIORITY.USER_TRIGGERED;
    case 'deep-collect':
    case 'bfs': return JOB_PRIORITY.USER_NEARBY;
    case 'seed': return JOB_PRIORITY.BULK_SEED;
    case 'rank-only': return JOB_PRIORITY.BULK_SEED;
  }
}

export async function closeAllQueues() {
  await Promise.all([
    puuidQueue.close(), matchIdQueue.close(), aggregateQueue.close(),
    puuidEvents.close(), matchIdEvents.close(),
  ]);
}
