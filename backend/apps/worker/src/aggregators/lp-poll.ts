// Periodic LEAGUE-V4 polling for active/recently-searched accounts. Each
// poll appends a row to lp_snapshots via the upsertLeagueEntries hook, so
// over time we build a fine-grained LP timeline per player.
//
// This is the foundation for the per-match "+15 LP / −12 LP" display:
// once a player has two snapshots straddling a match's gameCreation, we
// can compute the delta. Coverage starts from the first poll forward;
// older matches show "—" until enough snapshots accumulate.
//
// Rate budgeting: dev key allows ~20 req/s app + 100/2min per method.
// LEAGUE-V4 entriesByPuuid is one call per puuid. We pick the 50 oldest-
// refreshed accounts every 3 min (~17 puuids/min) — well under the
// per-method ceiling and naturally weights to active users.

import { db, schema, sql } from '@lol-tracker/db';
import { Region } from '@lol-tracker/shared';
import { riot } from '../riot-client.js';
import { upsertLeagueEntries } from '../persist/match.js';
import { logger } from '../logger.js';

const BATCH = 50;

export async function pollLpSnapshots(): Promise<{ polled: number; failed: number }> {
  const log = logger.child({ aggregator: 'lp-poll' });

  // Pick puuids whose league_entries hasn't been refreshed recently.
  // INNER JOIN to league_entries: only puuids known to have a solo entry
  // at some point — skips the "ingested via BFS but never finished
  // placements / decayed inactive" accounts that would otherwise burn
  // most of our Riot quota on 404 entriesByPuuid responses.
  const rows = await db.execute(sql`
    SELECT a.puuid, a.region
    FROM accounts a
    JOIN league_entries le ON le.puuid = a.puuid AND le.queue_type = 'RANKED_SOLO_5x5'
    LEFT JOIN blocked_puuids b ON b.puuid = a.puuid
    WHERE b.puuid IS NULL
    ORDER BY le.refreshed_at ASC
    LIMIT ${BATCH}
  `);
  const candidates = rows as unknown as Array<{ puuid: string; region: string }>;
  if (candidates.length === 0) return { polled: 0, failed: 0 };

  let polled = 0, failed = 0;
  // Sequential to respect rate limits — Bottleneck inside riot-client also
  // throttles, but serial is simpler to reason about and the 50-batch
  // finishes in seconds at the configured concurrency.
  for (const { puuid, region } of candidates) {
    try {
      const dtos = await riot.league.entriesByPuuid(region as Region, puuid);
      if (dtos && dtos.length > 0) {
        await upsertLeagueEntries(puuid, dtos.map((d) => ({
          queueType: d.queueType,
          tier: d.tier,
          rank: d.rank ?? '',
          leaguePoints: d.leaguePoints,
          wins: d.wins,
          losses: d.losses,
          veteran: d.veteran,
          inactive: d.inactive,
          freshBlood: d.freshBlood,
          hotStreak: d.hotStreak,
        })));
      }
      polled += 1;
    } catch (e) {
      failed += 1;
      log.debug({ puuid, err: (e as Error).message }, 'lp poll failed');
    }
  }

  log.info({ polled, failed }, 'lp snapshot batch done');
  return { polled, failed };
}
