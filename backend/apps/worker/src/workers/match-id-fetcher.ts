// W1 — match-id-fetcher.
//
// Input: PuuidJob
// Effect:
//   1. Call MATCH-V5 /by-puuid/{puuid}/ids?count=20
//   2. Filter out match IDs already in DB
//   3. Enqueue new match IDs to matchIdQueue (priority inherited from PuuidJob)
//   4. Best-effort: fetch + upsert league entries so aggregators can bucket by
//      actual tier (otherwise BFS-discovered puuids have no rank info and all
//      data falls into a single "diamond+" bucket).

import { Worker, Job } from 'bullmq';
import { redis } from '../redis.js';
import { riot } from '../riot-client.js';
import { logger } from '../logger.js';
import { env } from '../env.js';
import { regionalFor, RiotApiError } from '@lol-tracker/riot';
import { Region, QUEUE_NAMES, MATCH_IDS_PER_PUUID, JOB_PRIORITY, QUEUE_ID } from '@lol-tracker/shared';
import { PuuidJob, enqueueMatchId } from '../queues.js';
import { filterUnknownMatchIds, upsertAccountStub, upsertAccountFull, upsertLeagueEntries, upsertSummonerProfile, upsertChampionMasteries } from '../persist/match.js';

const RANKED_QUEUES = [QUEUE_ID.SOLO, QUEUE_ID.FLEX] as readonly number[];

// Hard ceiling per puuid job. With personal-key throttling, a job can spend
// 60-120s in the bottleneck reservoir before its calls fire. Timeout must be
// > expected reservoir wait + actual work time, and < lockDuration so the
// finally clearTimeout runs before BullMQ steals the lock.
const JOB_TIMEOUT_MS = 180_000; // 180s — under the 200s lockDuration

function withJobTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`job timeout (${label})`)), JOB_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function handlePuuidJob(job: Job<PuuidJob>) {
  const { puuid, region, reason } = job.data;
  const log = logger.child({ worker: 'match-id', puuid: puuid.slice(0, 8), region, reason });

  await upsertAccountStub(puuid, region);

  const regional = regionalFor(region as Region);

  try {
    const acct = await riot.account.byPuuid(regional, puuid);
    await upsertAccountFull(puuid, region, acct.gameName, acct.tagLine);
  } catch (e) {
    if (!(e instanceof RiotApiError && e.status === 404)) {
      log.debug({ err: (e as Error).message }, 'account fetch failed (non-fatal)');
    }
  }
  try {
    const summ = await riot.summoner.byPuuid(region as Region, puuid);
    await upsertSummonerProfile(puuid, region, summ);
  } catch (e) {
    if (!(e instanceof RiotApiError && e.status === 404)) {
      log.debug({ err: (e as Error).message }, 'summoner fetch failed (non-fatal)');
    }
  }
  try {
    const leagueDtos = await riot.league.entriesByPuuid(region as Region, puuid);
    if (leagueDtos.length > 0) await upsertLeagueEntries(puuid, leagueDtos);
  } catch (e) {
    if (!(e instanceof RiotApiError && e.status === 404)) {
      log.debug({ err: (e as Error).message }, 'league fetch failed (non-fatal)');
    }
  }
  try {
    const masteryDtos = await riot.mastery.byPuuid(region as Region, puuid);
    if (masteryDtos.length > 0) await upsertChampionMasteries(puuid, masteryDtos.slice(0, 10));
  } catch (e) {
    if (!(e instanceof RiotApiError && e.status === 404)) {
      log.debug({ err: (e as Error).message }, 'mastery fetch failed (non-fatal)');
    }
  }

  // Rank-only jobs collect account/summoner/league/mastery (already done
  // above) and stop here — no match-id fetch, no further enqueue.
  if (job.data.skipMatchIds) {
    log.info({ rankOnly: true }, 'rank-only done');
    return { found: 0, enqueued: 0, rankOnly: true };
  }

  let ids: string[] = [];
  const isDeep = reason === 'deep-collect';
  const PAGE = MATCH_IDS_PER_PUUID;
  const maxPages = isDeep ? Math.max(1, job.data.deepPages ?? 5) : 1;

  // Only fetch matches from the current patch. Riot accepts startTime in
  // seconds. MATCH_MIN_TIME_SEC=0 disables the filter.
  const minTimeSec = Number(process.env.MATCH_MIN_TIME_SEC ?? 0);

  try {
    for (let page = 0; page < maxPages; page++) {
      const start = page * PAGE;
      const batch = await riot.match.idsByPuuid(regional, puuid, {
        count: PAGE,
        start,
        queue: QUEUE_ID.SOLO,
        ...(minTimeSec > 0 ? { startTime: minTimeSec } : {}),
      });
      ids.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch (e) {
    if (e instanceof RiotApiError && e.status === 404) {
      log.warn('puuid not found on Riot, skipping');
      return { found: 0, enqueued: 0 };
    }
    throw e;
  }

  const newIds = await filterUnknownMatchIds(ids);
  const priority = reason === 'user-search' || reason === 'refresh'
    ? JOB_PRIORITY.USER_TRIGGERED
    : reason === 'bfs' || reason === 'deep-collect' ? JOB_PRIORITY.USER_NEARBY
    : JOB_PRIORITY.BULK_SEED;

  const skipBfs = isDeep;

  for (const matchId of newIds) {
    await enqueueMatchId(
      { matchId, regional, region, discoveredFromPuuid: puuid, skipBfs },
      { priority },
    );
  }
  log.info({ found: ids.length, newIds: newIds.length, isDeep }, 'done');
  return { found: ids.length, enqueued: newIds.length, isDeep };
}

export function startMatchIdFetcher() {
  const worker = new Worker<PuuidJob>(
    QUEUE_NAMES.PUUID,
    (job: Job<PuuidJob>) => withJobTimeout(handlePuuidJob(job), `puuid ${job.data.puuid.slice(0, 8)}`),
    {
      connection: redis,
      concurrency: env.WORKER_MATCH_ID_CONCURRENCY,
      // Generous: personal-key throttling can stretch a job past the default
      // 30s lock. Must be > JOB_TIMEOUT_MS so we throw + release naturally.
      lockDuration: 200_000,
      stalledInterval: 60_000,
    },
  );

  worker.on('failed', (job, err) => {
    const detail = err instanceof RiotApiError
      ? { status: err.status, url: err.url, methodKey: err.methodKey }
      : {};
    logger.error({ jobId: job?.id, err: err.message, ...detail }, 'match-id job failed');
  });

  return worker;
}
