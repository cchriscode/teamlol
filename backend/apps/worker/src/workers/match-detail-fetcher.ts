// W2 — match-detail-fetcher.
//
// Input: MatchIdJob
// Effect:
//   1. Fetch MATCH-V5 detail + timeline (parallel).
//   2. Parse → matches / match_participants / match_timelines rows.
//   3. AI Score precompute per participant (absolute LUT, no cohort lookup).
//   4. INSERT ... RETURNING is the idempotency check (handles concurrent workers).
//   5. New PUUIDs discovered → enqueuePuuid(reason='bfs').

import { Worker, Job } from 'bullmq';
import { redis } from '../redis.js';
import { riot } from '../riot-client.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { RiotApiError } from '@lol-tracker/riot';
import { QUEUE_NAMES, QUEUE_ID, RegionalRoute } from '@lol-tracker/shared';
import { MatchIdJob, enqueuePuuid } from '../queues.js';
import { parseMatch } from '../parse/match.js';
import { persistMatch, filterUnknownPuuids } from '../persist/match.js';

// Hard ceiling on a single job. If the handler hasn't returned by then,
// throw so BullMQ moves on (retry per attempts policy) instead of holding
// the lock forever and blocking the concurrency slot.
// Personal-key throttling: a match-detail job can wait in the bottleneck
// reservoir behind queued puuid-job calls. Timeout must be > expected
// reservoir wait. Bump back down once a Production key is approved.
const JOB_TIMEOUT_MS = 120_000;

function withJobTimeout<T>(label: string, runner: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ctrl.abort(); reject(new Error(`job timeout (${label})`)); }, JOB_TIMEOUT_MS);
    runner(ctrl.signal).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function handleJob(job: Job<MatchIdJob>, signal: AbortSignal) {
  const { matchId, regional, region, skipBfs } = job.data;
  const log = logger.child({ worker: 'match-detail', matchId });

  let detail, timeline;
  try {
    [detail, timeline] = await Promise.all([
      riot.match.byId(regional as RegionalRoute, matchId, signal),
      riot.match.timelineById(regional as RegionalRoute, matchId, signal),
    ]);
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      log.warn('match not found on Riot, dropping');
      return { skipped: true, reason: '404' };
    }
    throw e;
  }

  // Drop non-SR or non-ranked-solo matches early — keep our data clean.
  const queueId = detail.info.queueId;
  const mapId = detail.info.mapId;
  if (mapId !== 11 || queueId !== QUEUE_ID.SOLO) {
    log.debug({ queueId, mapId }, 'non-target queue/map, skipping persist');
    return { skipped: true, reason: 'non-target' };
  }

  // Defensive patch filter — even if startTime filter slips, drop pre-target.
  const minTimeMs = Number(process.env.MATCH_MIN_TIME_SEC ?? 0) * 1000;
  if (minTimeMs > 0 && detail.info.gameCreation < minTimeMs) {
    log.debug({ gameCreation: detail.info.gameCreation }, 'pre-target patch, skipping');
    return { skipped: true, reason: 'pre-target-patch' };
  }

  const parsed = parseMatch(matchId, region, detail, timeline);
  const inserted = await persistMatch(parsed);

  let newPuuidsCount = 0;
  // Always collect rank info for new puuids. BFS_ENABLED=false only disables
  // the BFS expansion (match-id fetch) — the rank/account/summoner/mastery
  // pulls still happen so we never end up with UNKNOWN-tier participants.
  const bfsEnabled = process.env.BFS_ENABLED !== 'false';
  if (!skipBfs) {
    const newPuuids = await filterUnknownPuuids(parsed.participantPuuids);
    newPuuidsCount = newPuuids.length;
    const reason = bfsEnabled ? 'bfs' : 'rank-only';
    const skipMatchIds = !bfsEnabled;
    // Fan out enqueues — each is a Redis write, no inter-dependency.
    await Promise.all(
      newPuuids.map((puuid) => enqueuePuuid({ puuid, region, reason, skipMatchIds })),
    );
  }

  log.info({
    inserted, participants: parsed.participants.length, newPuuids: newPuuidsCount, skipBfs: !!skipBfs,
  }, inserted ? 'ingested' : 'already known');
  return { matchId, inserted, newPuuids: newPuuidsCount };
}

export function startMatchDetailFetcher() {
  const worker = new Worker<MatchIdJob>(
    QUEUE_NAMES.MATCH_ID,
    (job: Job<MatchIdJob>) => withJobTimeout(`match-detail ${job.data.matchId}`, (signal) => handleJob(job, signal)),
    {
      connection: redis,
      concurrency: env.WORKER_MATCH_DETAIL_CONCURRENCY,
      // Must be > JOB_TIMEOUT_MS so the handler can throw + finally before
      // BullMQ stalls the lock. With personal-key throttling, 60s wasn't
      // enough.
      lockDuration: 140_000,
      stalledInterval: 60_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'match-detail job failed');
  });

  return worker;
}
